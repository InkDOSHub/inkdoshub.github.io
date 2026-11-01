#!/bin/sh
# Copies the ArtCraft icon sources next to the exporter (run from this folder).
set -e
for a in wordcraft gridcraft deckcraft; do
  rm -rf /tmp/ac-$a && git clone -q --depth 1 --filter=blob:none --no-checkout https://github.com/storytold/$a /tmp/ac-$a
  (cd /tmp/ac-$a && git checkout -q HEAD -- crates/ui-egui/src/icons.rs $( [ $a = deckcraft ] && echo crates/ui-egui/src/icons ))
done
mkdir -p src/wc src/gc src/dcm/icons
# WordCraft: drop the Insert › Icons library painter (needs wordcraft_render)
sed '/^\/\/\/ Draw an Insert › Icons library icon/,$d' /tmp/ac-wordcraft/crates/ui-egui/src/icons.rs > src/wc/icons.rs
cp /tmp/ac-gridcraft/crates/ui-egui/src/icons.rs src/gc/icons.rs
cp /tmp/ac-deckcraft/crates/ui-egui/src/icons.rs src/dcm/icons.rs && cp /tmp/ac-deckcraft/crates/ui-egui/src/icons/*.rs src/dcm/icons/
sed -i 's#^mod draw;#\#[path = "icons/draw.rs"] mod draw;#; s#^mod geometry;#\#[path = "icons/geometry.rs"] mod geometry;#' src/dcm/icons.rs
python3 - <<'PY'
import re
s=open('src/wc/icons.rs').read();names=[]
for line in s.splitlines():
    m=re.match(r'\s*((?:"[A-Za-z0-9.]+"\s*\|\s*)*"[A-Za-z0-9.]+")\s*=>',line)
    if m:
        for n in re.findall(r'"([A-Za-z0-9.]+)"',m.group(1)):
            if n not in names: names.append(n)
open('src/wc/names.txt','w').write("\n".join(names))
s=open('src/gc/icons.rs').read();b=s[s.index('pub enum Icon {'):];b=b[:b.index('\n}')]
vs=re.findall(r'^\s*([A-Z][A-Za-z0-9]*)\s*,',b,re.M)
open('src/gc/all.rs','w').write('pub const ALL: &[crate::icons::Icon] = &['+','.join('crate::icons::Icon::'+v for v in vs)+'];\npub const NAMES: &[&str] = &['+','.join('"%s"'%v for v in vs)+'];\n')
PY
echo 'fn main() {}' > src/main.rs
