#!/usr/bin/env python3
"""Adds a Content-Security-Policy to each ArtCraft editor page (artcraft/<app>/index.html).

The editors run in an iframe of the Hub page (apps/<app>/). The policy lets them run their own code and
WebAssembly from this site only, and blocks any network request to other servers, so a document (or a bug in
the editor) cannot send data out. The inline module script that trunk writes is allowed by its SHA-256.
Run by .github/workflows/artcraft.yml after each download; running it twice is harmless.
"""
import base64, glob, hashlib, os, re

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POL = ("default-src 'self'; script-src 'self' {h} 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; "
       "frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")

for f in sorted(glob.glob(os.path.join(RAIZ, "artcraft", "*", "index.html"))):
    s = open(f, encoding="utf-8").read()
    s = re.sub(r'\s*<meta http-equiv="Content-Security-Policy"[^>]*>', "", s)
    h = " ".join("'sha256-%s'" % base64.b64encode(hashlib.sha256(m.encode()).digest()).decode()
                 for m in re.findall(r"<script[^>]*>(.*?)</script>", s, re.S) if m.strip())
    meta = '<meta http-equiv="Content-Security-Policy" content="%s">' % POL.format(h=h)
    s, n = re.subn(r'(<meta charset="utf-8">)', r"\1\n  " + meta.replace("\\", "\\\\"), s, count=1, flags=re.I)
    if not n:
        raise SystemExit("no <meta charset> in " + f)
    open(f, "w", encoding="utf-8").write(s)
    print(os.path.relpath(f, RAIZ))
