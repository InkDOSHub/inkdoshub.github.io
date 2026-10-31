#!/usr/bin/env python3
"""Grava artcraft/tamanhos.json: o .wasm de cada editor ArtCraft e o tamanho dele (sem compressão),
usado por assets/artcraft-host.js para mostrar o percentual do download."""
import glob, json, os
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = {}
for w in sorted(glob.glob(os.path.join(RAIZ, "artcraft", "*", "*_bg.wasm"))):
    out[os.path.basename(os.path.dirname(w))] = {"wasm": os.path.basename(w), "bytes": os.path.getsize(w)}
with open(os.path.join(RAIZ, "artcraft", "tamanhos.json"), "w") as f:
    json.dump(out, f, indent=1)
    f.write("\n")
