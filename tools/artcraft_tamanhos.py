#!/usr/bin/env python3
"""Writes artcraft/tamanhos.json: the .wasm of each ArtCraft editor and its size (uncompressed),
used by assets/artcraft-host.js to show the download percentage."""
import glob, json, os
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = {}
for w in sorted(glob.glob(os.path.join(RAIZ, "artcraft", "*", "*_bg.wasm"))):
    out[os.path.basename(os.path.dirname(w))] = {"wasm": os.path.basename(w), "bytes": os.path.getsize(w)}
with open(os.path.join(RAIZ, "artcraft", "tamanhos.json"), "w") as f:
    json.dump(out, f, indent=1)
    f.write("\n")
