#!/bin/sh
# Recria as ferramentas de apps/ a partir das versões fixadas abaixo.
# Precisa de node, npm e git. Cada pasta leva UPSTREAM-LICENSE.txt e UPSTREAM-SOURCE.txt.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=${WORK:-$(mktemp -d)}
cd "$WORK"
npm init -y >/dev/null
npm i -s vscode-web@1.91.1 @excalidraw/excalidraw@0.18.1 react@18.3.1 react-dom@18.3.1 esbuild@0.25

# Fotos: galeria e editor são nossos (apps/foto/), sem ferramenta de fora

# Música: não usa ferramenta de fora (apps/musica é do InkTerminal)

# Vídeo: o player e o editor (apps/video/cortar/) são nossos; só o ffmpeg.wasm vem de fora
mkdir -p vdeps && (cd vdeps && npm init -y >/dev/null && npm i -s --ignore-scripts @ffmpeg/core@0.12.5)
mkdir -p "$ROOT/apps/video/cortar/ffmpeg-core"
cp vdeps/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js vdeps/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm "$ROOT/apps/video/cortar/ffmpeg-core/"

# Quadro branco: Excalidraw empacotado com apps/quadro/src/main.jsx
mkdir -p exsrc && cp "$ROOT/apps/quadro/src/main.jsx" exsrc/
rm -rf "$ROOT/apps/quadro/assets" "$ROOT/apps/quadro/fonts"
npx esbuild exsrc/main.jsx --bundle --format=esm --splitting --minify --outdir="$ROOT/apps/quadro/assets" \
  --define:process.env.NODE_ENV='"production"' --define:process.env.IS_PREACT='"false"' \
  --loader:.woff2=file --loader:.ttf=file --log-level=warning
cp -r node_modules/@excalidraw/excalidraw/dist/prod/fonts "$ROOT/apps/quadro/fonts"

# Código: VS Code para web, sem mudanças (sem os .map)
rm -rf "$ROOT/apps/codigo/vscode"; mkdir -p "$ROOT/apps/codigo/vscode"
D=node_modules/vscode-web/dist
cp -r $D/out $D/node_modules $D/extensions $D/code-192.png $D/favicon.ico "$ROOT/apps/codigo/vscode/"
find "$ROOT/apps/codigo/vscode" -name "*.map" -delete
echo "OK"
