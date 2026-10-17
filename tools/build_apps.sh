#!/bin/sh
# Recria as ferramentas de apps/ a partir das versões fixadas abaixo.
# Precisa de node, npm e git. Cada pasta leva UPSTREAM-LICENSE.txt e UPSTREAM-SOURCE.txt.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=${WORK:-$(mktemp -d)}
cd "$WORK"
npm init -y >/dev/null
npm i -s webamp@2.3.1 vscode-web@1.91.1 @excalidraw/excalidraw@0.18.1 react@18.3.1 react-dom@18.3.1 esbuild@0.25

# Fotos: miniPaint, sem mudanças
git clone -q https://github.com/viliusle/miniPaint && (cd miniPaint && git checkout -q a79733eb803fc97084ef0ee4faa96b031e69e1c0)
rm -rf "$ROOT/apps/foto/dist" "$ROOT/apps/foto/images"; mkdir -p "$ROOT/apps/foto/dist"
cp miniPaint/index.html "$ROOT/apps/foto/"
cp miniPaint/dist/bundle.js miniPaint/dist/bundle.js.LICENSE.txt "$ROOT/apps/foto/dist/"
cp -r miniPaint/images "$ROOT/apps/foto/"
cp miniPaint/MIT-LICENSE.txt "$ROOT/apps/foto/UPSTREAM-LICENSE.txt"

# Música: Webamp, sem mudanças (a página index.html é nossa)
cp node_modules/webamp/built/webamp.bundle.min.js "$ROOT/apps/musica/"

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
