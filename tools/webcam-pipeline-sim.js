#!/usr/bin/env node
"use strict";

/*
 * Modelo teórico de capacidade do pipeline de webcam.
 * Não mede o computador nem decodifica vídeo real. Os tempos de serviço são
 * hipóteses explicitadas para testar fila limitada e política "latest frame wins".
 *
 * Uso: node tools/webcam-pipeline-sim.js
 */

function gaussian(random, mean, sd) {
  if (!sd) return mean;
  const u1 = Math.max(Number.EPSILON, random());
  const u2 = random();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function simulate({ name, serviceMeanMs, serviceSdMs, fps = 30, durationSec = 60, jitterMs = 1.5, seed = 42 }) {
  const random = seeded(seed);
  const period = 1000 / fps;
  const arrivals = [];
  let at = 0;
  while (at < durationSec * 1000) {
    at += Math.max(1, period + gaussian(random, 0, jitterMs));
    arrivals.push(at);
  }

  let i = 0;
  let now = 0;
  let busyUntil = 0;
  let pending = null;
  let dropped = 0;
  const latencies = [];
  let delivered = 0;

  while (i < arrivals.length || pending !== null || now < busyUntil) {
    if (now >= busyUntil) {
      if (pending !== null) {
        const service = Math.max(0.1, gaussian(random, serviceMeanMs, serviceSdMs));
        latencies.push(now + service - pending.at);
        delivered++;
        pending = null;
        busyUntil = now + service;
      } else if (i < arrivals.length) {
        now = Math.max(now, arrivals[i]);
        pending = { at: arrivals[i] };
        i++;
        continue;
      } else {
        break;
      }
    }

    // While busy, retain only the newest frame. Replacing a pending frame is a drop.
    while (i < arrivals.length && arrivals[i] < busyUntil) {
      if (pending !== null) dropped++;
      pending = { at: arrivals[i] };
      i++;
    }
    now = busyUntil;
  }

  const sorted = latencies.slice().sort((a, b) => a - b);
  return {
    scenario: name,
    inputFps: +(arrivals.length / durationSec).toFixed(2),
    outputFps: +(delivered / durationSec).toFixed(2),
    delivered,
    dropped: arrivals.length - delivered,
    meanLatencyMs: +(latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length)).toFixed(2),
    p95LatencyMs: +percentile(sorted, 0.95).toFixed(2),
    serviceMeanMs: serviceMeanMs,
    serviceSdMs: serviceSdMs
  };
}

const bytesRgba = 1920 * 1080 * 4;
const bytesI420 = 1920 * 1080 * 1.5;
console.log("1080p RGBA:", bytesRgba, "bytes/frame;", Math.round(bytesRgba * 30 / 1e6), "MB/s at 30 fps");
console.log("1080p I420:", bytesI420, "bytes/frame;", Math.round(bytesI420 * 30 / 1e6), "MB/s at 30 fps");
console.log("Results below are simulated scenarios, not hardware measurements.\n");

const scenarios = [
  { name: "current canvas/RGBA (model)", serviceMeanMs: 60, serviceSdMs: 5, seed: 42 },
  { name: "A: native WebRTC/decoder + MF (assumption)", serviceMeanMs: 6, serviceSdMs: 2, seed: 42 },
  { name: "B: VideoFrame/YUV + native pipeline (assumption)", serviceMeanMs: 3, serviceSdMs: 1, seed: 42 }
];
for (const scenario of scenarios) console.log(JSON.stringify(simulate(scenario)));
