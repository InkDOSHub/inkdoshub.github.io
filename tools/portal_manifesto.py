#!/usr/bin/env python3
"""Gera inicio/manifesto.json: a lista de arquivos que o botão "Baixar tudo" guarda para uso offline,
e (chave "idiomas") os arquivos de cada pacote de idioma (assets/idioma.js).

Só o inglês entra na cópia offline. Os arquivos dos outros idiomas (traduções da casca, dos editores
ONLYOFFICE, do Quadro e dos apps do InkDOS) vão para o pacote do idioma, baixado só quando a pessoa
escolhe. Idiomas que o InkDOS Hub não oferece ficam fora dos dois.

Cada grupo (tela inicial, terminal, cada app) pode ser baixado junto; o hash de cada arquivo
permite atualizar só o que mudou. Rode na raiz do repositório depois de mudar qualquer arquivo:
    python3 tools/portal_manifesto.py
"""
import hashlib, json, os, re, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GRUPOS = [
    ("inicio", "Home screen", ["inicio", "assets", "idiomas", "index.html", "manifest.webmanifest", "sw-portal.js", "desktop/index.html"]),
    ("terminal", "Linux terminal", ["terminal"]),
    ("foto", "Photos", ["apps/foto"]),
    ("video", "Video", ["apps/video"]),
    ("codigo", "Code", ["apps/codigo"]),
    ("quadro", "Whiteboard", ["apps/quadro"]),
    ("musica", "Music", ["apps/musica"]),
    ("gravador", "Recorder", ["apps/gravador"]),
    ("transferir", "Transfer", ["apps/transferir"]),
    ("webcam", "Webcam", ["apps/webcam"]),
    ("inkdos", "Documents (InkDOS)", ["inkdos"]),
    ("onlyoffice", "ONLYOFFICE editors", ["onlyoffice"]),
    ("visualizadores", "Viewers and PDF tools (BentoPDF)", ["visualizadores"]),
]
FORA = {"inicio/manifesto.json"}
# o editor de vídeo depende do coi-serviceworker dele e não passa pelo portal, então fica de fora da cópia
FORA_PASTAS = ()
FORA_EXT = (".md", ".txt", ".map")

# pacotes de idioma: o nome que cada ferramenta usa -> código do InkDOS Hub
PACOTES = ["pt-BR", "es", "de", "fr", "zh-CN", "ja", "ru"]
ONLYOFFICE = {"en": "en", "pt": "pt-BR", "pt-br": "pt-BR", "es": "es", "de": "de", "fr": "fr", "zh": "zh-CN", "ja": "ja", "ru": "ru"}
EXCALIDRAW = {"en": "en", "pt-BR": "pt-BR", "es-ES": "es", "de-DE": "de", "fr-FR": "fr", "zh-CN": "zh-CN", "ja-JP": "ja", "ru-RU": "ru"}
REGRAS = [
    (re.compile(r"^idiomas/([A-Za-z-]+)\.json$"), lambda x: x if x in PACOTES else "outro"),
    (re.compile(r"^onlyoffice/web-apps/apps/[a-z]+/(?:main|embed|forms)/locale/([a-z-]+)\.json$"), lambda x: ONLYOFFICE.get(x, "outro")),
    (re.compile(r"^onlyoffice/web-apps/apps/spreadsheeteditor/main/resources/formula-lang/([a-z-]+?)(?:_desc)?\.json$"), lambda x: ONLYOFFICE.get(x, "outro")),
    (re.compile(r"^apps/quadro/assets/([a-z]{2,3}(?:-[A-Z]{2,3})?)-[A-Z0-9]{8}-[A-Z0-9]{8}\.js$"), lambda x: EXCALIDRAW.get(x, "outro")),
    (re.compile(r"^inkdos/shared/localization/locales/([A-Za-z-]+)\.js$"), lambda x: x if x in PACOTES else "outro"),
    (re.compile(r"^onlyoffice/shared/localization/locales/([A-Za-z-]+)\.js$"), lambda x: "outro"),
]

def idioma_de(rel):
    """None: não é arquivo de idioma; "en": fica no site e na cópia offline; outro código: vai para o pacote."""
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
            if rel in FORA or rel.startswith(FORA_PASTAS) or n.startswith(".") or n.endswith(FORA_EXT):
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
                h = hashlib.sha256(dados).hexdigest()[:16]
                idioma = idioma_de(rel)
                if idioma in idiomas:
                    idiomas[idioma].append([rel, len(dados), h])
                if idioma not in (None, "en"):
                    continue
                total.update(rel.encode() + b"\0" + h.encode())
                lista.append([rel, len(dados), h])
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
    print("versão", saida["versao"])

if __name__ == "__main__":
    sys.exit(main())
