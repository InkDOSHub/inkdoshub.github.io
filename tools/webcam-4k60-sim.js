#!/usr/bin/env node
"use strict";

/*
 * Modelo teórico de pipeline 4K60 com estágios em pipeline e fila latest-frame-wins.
 * Os tempos são hipóteses, não benchmarks do InkTerminal ou do computador-alvo.
 * Uso: node tools/webcam-4k60-sim.js
 */

function seeded(seed) {
  let state = seed >>> 0;
  return () => ((state = (1664525 * state + 1013904223) >>> 0) / 4294967296);
}
function gaussian(random, sd) {
  if (!sd) return 0;
  const u1 = Math.max(Number.EPSILON, random());
  const u2 = random();
  return sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] || 0;
}

function simulate({ name, fps = 60, durationSec = 60, stages, seed = 123, jitterMs = 0.5 }) {
  const random = seeded(seed);
  const period = 1000 / fps;
  const arrivals = [];
  let time = 0;
  while (time < durationSec * 1000) {
    time += Math.max(1, period + gaussian(random, jitterMs));
    arrivals.push(time);
  }

  const workers = stages.map(() => ({
    active: null, busyUntil: Infinity, pending: null, completed: 0
  }));
  const latencies = [];
  let input = 0;
  let delivered = 0;
  let now = 0;

  function start(stageIndex, frame, at) {
    const worker = workers[stageIndex];
    worker.active = frame;
    worker.busyUntil = at + Math.max(0.1, stages[stageIndex].ms + gaussian(random, stages[stageIndex].sd));
  }
  function offer(stageIndex, frame, at) {
    if (stageIndex >= workers.length) {
      delivered++;
      latencies.push(at - frame.origin);
      return;
    }
    const worker = workers[stageIndex];
    if (worker.active === null) {
      start(stageIndex, frame, at);
    } else {
      // Limita a fila a um quadro: sempre conserva o quadro pendente mais recente.
      worker.pending = frame;
    }
  }

  while (input < arrivals.length || workers.some(w => w.active !== null || w.pending !== null)) {
    const nextInput = input < arrivals.length ? arrivals[input] : Infinity;
    let nextDone = Infinity;
    let nextStage = -1;
    for (let i = 0; i < workers.length; i++) {
      if (workers[i].active !== null && workers[i].busyUntil < nextDone) {
        nextDone = workers[i].busyUntil;
        nextStage = i;
      }
    }

    if (nextInput <= nextDone) {
      now = nextInput;
      offer(0, { origin: nextInput }, now);
      input++;
    } else if (nextStage >= 0) {
      now = nextDone;
      const worker = workers[nextStage];
      const completedFrame = worker.active;
      worker.active = null;
      worker.completed++;
      offer(nextStage + 1, completedFrame, now);
      if (worker.pending !== null) {
        const newest = worker.pending;
        worker.pending = null;
        start(nextStage, newest, now);
      }
    } else {
      break;
    }
  }

  const meanLatency = latencies.reduce((sum, value) => sum + value, 0) / Math.max(1, latencies.length);
  return {
    scenario: name,
    inputFps: +(arrivals.length / durationSec).toFixed(2),
    outputFps: +(delivered / durationSec).toFixed(2),
    delivered,
    droppedBeforeOutput: arrivals.length - delivered,
    stageServiceMs: stages.map(stage => stage.ms),
    meanLatencyMs: +meanLatency.toFixed(2),
    p95LatencyMs: +percentile(latencies, 0.95).toFixed(2)
  };
}

const width = 3840;
const height = 2160;
const pixels = width * height;
const rgbaBytes = pixels * 4;
const yuvBytes = pixels * 1.5;
console.log(JSON.stringify({
  resolution: `${width}x${height}`,
  targetFps: 60,
  pixelsPerFrame: pixels,
  pixelsPerSecond: pixels * 60,
  rgbaBytesPerFrame: rgbaBytes,
  rgbaGBpsPerPass: +(rgbaBytes * 60 / 1e9).toFixed(3),
  i420OrNv12BytesPerFrame: yuvBytes,
  yuvGBpsPerPass: +(yuvBytes * 60 / 1e9).toFixed(3),
  note: "Bytes moved per pass, not network bitrate; all service times below are hypothetical."
}, null, 2));

const scenarios = [
  {
    name: "Legacy Canvas/RGBA + IPC + BGR (assumptions)",
    stages: [
      { name: "Canvas/readback", ms: 28, sd: 4 },
      { name: "IPC/copy", ms: 4, sd: 1 },
      { name: "RGBA-to-BGR + DirectShow", ms: 12, sd: 3 }
    ]
  },
  {
    name: "Browser WebRTC + CPU I420 + native conversion + MF (assumptions)",
    stages: [
      { name: "VideoFrame.copyTo", ms: 3.2, sd: 0.8 },
      { name: "IPC/shared memory", ms: 2.5, sd: 0.5 },
      { name: "transform/I420-to-NV12", ms: 5, sd: 1.5 },
      { name: "MF handoff", ms: 1.5, sd: 0.5 }
    ]
  },
  {
    name: "Browser hardware decode with 4K GPU readback extrapolated from 1080p (assumption)",
    stages: [
      { name: "VideoFrame.copyTo GPU readback", ms: 48, sd: 6 },
      { name: "IPC/shared memory", ms: 2.5, sd: 0.5 },
      { name: "transform/I420-to-NV12", ms: 5, sd: 1.5 },
      { name: "MF handoff", ms: 1.5, sd: 0.5 }
    ]
  },
  {
    name: "Native WebRTC + hardware decode/D3D11 + MF NV12 (assumptions)",
    stages: [
      { name: "native WebRTC/jitter", ms: 1.5, sd: 0.5 },
      { name: "hardware decode", ms: 3.5, sd: 1 },
      { name: "GPU transform/handoff", ms: 2.5, sd: 0.7 }
    ]
  },
  {
    name: "Native path with extra headroom/thermal margin (assumptions)",
    stages: [
      { name: "native WebRTC/jitter", ms: 2, sd: 0.5 },
      { name: "hardware decode", ms: 4.5, sd: 1 },
      { name: "GPU transform/handoff", ms: 3.5, sd: 1 }
    ]
  }
];

const results = scenarios.map(scenario => simulate(scenario));
for (const result of results) console.log(JSON.stringify(result));

// Guardrails validate only the simulator's math, not real-world 4K60 performance.
const [legacy, browserNative, browserGpuReadback, nativeGpu, nativeGpuHeadroom] = results;
if (!(legacy.outputFps < 59 &&
      browserNative.outputFps >= 59 &&
      browserGpuReadback.outputFps < 59 &&
      nativeGpu.outputFps >= 59 &&
      nativeGpuHeadroom.outputFps >= 59 &&
      browserNative.p95LatencyMs < 50 &&
      browserGpuReadback.p95LatencyMs > 50 &&
      nativeGpu.p95LatencyMs < 50 &&
      nativeGpuHeadroom.p95LatencyMs < 50)) {
  console.error("SIMULATION CHECK FAILED: review assumptions and queue model.");
  process.exitCode = 1;
} else {
  console.log("SIMULATION CHECK PASSED (theoretical model only; not a hardware benchmark).");
}
