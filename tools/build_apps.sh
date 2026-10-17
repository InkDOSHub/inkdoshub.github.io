#!/bin/sh
# Recria as ferramentas de apps/ a partir das versões fixadas abaixo.
# Precisa de node, npm e git. Cada pasta leva UPSTREAM-LICENSE.txt e UPSTREAM-SOURCE.txt.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=${WORK:-$(mktemp -d)}
cd "$WORK"
npm init -y >/dev/null
npm i -s vscode-web@1.91.1 @excalidraw/excalidraw@0.18.1 react@18.3.1 react-dom@18.3.1 esbuild@0.25

# Fotos: miniPaint, sem mudanças, em apps/foto/app/ (apps/foto/index.html é nossa)
git clone -q https://github.com/viliusle/miniPaint && (cd miniPaint && git checkout -q a79733eb803fc97084ef0ee4faa96b031e69e1c0)
rm -rf "$ROOT/apps/foto/app"; mkdir -p "$ROOT/apps/foto/app/dist"
cp miniPaint/index.html "$ROOT/apps/foto/app/"
cp miniPaint/dist/bundle.js miniPaint/dist/bundle.js.LICENSE.txt "$ROOT/apps/foto/app/dist/"
cp -r miniPaint/images "$ROOT/apps/foto/app/"
cp miniPaint/MIT-LICENSE.txt "$ROOT/apps/foto/UPSTREAM-LICENSE.txt"
# Única mudança: antes do bundle, um script curto que segue o tema do InkTerminal e escolhe o português
node -e '
const fs=require("fs"),p=process.argv[1];let s=fs.readFileSync(p,"utf8");
const tag="<script src=\"dist/bundle.js\"></script>";
const add=fs.readFileSync(process.argv[2],"utf8");
fs.writeFileSync(p,s.replace(tag,add+tag));' "$ROOT/apps/foto/app/index.html" "$ROOT/tools/minipaint-tema.html"

# Música: não usa ferramenta de fora (apps/musica é do InkTerminal)

# Vídeo: o player é nosso; o editor é o omniclip empacotado sem CDNs (tools/omniclip-build.mjs)
git clone -q https://github.com/omni-media/omniclip omc && (cd omc && git checkout -q cbe581a4a788d9982ffd4a10025c678f9e8707d6 && npm ci --ignore-scripts --no-audit --no-fund && npx tsc)
mkdir -p vdeps && (cd vdeps && npm init -y >/dev/null && npm i -s --ignore-scripts @shoelace-style/shoelace@2.20.0 pixi.js@7.4.2 pixi-filters@5.3.0 \
  @pixi/graphics-extras@7.1.4 @pixi-essentials/object-pool@1.0.1 @pixi-essentials/bounds@3.0.0 @pixi-essentials/transformer@3.0.2 \
  mediainfo.js@0.3.2 opfs-tools@0.7.0 web-demuxer@1.0.5 @ffmpeg/core@0.12.5 coi-serviceworker@0.1.7)
E="$ROOT/apps/video/editor"; V=vdeps/node_modules
mkdir -p keep && cp "$E/index.html" "$E/inkterminal.js" keep/
rm -rf "$E"; mkdir -p "$E/lib/shoelace" "$E/web-demuxer" "$E/ffmpeg-core" "$E/assets"
cp "$ROOT/tools/omniclip-build.mjs" . && node omniclip-build.mjs omc "$V" "$E"
cp keep/index.html keep/inkterminal.js "$E/"
cp -r $V/@shoelace-style/shoelace/cdn/assets $V/@shoelace-style/shoelace/cdn/chunks $V/@shoelace-style/shoelace/cdn/components \
  $V/@shoelace-style/shoelace/cdn/internal $V/@shoelace-style/shoelace/cdn/shoelace.js $V/@shoelace-style/shoelace/cdn/themes \
  $V/@shoelace-style/shoelace/cdn/translations $V/@shoelace-style/shoelace/cdn/utilities "$E/lib/shoelace/"
cp $V/pixi.js/dist/pixi.min.js $V/pixi-filters/dist/browser/pixi-filters.js $V/@pixi/graphics-extras/dist/graphics-extras.min.js \
  $V/@pixi-essentials/object-pool/dist/pixi-object-pool.js $V/@pixi-essentials/bounds/dist/bounds.js \
  $V/@pixi-essentials/transformer/dist/transformer.js "$E/lib/"
cp $V/web-demuxer/dist/wasm-files/ffmpeg.js $V/web-demuxer/dist/wasm-files/ffmpeg.wasm "$E/web-demuxer/"
cp $V/@ffmpeg/core/dist/esm/ffmpeg-core.js $V/@ffmpeg/core/dist/esm/ffmpeg-core.wasm "$E/ffmpeg-core/"
cp $V/coi-serviceworker/coi-serviceworker.js "$E/"
cp $V/mediainfo.js/dist/MediaInfoModule.wasm "$E/assets/"
for f in audio.svg hamburger.svg icon3.png images.svg split.svg text.svg trim.svg loading.svg filter-preview.webp transition-tutorial.mp4; do cp "omc/assets/$f" "$E/assets/"; done
cp -r omc/assets/transitions "$E/assets/"
cp omc/LICENSE "$ROOT/apps/video/UPSTREAM-LICENSE.txt"

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
