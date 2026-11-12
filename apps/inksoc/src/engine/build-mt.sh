#!/bin/sh
# Multi-core engine (inksoc-mt.wasm): shared memory, one instance per worker.
set -e
cd "$(dirname "$0")"
RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals" \
  cargo +nightly build --release --target wasm32-unknown-unknown -Z build-std=std,panic_abort --target-dir target-mt
cp target-mt/wasm32-unknown-unknown/release/inksoc.wasm ../../inksoc-mt.wasm
