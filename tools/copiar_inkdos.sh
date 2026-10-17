#!/bin/sh
# Atualiza a cópia dos apps do InkDOS em inkdos/ a partir de um clone do InkDOS.
# Uso: tools/copiar_inkdos.sh /caminho/do/InkDOS
set -e
ORIGEM=${1:?caminho do clone do InkDOS}
RAIZ=$(cd "$(dirname "$0")/.." && pwd)
COMMIT=$(git -C "$ORIGEM" rev-parse --short HEAD)
cd "$RAIZ/inkdos"
find . -mindepth 1 -maxdepth 1 ! -name index.html ! -name UPSTREAM-SOURCE.txt -exec rm -rf {} +
git -C "$ORIGEM" archive HEAD apps shared assets licenses LICENSE VERSION.json | tar -x
sed -i "s/commit [0-9a-f]\{7,\} ([0-9-]*)/commit $COMMIT ($(date +%F))/" UPSTREAM-SOURCE.txt
echo "inkdos/ atualizado para o commit $COMMIT"
