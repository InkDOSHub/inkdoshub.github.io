#!/bin/sh
# Rebuilds linux.patch: what engine-src (this app's engine) changes on top of the Windows
# engine it is based on (engine-base.txt, a commit of apps/inksoc/src/engine). Run from apps/alpine.
set -e
base=$(cat engine-base.txt)
tmp=$(mktemp -d)
mkdir -p "$tmp/a"
git -C "$(git rev-parse --show-toplevel)" archive "$base" apps/inksoc/src/engine | tar -x --strip-components=4 -C "$tmp/a"
ln -s "$(pwd)/engine-src" "$tmp/b"
(cd "$tmp" && diff -ruN -x target -x .gitignore -x Cargo.lock a b) > linux.patch || true
rm -rf "$tmp"
echo "linux.patch: $(grep -c '^+++ ' linux.patch) files, $(wc -l < linux.patch) lines (base $base)"
