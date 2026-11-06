#!/usr/bin/env python3
"""Builds inicio/manifesto.json: the list of files the home screen "Offline" button stores on this device,
and ("idiomas" key) the files of each language pack (assets/idioma.js).

Only English goes into the offline copy. The files of the other languages (shell translations,
Whiteboard and InkDOS apps) go into the language pack, downloaded only when the person
picks it. Languages InkDOS Hub does not offer stay out of both.

Each group (home screen, terminal, each app) can be downloaded together. Each file is [path, bytes,
short number (first 16 digits of the SHA-256, to know what changed), full SHA-256 (the Windows app
checks each downloaded file against it)]. Run at the repository root after changing any file:
    python3 tools/portal_manifesto.py
"""
import hashlib, json, os, re, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GRUPOS = [
    ("inicio", "Home screen", ["inicio", "assets", "idiomas", "index.html", "manifest.webmanifest", "sw-portal.js", "desktop/index.html"]),
    ("terminal", "Linux terminal", ["terminal"]),
    ("wine", "Wine", ["apps/wine"]),
    ("zip", "Zip", ["apps/zip"]),
    ("wasm", "Wasm Build", ["apps/wasm"]),
    ("foto", "Photos", ["apps/foto"]),
    ("video", "Video", ["apps/video"]),
    ("codigo", "Code", ["apps/codigo"]),
    ("quadro", "Whiteboard", ["apps/quadro"]),
    ("musica", "Music", ["apps/musica"]),
    ("gravador", "Recorder", ["apps/gravador"]),
    ("transferir", "Transfer", ["apps/transferir"]),
    ("webcam", "Webcam", ["apps/webcam"]),
    ("inkdos", "Documents (InkDOS)", ["inkdos"]),
    ("artcraft", "ArtCraft editors", ["artcraft", "apps/wordcraft", "apps/gridcraft", "apps/deckcraft"]),
    ("visualizadores", "Edit PDF (BentoPDF) and viewers", ["apps/editar-pdf", "visualizadores"]),
    # heavy Edit PDF engines: the basic offline set stays under 100 MB, the rest is the "full package"
    ("pdf-completo", "Edit PDF: full pack (Office, OCR, compress)", [
        "visualizadores/bentopdf/libreoffice-wasm", "visualizadores/bentopdf/wasm/pymupdf",
        "visualizadores/bentopdf/wasm/ocr", "visualizadores/bentopdf/wasm/gs"]),
]
# a path listed in another group leaves the parent folder's group
DONO = {c: g for g, _, cs in GRUPOS for c in cs}
FORA = {"inicio/manifesto.json"}
FORA_EXT = (".md", ".txt", ".map")

# language packs: the name each tool uses -> InkDOS Hub code
PACOTES = ["pt-BR", "es", "de", "fr", "zh-CN", "ja", "ru"]
EXCALIDRAW = {"en": "en", "pt-BR": "pt-BR", "es-ES": "es", "de-DE": "de", "fr-FR": "fr", "zh-CN": "zh-CN", "ja-JP": "ja", "ru-RU": "ru"}
REGRAS = [
    (re.compile(r"^idiomas/([A-Za-z-]+)\.json$"), lambda x: x if x in PACOTES else "outro"),
    (re.compile(r"^apps/quadro/assets/([a-z]{2,3}(?:-[A-Z]{2,3})?)-[A-Z0-9]{8}-[A-Z0-9]{8}\.js$"), lambda x: EXCALIDRAW.get(x, "outro")),
    (re.compile(r"^inkdos/shared/localization/locales/([A-Za-z-]+)\.js$"), lambda x: x if x in PACOTES else "outro"),
]

def idioma_de(rel):
    """None: not a language file; "en": stays on the site and in the offline copy; other code: goes into the pack."""
    for r, f in REGRAS:
        m = r.match(rel)
        if m:
            return f(m.group(1))
    return None

def arquivos(caminho):
    p = os.path.join(RAIZ, caminho)
    if os.path.isfile(p):
        yield caminho
        return
    for d, pastas, nomes in os.walk(p):
        pastas.sort()
        for n in sorted(nomes):
            rel = os.path.relpath(os.path.join(d, n), RAIZ).replace(os.sep, "/")
            if rel in FORA or n.startswith(".") or n.endswith(FORA_EXT):
                continue
            # x.br / x.gz next to x: copy for servers that send compressed files (Pages does not), never loaded
            if n.endswith((".br", ".gz")) and os.path.isfile(os.path.join(d, n[:-3])):
                continue
            if any(rel.startswith(c + "/") and DONO[c] != DONO.get(caminho) and len(c) > len(caminho) for c in DONO):
                continue
            yield rel

def main():
    total = hashlib.sha256()
    saida = {"grupos": []}
    idiomas = {c: [] for c in PACOTES}
    for gid, nome, caminhos in GRUPOS:
        lista = []
        for c in caminhos:
            if not os.path.exists(os.path.join(RAIZ, c)):
                continue
            for rel in arquivos(c):
                dados = open(os.path.join(RAIZ, rel), "rb").read()
                sha = hashlib.sha256(dados).hexdigest()
                h = sha[:16]
                idioma = idioma_de(rel)
                if idioma in idiomas:
                    idiomas[idioma].append([rel, len(dados), h, sha])
                if idioma not in (None, "en"):
                    continue
                total.update(rel.encode() + b"\0" + h.encode())
                lista.append([rel, len(dados), h, sha])
        saida["grupos"].append({"id": gid, "nome": nome, "bytes": sum(a[1] for a in lista), "arquivos": lista})
    saida["versao"] = total.hexdigest()[:16]
    saida["idiomas"] = {}
    for c, lista in idiomas.items():
        if not any(a[0] == f"idiomas/{c}.json" for a in lista):
            sys.exit(f"falta idiomas/{c}.json")
        v = hashlib.sha256("".join(a[0] + a[2] for a in lista).encode()).hexdigest()[:16]
        saida["idiomas"][c] = {"bytes": sum(a[1] for a in lista), "versao": v, "arquivos": lista}
    with open(os.path.join(RAIZ, "inicio", "manifesto.json"), "w") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
    for g in saida["grupos"]:
        print(f'{g["id"]:10} {len(g["arquivos"]):5} arquivos {g["bytes"]/1e6:8.1f} MB')
    for c, p in saida["idiomas"].items():
        print(f'idioma {c:6} {len(p["arquivos"]):5} arquivos {p["bytes"]/1e6:8.2f} MB')
    print("version", saida["versao"])

if __name__ == "__main__":
    sys.exit(main())
