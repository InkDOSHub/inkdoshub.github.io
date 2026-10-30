#!/usr/bin/env python3
"""Gera windows/ferramentas.json: o catálogo de ferramentas que o InkDOS Hub para Windows (windows/hub/) baixa.

Cada ferramenta vem só da fonte oficial do projeto. O SHA-256 é o publicado pela fonte (API do VS Code, lista do
Alpine, "digest" das releases do GitHub). Quando a fonte não publica um, o arquivo é baixado aqui e o hash é
calculado. O app confere o SHA-256 antes de instalar e, quando há, a assinatura digital do fabricante.
Roda na action windows-hub.yml (toda semana e a cada mudança). Uso: python3 tools/windows_ferramentas.py
"""
import hashlib, json, os, re, sys, urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "windows", "ferramentas.json")
TOKEN = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")


def pegar(url, json_=True):
    req = urllib.request.Request(url, headers={"User-Agent": "InkDOSHub-catalogo"})
    if TOKEN and url.startswith("https://api.github.com/"):
        req.add_header("Authorization", "Bearer " + TOKEN)
    with urllib.request.urlopen(req, timeout=60) as r:
        dados = r.read()
    return json.loads(dados) if json_ else dados


def sha_e_tamanho(url):
    h, n = hashlib.sha256(), 0
    req = urllib.request.Request(url, headers={"User-Agent": "InkDOSHub-catalogo"})
    with urllib.request.urlopen(req, timeout=600) as r:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            h.update(b)
            n += len(b)
    return h.hexdigest(), n


def github(repo, padrao):
    rel = pegar("https://api.github.com/repos/%s/releases/latest" % repo)
    for a in rel["assets"]:
        if re.search(padrao, a["name"], re.I):
            sha = (a.get("digest") or "").replace("sha256:", "")
            tam = a["size"]
            if not re.fullmatch(r"[0-9a-f]{64}", sha):
                sha, tam = sha_e_tamanho(a["browser_download_url"])
            return {"versao": rel["tag_name"].lstrip("v"), "url": a["browser_download_url"], "sha256": sha, "baixar": tam,
                    "pagina": rel["html_url"]}
    raise RuntimeError("%s: nenhum arquivo combina com %s" % (repo, padrao))


def vscode():
    v = pegar("https://update.code.visualstudio.com/api/update/win32-x64-archive/stable/latest")
    req = urllib.request.Request(v["url"], method="HEAD", headers={"User-Agent": "InkDOSHub-catalogo"})
    with urllib.request.urlopen(req, timeout=60) as r:
        tam = int(r.headers.get("Content-Length") or 0)
    return {"versao": v["productVersion"], "url": v["url"], "sha256": v["sha256hash"], "baixar": tam,
            "pagina": "https://code.visualstudio.com/"}


def alpine():
    base = "https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/"
    txt = pegar(base + "latest-releases.yaml", json_=False).decode()
    bloco = [b for b in txt.split("\n-\n") if "flavor: alpine-minirootfs" in b][0]
    arq = re.search(r"file: (\S+)", bloco).group(1)
    return {"versao": re.search(r"version: (\S+)", bloco).group(1),
            "url": base + arq, "sha256": re.search(r"sha256: ([0-9a-f]{64})", bloco).group(1),
            "baixar": int(re.search(r"size: (\d+)", bloco).group(1)), "pagina": "https://alpinelinux.org/"}


def nosso(tag, arq):
    """Apps do próprio InkDOS Hub (windows/webcam, windows/transferir): a release publica o .sha256 ao lado."""
    url = "https://github.com/InkDOSHub/inkdoshub.github.io/releases/download/%s/%s" % (tag, arq)
    sha = pegar(url + ".sha256", json_=False).decode().split()[0].lower()
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "InkDOSHub-catalogo"})
    with urllib.request.urlopen(req, timeout=60) as r:
        tam = int(r.headers.get("Content-Length") or 0)
    return {"versao": sha[:12], "url": url, "sha256": sha, "baixar": tam,
            "pagina": "https://github.com/InkDOSHub/inkdoshub.github.io/tree/main/windows"}


# id, nome, quem publica, licença, tipo, instalado (MB, aproximado), assinante esperado (Authenticode) ou None,
# o que acessa, como achar a versão mais nova
FERRAMENTAS = [
    ("linux", "Linux (Alpine no WSL)", "Alpine Linux", "MIT e outras (pacotes do Alpine)", "wsl", 10, None,
     "Roda isolado no WSL do Windows; vê as pastas do Windows em /mnt/c.", alpine),
    ("vscode", "VS Code", "Microsoft Corporation", "MIT (código) / licença do produto Microsoft", "zip", 1000,
     "Microsoft Corporation", "Abre as pastas que você escolher; extensões só se você instalar.", vscode),
    ("zed", "Zed (editor leve)", "Zed Industries", "GPL-3.0 / Apache-2.0", "instalador", 170, "Zed Industries",
     "Abre as pastas que você escolher.", lambda: github("zed-industries/zed", r"^zed.*x86_64.*\.exe$")),
    ("onlyoffice", "ONLYOFFICE Desktop", "Ascensio System SIA", "AGPL-3.0", "instalador", 650, "Ascensio System SIA",
     "Abre os documentos que você escolher.", lambda: github("ONLYOFFICE/DesktopEditors", r"^DesktopEditors_x64\.exe$")),
    ("qpdf", "Ferramentas de PDF (qpdf)", "qpdf (Jay Berkenbilt e colaboradores)", "Apache-2.0", "zip", 30, None,
     "Só os PDFs que você escolher.", lambda: github("qpdf/qpdf", r"^qpdf-[\d.]+-msvc64\.zip$")),
    ("ghostscript", "Comprimir PDF (Ghostscript)", "Artifex Software", "AGPL-3.0", "instalador", 100, "Artifex Software",
     "Só os PDFs que você escolher.", lambda: github("ArtifexSoftware/ghostpdl-downloads", r"^gs\d+w64\.exe$")),
    ("ffmpeg", "Cortar vídeo (ffmpeg)", "Gyan Doshi (build oficial do ffmpeg.org)", "GPL-3.0", "zip", 200, None,
     "Só os vídeos que você escolher.", lambda: github("GyanD/codexffmpeg", r"essentials_build\.zip$")),
    ("webcam", "InkDOS Hub Webcam", "InkDOS Hub", "MIT", "zip", 60, None,
     "A câmera do celular que você parear, pela rede local.", lambda: nosso("webcam-windows", "InkDOSHub-Webcam-Windows.zip")),
    ("transferir", "InkDOS Hub Transferir", "InkDOS Hub", "MIT", "exe", 1, None,
     "Os arquivos que você mandar entre o PC e o celular pareado.", lambda: nosso("transferir-windows", "InkDOSHub-Transferir.exe")),
]


def main():
    velho = {}
    if os.path.exists(SAIDA):
        try:
            velho = {f["id"]: f for f in json.load(open(SAIDA, encoding="utf-8"))["ferramentas"]}
        except Exception:
            pass
    saida = {"formato": 1, "ferramentas": []}
    erros = 0
    for fid, nome, editor, lic, tipo, inst, assinante, acesso, achar in FERRAMENTAS:
        try:
            info = achar()
        except Exception as e:  # fonte fora do ar: mantém a entrada anterior
            print("aviso: %s: %s" % (fid, e), file=sys.stderr)
            erros += 1
            if fid in velho:
                saida["ferramentas"].append(velho[fid])
            continue
        item = {"id": fid, "nome": nome, "publica": editor, "licenca": lic, "tipo": tipo, "instalado_mb": inst,
                "assinante": assinante, "acesso": acesso}
        item.update(info)
        saida["ferramentas"].append(item)
        print("%-12s %-12s %7.1f MB  %s" % (fid, item["versao"], item["baixar"] / 1e6, item["sha256"][:16]))
    with open(SAIDA, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, indent=1)
        f.write("\n")
    return 1 if erros == len(FERRAMENTAS) else 0


if __name__ == "__main__":
    sys.exit(main())
