#!/usr/bin/env python3
"""Gera inicio/manifesto.json: a lista de arquivos que o botão "Baixar tudo" guarda para uso offline.

Cada grupo (tela inicial, terminal, cada app) pode ser baixado junto; o hash de cada arquivo
permite atualizar só o que mudou. Rode na raiz do repositório depois de mudar qualquer arquivo:
    python3 tools/portal_manifesto.py
"""
import hashlib, json, os, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GRUPOS = [
    ("inicio", "Tela inicial", ["inicio", "assets", "index.html", "sw-portal.js", "desktop/index.html"]),
    ("terminal", "Linux terminal", ["terminal"]),
    ("foto", "Fotos", ["apps/foto"]),
    ("video", "Vídeo", ["apps/video"]),
    ("codigo", "Código", ["apps/codigo"]),
    ("quadro", "Quadro branco", ["apps/quadro"]),
    ("musica", "Música", ["apps/musica"]),
    ("wine", "Wine (teste)", ["apps/wine"]),
]
FORA = {"inicio/manifesto.json"}
# o editor de vídeo depende do coi-serviceworker dele e não passa pelo portal, então fica de fora da cópia
FORA_PASTAS = ("apps/video/editor/",)
FORA_EXT = (".md", ".txt", ".map")

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
    for gid, nome, caminhos in GRUPOS:
        lista = []
        for c in caminhos:
            if not os.path.exists(os.path.join(RAIZ, c)):
                continue
            for rel in arquivos(c):
                dados = open(os.path.join(RAIZ, rel), "rb").read()
                h = hashlib.sha256(dados).hexdigest()[:16]
                total.update(rel.encode() + b"\0" + h.encode())
                lista.append([rel, len(dados), h])
        saida["grupos"].append({"id": gid, "nome": nome, "bytes": sum(a[1] for a in lista), "arquivos": lista})
    saida["versao"] = total.hexdigest()[:16]
    with open(os.path.join(RAIZ, "inicio", "manifesto.json"), "w") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
    for g in saida["grupos"]:
        print(f'{g["id"]:10} {len(g["arquivos"]):5} arquivos {g["bytes"]/1e6:8.1f} MB')
    print("versão", saida["versao"])

if __name__ == "__main__":
    sys.exit(main())
