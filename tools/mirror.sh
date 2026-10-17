#!/bin/sh
# Copia os pacotes de alpine-packages.txt (e suas dependências) do repositório
# oficial do Alpine para alpine/<versão>/<repo>/x86/, junto com os APKINDEX
# oficiais (assinados pelo Alpine). Roda no GitHub Actions (precisa de docker).
set -eu
VER=v3.22
ARCH=x86
BASE=https://dl-cdn.alpinelinux.org/alpine
OUT=alpine/$VER
TMP=$(mktemp -d)
rm -rf "$OUT"
for r in main community; do
  mkdir -p "$OUT/$r/$ARCH"
  curl -fsSL "$BASE/$VER/$r/$ARCH/APKINDEX.tar.gz" -o "$OUT/$r/$ARCH/APKINDEX.tar.gz"
done
PKGS=$(grep -v '^\s*#' alpine-packages.txt | tr -s ' \n' ' ')
docker run --rm --platform linux/386 -v "$TMP:/out" "alpine:${VER#v}" sh -c "
  apk update >/dev/null
  for p in $PKGS; do apk fetch --recursive -o /out \$p >/dev/null || echo \"AVISO: \$p nao encontrado\"; done
  chown -R $(id -u):$(id -g) /out"
python3 tools/sort_apks.py "$OUT" "$ARCH" "$TMP"
du -sh "$OUT"
