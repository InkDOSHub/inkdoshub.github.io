#!/usr/bin/env bash
# InkDOS Hub native benchmark for Linux (also WSL). Same result format as the browser benchmark,
# so the JSON can be loaded in https://hub.inkdos.workers.dev/apps/xeos-tests/?bench ("Load PDF to compare").
# Uses well-known open tools: 7-Zip benchmark, STREAM (memory), smallpt (same scene as the browser
# tile render), dd (disk), Cloudflare speed test (network), glmark2 (GPU, if installed).
# Run: curl -fsSL https://hub.inkdos.workers.dev/apps/xeos-tests/native/inkbench.sh | bash
# Options (env): STRESS=0 skips the 5-minute stress test.
set -u
VER=2
W=$(mktemp -d /tmp/inkbench.XXXX); cd "$W" || exit 1
LOG="$W/inkbench.log"; OUT_DIR="${OUT_DIR:-$HOME}"
T0=$(date +%s.%N)
log() { printf '[%7.2fs] %s\n' "$(echo "$(date +%s.%N) - $T0" | bc 2>/dev/null || echo 0)" "$*" | tee -a "$LOG" >&2; }
M=""   # metrics JSON fragments
met() { # id value note
  local v="$2"; [ -z "$v" ] && v=null
  M="$M\"$1\":{\"v\":$v,\"note\":\"$(echo "$3" | sed 's/["\\]/ /g')\"},"; log "  $1 = $2 ($3)"; }
js() { echo "$1" | sed 's/["\\]/ /g' | tr -d '\n'; }
have() { command -v "$1" >/dev/null 2>&1; }
log "InkDOS native benchmark v$VER (Linux) · work dir $W"
for t in bc curl tar gcc; do have $t || log "missing tool: $t (some tests will be skipped)"; done

# ---------- identification ----------
CPU=$(lscpu 2>/dev/null | sed -n 's/^Model name:\s*//p' | head -1)
THR=$(nproc); CORES=$(lscpu -p=Core 2>/dev/null | grep -v '^#' | sort -u | wc -l)
MHZ=$(lscpu 2>/dev/null | sed -n 's/^CPU max MHz:\s*//p' | head -1)
ARCH=$(uname -m); KER=$(uname -r)
RAM=$(awk '/MemTotal/{printf "%.1f GB", $2/1048576}' /proc/meminfo)
OS=$( . /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-Linux}")
WSL=""; grep -qi microsoft /proc/version 2>/dev/null && WSL=" (WSL)"
GPU=$(lspci 2>/dev/null | grep -iE 'vga|3d|display' | sed 's/^[^:]*: //' | head -2 | paste -sd ';' -)
DISK=$(lsblk -dno MODEL,SIZE,ROTA 2>/dev/null | grep -v '^\s*$' | head -2 | awk '{r=$NF; $NF=""; print $0 (r==1?"HDD":"SSD")}' | paste -sd ';' -)
log "CPU: $CPU · $CORES cores / $THR threads · max ${MHZ:-?} MHz · $ARCH"
log "RAM: $RAM · GPU: ${GPU:-?} · Disk: ${DISK:-?} · OS: $OS$WSL · kernel $KER"

# ---------- CPU: 7-Zip ----------
Z=""
if have 7zz; then Z=7zz; elif have 7z; then Z=7z; else
  A=x64; [ "$ARCH" = aarch64 ] && A=arm64
  for u in "https://github.com/ip7z/7zip/releases/download/24.09/7z2409-linux-$A.tar.xz" "https://www.7-zip.org/a/7z2409-linux-$A.tar.xz"; do
    if curl -fsSL "$u" -o 7z.tar.xz 2>>"$LOG" && tar -xJf 7z.tar.xz 7zz 2>>"$LOG"; then Z="$W/7zz"; break; else log "7-Zip download failed from $u"; fi
  done
fi
zrate() { "$Z" b "$@" 2>&1 | tee -a "$LOG.7z" | awk '/^Tot:/{print $NF}' | tail -1; }
if [ -n "$Z" ]; then
  log "== 7-Zip benchmark ($Z)"
  met cpu1.7zip "$(zrate -mmt1)" "7-Zip $($Z | head -2 | tail -1 | cut -c1-40) · 1 thread · total rating"
  met cpuN.7zip "$(zrate)" "all $THR threads · total rating"
fi

# ---------- smallpt (same scene and settings as the browser tile render) ----------
if have gcc; then
  log "== smallpt (C, OpenMP)"
  cat > smallpt.c <<'C'
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <omp.h>
typedef struct { double x, y, z; } V;
static V v(double a, double b, double c) { V r = { a, b, c }; return r; }
static V add(V a, V b) { return v(a.x + b.x, a.y + b.y, a.z + b.z); }
static V sub(V a, V b) { return v(a.x - b.x, a.y - b.y, a.z - b.z); }
static V mul(V a, double b) { return v(a.x * b, a.y * b, a.z * b); }
static V mulv(V a, V b) { return v(a.x * b.x, a.y * b.y, a.z * b.z); }
static double dot(V a, V b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static V norm(V a) { return mul(a, 1 / sqrt(dot(a, a))); }
static V cross(V a, V b) { return v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
typedef struct { double rad; V p, e, c; int refl; } S;
static S sph[] = { {1e5, {1e5 + 1, 40.8, 81.6}, {0}, {.75, .25, .25}, 0}, {1e5, {-1e5 + 99, 40.8, 81.6}, {0}, {.25, .25, .75}, 0},
  {1e5, {50, 40.8, 1e5}, {0}, {.75, .75, .75}, 0}, {1e5, {50, 40.8, -1e5 + 170}, {0}, {0}, 0}, {1e5, {50, 1e5, 81.6}, {0}, {.75, .75, .75}, 0},
  {1e5, {50, -1e5 + 81.6, 81.6}, {0}, {.75, .75, .75}, 0}, {16.5, {27, 16.5, 47}, {0}, {.999, .999, .999}, 1},
  {16.5, {73, 16.5, 78}, {0}, {.999, .999, .999}, 2}, {600, {50, 681.6 - .27, 81.6}, {12, 12, 12}, {0}, 0} };
static double rnd(unsigned *s) { *s ^= *s << 13; *s ^= *s >> 17; *s ^= *s << 5; return *s / 4294967296.0; }
static int hit(V o, V d, double *t) {
  int id = -1; *t = 1e20;
  for (int i = 0; i < 9; i++) { V op = sub(sph[i].p, o); double b = dot(op, d), det = b * b - dot(op, op) + sph[i].rad * sph[i].rad, tt;
    if (det < 0) continue; det = sqrt(det); if ((tt = b - det) <= 1e-4 && (tt = b + det) <= 1e-4) continue; if (tt < *t) { *t = tt; id = i; } }
  return id;
}
static V rad(V o, V d, int depth, unsigned *s) {
  double t; int id = hit(o, d, &t); if (id < 0) return v(0, 0, 0);
  S *ob = &sph[id]; V x = add(o, mul(d, t)), n = norm(sub(x, ob->p)), nl = dot(n, d) < 0 ? n : mul(n, -1), f = ob->c;
  double p = f.x > f.y && f.x > f.z ? f.x : f.y > f.z ? f.y : f.z;
  if (++depth > 5) { if (depth < 12 && rnd(s) < p) f = mul(f, 1 / p); else return ob->e; }
  if (ob->refl == 0) { double r1 = 2 * M_PI * rnd(s), r2 = rnd(s), r2s = sqrt(r2); V w = nl, u = norm(cross(fabs(w.x) > .1 ? v(0, 1, 0) : v(1, 0, 0), w)), vv = cross(w, u);
    V dd = norm(add(add(mul(u, cos(r1) * r2s), mul(vv, sin(r1) * r2s)), mul(w, sqrt(1 - r2)))); return add(ob->e, mulv(f, rad(x, dd, depth, s))); }
  V rd = sub(d, mul(n, 2 * dot(n, d)));
  if (ob->refl == 1) return add(ob->e, mulv(f, rad(x, rd, depth, s)));
  int into = dot(n, nl) > 0; double nnt = into ? 1 / 1.5 : 1.5, ddn = dot(d, nl), cos2t = 1 - nnt * nnt * (1 - ddn * ddn);
  if (cos2t < 0) return add(ob->e, mulv(f, rad(x, rd, depth, s)));
  V td = norm(sub(mul(d, nnt), mul(n, (into ? 1 : -1) * (ddn * nnt + sqrt(cos2t)))));
  double c = 1 - (into ? -ddn : dot(td, n)), Re = .04 + .96 * c * c * c * c * c, Tr = 1 - Re, P = .25 + .5 * Re;
  V r = depth > 2 ? (rnd(s) < P ? mul(rad(x, rd, depth, s), Re / P) : mul(rad(x, td, depth, s), Tr / (1 - P))) : add(mul(rad(x, rd, depth, s), Re), mul(rad(x, td, depth, s), Tr));
  return add(ob->e, mulv(f, r));
}
int main(int argc, char **argv) {
  int w = 320, h = 240, spp = 8; double minsec = argc > 1 ? atof(argv[1]) : 0; long long samples = 0; double t0 = omp_get_wtime(), sum = 0;
  V cd = norm(v(0, -0.042612, -1)), cx = v(w * .5135 / h, 0, 0), cy = mul(norm(cross(cx, cd)), .5135);
  do {
#pragma omp parallel for schedule(dynamic, 1) reduction(+:sum)
    for (int y = 0; y < h; y++) { unsigned s = 2463534242u ^ (y * 2654435761u);
      for (int x = 0; x < w; x++) for (int sy = 0; sy < 2; sy++) for (int sx = 0; sx < 2; sx++) for (int k = 0; k < spp; k++) {
        double r1 = 2 * rnd(&s), dx = r1 < 1 ? sqrt(r1) - 1 : 1 - sqrt(2 - r1), r2 = 2 * rnd(&s), dy = r2 < 1 ? sqrt(r2) - 1 : 1 - sqrt(2 - r2);
        V d = add(add(mul(cx, ((sx + .5 + dx) / 2 + x) / w - .5), mul(cy, ((sy + .5 + dy) / 2 + y) / h - .5)), cd);
        V c = rad(add(v(50, 52, 295.6), mul(d, 140)), norm(d), 0, &s); sum += c.x; } }
    samples += (long long)w * h * 4 * spp;
  } while (omp_get_wtime() - t0 < minsec);
  double sec = omp_get_wtime() - t0;
  printf("%.1f %.2f %lld %g\n", samples / sec / 1000, sec, samples, sum > 0 ? 1.0 : 0.0);
  return 0;
}
C
  if gcc -O3 -march=native -fopenmp smallpt.c -o smallpt -lm 2>>"$LOG" || gcc -O3 -fopenmp smallpt.c -o smallpt -lm 2>>"$LOG"; then
    r=$(OMP_NUM_THREADS=1 ./smallpt 0); met render.tile1 "$(echo $r | cut -d' ' -f1)" "native C, 1 thread, $(echo $r | cut -d' ' -f3) samples in $(echo $r | cut -d' ' -f2) s"
    r=$(./smallpt 5); met render.tileN "$(echo $r | cut -d' ' -f1)" "native C, $THR threads, $(echo $r | cut -d' ' -f3) samples in $(echo $r | cut -d' ' -f2) s"
  else log "smallpt compile failed"; fi
fi

# ---------- memory: STREAM ----------
if have gcc && curl -fsSL https://www.cs.virginia.edu/stream/FTP/Code/stream.c -o stream.c; then
  log "== STREAM"
  if gcc -O3 -fopenmp -DSTREAM_ARRAY_SIZE=40000000 -DNTIMES=10 stream.c -o stream 2>>"$LOG"; then
    ./stream > stream.txt 2>&1; cat stream.txt >> "$LOG"
    c=$(awk '/^Copy:/{print $2/1000}' stream.txt); tr=$(awk '/^Triad:/{print $2/1000}' stream.txt)
    met mem.copy "$c" "STREAM Copy, $THR threads"; met mem.stream "$tr" "STREAM Triad, $THR threads"
  fi
else log "STREAM skipped (needs gcc and internet)"; fi

# ---------- disk: dd sequential 1 MB blocks, direct I/O ----------
DISK_DIR="${DISK_DIR:-$HOME}"; log "== Disk (dd, 1 GB, direct I/O, in $DISK_DIR)"
F="$DISK_DIR/.inkbench.tmp"
w=$(dd if=/dev/zero of="$F" bs=1M count=1024 oflag=direct conv=fsync 2>&1 | tail -1)
r=$(dd if="$F" of=/dev/null bs=1M iflag=direct 2>&1 | tail -1); rm -f "$F"
mbs() { echo "$1" | awk -F', ' '{s=$NF; split(s,a," "); v=a[1]; u=a[2]; if(u ~ /^GB/) v*=1000; if(u ~ /^kB/) v/=1000; if (u ~ /GiB/) v*=1073.7; if (u ~ /MiB/) v*=1.0486; print v}'; }
met disk.seqWrite "$(mbs "$w")" "dd 1 GB write, oflag=direct"; met disk.seqRead "$(mbs "$r")" "dd 1 GB read, iflag=direct"

# ---------- network ----------
if have curl; then
  log "== Network (speed.cloudflare.com)"
  lat=$(for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w '%{time_connect}\n' https://speed.cloudflare.com/__down?bytes=0; done | sort -n | sed -n 3p)
  met net.latency "$(echo "$lat * 1000" | bc)" "TCP connect, median of 6"
  d=$(curl -s -o /dev/null -w '%{speed_download} %{time_starttransfer}' "https://speed.cloudflare.com/__down?bytes=50000000")
  met net.download "$(echo "$(echo $d | cut -d' ' -f1) * 8 / 1000000" | bc -l | cut -c1-7)" "50 MB from speed.cloudflare.com"
  met net.ttfb "$(echo "$(echo $d | cut -d' ' -f2) * 1000" | bc | cut -d. -f1)" ""
fi

# ---------- GPU: glmark2 (only if installed and a display exists) ----------
if have glmark2 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  log "== glmark2 (~2 min)"
  g=$(glmark2 2>&1 | tee -a "$LOG" | awk -F': ' '/glmark2 Score/{print $2}' | tr -dc 0-9)
  met gfx.glmark2 "$g" "glmark2 score"
else log "glmark2 not installed or no display: GPU skipped (sudo apt install glmark2)"; fi

# ---------- stress: 5 min of 7-Zip on all threads, sampled every 10 s, with CPU temperature ----------
SER=""; TEMPS=""
temp() { local m=0 t; for z in /sys/class/thermal/thermal_zone*/temp /sys/class/hwmon/hwmon*/temp1_input; do [ -r "$z" ] || continue; t=$(cat "$z" 2>/dev/null); [ "${t:-0}" -gt "$m" ] && m=$t; done; [ "$m" -gt 0 ] && echo $((m / 1000)); }
if [ "${STRESS:-1}" != 0 ] && { [ -x ./smallpt ] || [ -n "$Z" ]; }; then
  if [ -x ./smallpt ]; then UNIT="k samples/s (smallpt, same work as the browser stress)"; one() { ./smallpt 9 | cut -d' ' -f1 | cut -d. -f1; }
  else UNIT="7-Zip MIPS"; one() { zrate 1; }; fi
  log "== Stress 5 min ($UNIT, all threads)"
  s0=$(date +%s); next=$((s0 + 10)); acc=0; n=0
  while [ $(( $(date +%s) - s0 )) -lt 300 ]; do
    r=$(one); [ -n "$r" ] && { acc=$((acc + r)); n=$((n + 1)); }
    if [ "$(date +%s)" -ge "$next" ] && [ "$n" -gt 0 ]; then
      v=$((acc / n)); SER="$SER$v,"; tc=$(temp); TEMPS="$TEMPS${tc:-null},"
      log "  t=$(( $(date +%s) - s0 ))s $v $UNIT · CPU ${tc:-?} °C"; acc=0; n=0; next=$((next + 10))
    fi
  done
  SER=${SER%,}; TEMPS=${TEMPS%,}
  keep=$(echo "$SER" | awk -F, '{if(NF<4){print "";exit} s=($1+$2)/2; e=($NF+$(NF-1)+$(NF-2))/3; printf "%.1f", e/s*100}')
  met stress.cpu "$keep" "$UNIT start $(echo $SER | cut -d, -f1) · end ${SER##*,} · temp $(echo $TEMPS | cut -d, -f1) to ${TEMPS##*,} °C"
fi

# ---------- result ----------
LABEL="Native · ${OS%% *}$WSL · ${CPU:-$ARCH}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
OUT="$OUT_DIR/inkbench-native-linux-$(hostname | tr -cd 'a-zA-Z0-9-')-$(date +%Y%m%d-%H%M).json"
cat > "$OUT" <<J
{"kind":"inkbench","version":"native-$VER","date":"$NOW","label":"$(js "$LABEL")",
"info":{"browser":"native app","engine":"native (gcc/7-Zip)","os":"$(js "$OS$WSL")","osVersion":"kernel $(js "$KER")","device":"PC","chip":"$(js "$CPU")","arch":"$ARCH","cpuThreads":"$CORES cores / $THR threads, max ${MHZ:-?} MHz","memory":"$(js "$RAM")","gpu":"$(js "${GPU:-?}")","storageQuota":"$(js "${DISK:-?}")"},
"metrics":{${M%,}},
"series":{"step":10,"cpu":[${SER}],"temp":[${TEMPS}]}}
J
cp "$LOG" "${OUT%.json}.log"
log "Saved $OUT"
echo
echo "Result: $OUT"
echo "Log:    ${OUT%.json}.log"
echo "Open https://hub.inkdos.workers.dev/apps/xeos-tests/?bench > Load PDF to compare > pick the .json"
