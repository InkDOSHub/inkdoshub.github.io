#!/bin/sh
# Builds InkDOS Hub for Linux (EXPERIMENTAL) from the same app as Windows (windows/hub) and the official Electron:
# - newest stable Electron linux-x64 from GitHub electron/electron, checked against their SHASUMS256;
# - trimmed (only en-US/pt-BR locales, no default app);
# - packed as an AppImage (official appimagetool) and a portable .tar.gz.
# Usage: linux/montar.sh <out dir> [version]   (runs in the linux-hub.yml action)
set -eu
SAIDA=$(realpath -m "${1:-saida}"); VERSAO=${2:-}
AQUI=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$SAIDA"; cd "$SAIDA"
AUTH=""; [ -n "${GH_TOKEN:-}" ] && AUTH="Authorization: Bearer $GH_TOKEN"
TAG=$(curl -fsSL ${AUTH:+-H "$AUTH"} 'https://api.github.com/repos/electron/electron/releases?per_page=30' |
  python3 -c 'import json,sys
for r in json.load(sys.stdin):
  n={a["name"] for a in r["assets"]}
  if not r["prerelease"] and not r["draft"] and "electron-%s-linux-x64.zip"%r["tag_name"] in n and "SHASUMS256.txt" in n: print(r["tag_name"]); break')
[ -n "$TAG" ] || { echo "no stable Electron for Linux"; exit 1; }
ZIP="electron-$TAG-linux-x64.zip"; BASE="https://github.com/electron/electron/releases/download/$TAG"
curl -fsSL -o "$ZIP" "$BASE/$ZIP"; curl -fsSL -o SHASUMS256.txt "$BASE/SHASUMS256.txt"
grep " \*\?$ZIP\$" SHASUMS256.txt | sed 's/ \*\?/  /' | sha256sum -c - >/dev/null || { echo "Electron SHA-256 mismatch"; exit 1; }
echo "Electron $TAG (SHA-256 checked)"; echo "ELECTRON_VERSAO=$TAG" >> "${GITHUB_ENV:-/dev/null}"
APP="$SAIDA/InkDOS-Hub"; rm -rf "$APP"; mkdir -p "$APP"
unzip -q "$ZIP" -d "$APP"; rm -f "$ZIP" SHASUMS256.txt
find "$APP/locales" -name '*.pak' ! -name en-US.pak ! -name pt-BR.pak -delete
rm -f "$APP/resources/default_app.asar"
mv "$APP/electron" "$APP/inkdos-hub"
RES="$APP/resources/app"; mkdir -p "$RES"
cp "$AQUI/windows/hub/main.js" "$AQUI/windows/hub/preload.js" "$RES/"
cp "$AQUI/assets/inkdoshub-icone-512.png" "$RES/icone.png"
python3 - "$AQUI/windows/hub/package.json" "$RES/package.json" "$VERSAO" <<'PY'
import json,sys
p=json.load(open(sys.argv[1])); p["description"]="InkDOS Hub for Linux (experimental): the same apps as the website."
if sys.argv[3]: p["version"]=sys.argv[3]
json.dump(p,open(sys.argv[2],"w"),indent=2); print("version",p["version"])
PY
cp "$AQUI/LICENSE" "$APP/LICENSE.InkDOSHub.txt"
# AppImage (one file; the app replaces it in place when it updates)
DIR="$SAIDA/AppDir"; rm -rf "$DIR"; mkdir -p "$DIR"; cp -a "$APP" "$DIR/usr"
cp "$RES/icone.png" "$DIR/inkdos-hub.png"
printf '[Desktop Entry]\nType=Application\nName=InkDOS Hub\nComment=The InkDOS Hub apps, local and without telemetry\nExec=inkdos-hub %%U\nIcon=inkdos-hub\nCategories=Office;Utility;\nTerminal=false\n' > "$DIR/inkdos-hub.desktop"
printf '#!/bin/sh\nHERE=$(dirname "$(readlink -f "$0")")\nexec "$HERE/usr/inkdos-hub" --no-sandbox "$@"\n' > "$DIR/AppRun"; chmod 755 "$DIR/AppRun"
curl -fsSL -o appimagetool https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage; chmod 755 appimagetool
ARCH=x86_64 ./appimagetool --appimage-extract-and-run "$DIR" "$SAIDA/InkDOSHub-Linux-x86_64.AppImage" >/dev/null
tar -C "$SAIDA" -czf "$SAIDA/InkDOSHub-Linux-x86_64.tar.gz" InkDOS-Hub
rm -rf "$DIR" appimagetool
ls -la "$SAIDA"
