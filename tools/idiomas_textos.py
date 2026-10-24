#!/usr/bin/env python3
"""Lista os textos da interface do InkDOS Hub (em inglês) e confere os pacotes de idioma.

O texto em inglês é a chave da tradução (assets/idioma.js). Ele vem de:
- HTML: o texto dentro de <body data-idioma> e os atributos title, aria-label, placeholder e alt
  (fora de script, style, textarea e [data-idioma-nao]), mais o <title>;
- JavaScript: as chamadas t("...") e InkIdioma.t("...") com texto literal.

Uso, na raiz do repositório:
    python3 tools/idiomas_textos.py            # grava tools/idiomas-textos.json e confere idiomas/*.json
    python3 tools/idiomas_textos.py --limpar   # também tira dos pacotes as chaves que não existem mais
Sai com erro se faltar tradução em algum pacote.
"""
import html.parser, json, os, re, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASTAS = ["index.html", "inicio", "assets", "desktop", "terminal", "apps", "idiomas-extra"]
FORA = ("terminal/vendor/", "terminal/images/", "apps/codigo/vscode/", "apps/codigo/ext/", "apps/foto/app/",
        "apps/quadro/assets/", "apps/quadro/fonts/", "apps/quadro/src/", "apps/wine/boxedwine/", "apps/wine/area/",
        "apps/video/cortar/ffmpeg-core/", "apps/video/cortar/coi-serviceworker")
ATRIBUTOS = {"title", "aria-label", "placeholder", "alt"}
PULAR = {"script", "style", "textarea"}
VAZIOS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
JS_T = re.compile(r'(?<![\w$.])(?:InkIdioma\.)?t\(\s*"((?:[^"\\\n]|\\.)*)"')


def arquivos():
    for c in PASTAS:
        p = os.path.join(RAIZ, c)
        if os.path.isfile(p):
            yield c
            continue
        for d, pastas, nomes in os.walk(p):
            pastas.sort()
            for n in sorted(nomes):
                rel = os.path.relpath(os.path.join(d, n), RAIZ).replace(os.sep, "/")
                if rel.startswith(FORA) or not rel.endswith((".html", ".js")):
                    continue
                yield rel


class Html(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.pilha = []  # (tag, traduz, pula)
        self.textos = []
        self.titulo = False

    def estado(self):
        return self.pilha[-1][1:] if self.pilha else (False, False)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        traduz, pula = self.estado()
        traduz = traduz or "data-idioma" in a
        pula = pula or tag in PULAR or "data-idioma-nao" in a
        if tag == "title":
            self.titulo = True
        if traduz and not pula:
            for k, v in attrs:
                if k in ATRIBUTOS and v and v.strip():
                    self.textos.append(v)
        if tag not in VAZIOS:
            self.pilha.append((tag, traduz, pula))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VAZIOS and self.pilha and self.pilha[-1][0] == tag:
            self.pilha.pop()

    def handle_endtag(self, tag):
        if tag == "title":
            self.titulo = False
        for i in range(len(self.pilha) - 1, -1, -1):
            if self.pilha[i][0] == tag:
                del self.pilha[i:]
                break

    def handle_data(self, d):
        s = d.strip()
        if not s:
            return
        if self.titulo:
            self.textos.append(s)
            return
        traduz, pula = self.estado()
        if traduz and not pula:
            self.textos.append(s)


def textos():
    vistos, avisos = {}, []
    for rel in arquivos():
        s = open(os.path.join(RAIZ, rel), encoding="utf-8").read()
        achados = []
        if rel.endswith(".html"):
            if "data-idioma" in s:
                h = Html()
                h.feed(s)
                achados += h.textos
            for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", s, re.S):
                achados += [json.loads('"' + x + '"') for x in JS_T.findall(m.group(1))]
        else:
            achados += [json.loads('"' + x + '"') for x in JS_T.findall(s)]
        for x in achados:
            if "\n" in x:
                avisos.append(f"{rel}: texto com quebra de linha: {x[:60]!r}")
            if not re.search(r"[A-Za-z]", x):
                continue  # só símbolos ou números
            vistos.setdefault(x, rel)
    return vistos, avisos


def main():
    vistos, avisos = textos()
    chaves = sorted(vistos)
    with open(os.path.join(RAIZ, "tools", "idiomas-textos.json"), "w", encoding="utf-8") as f:
        json.dump({k: vistos[k] for k in chaves}, f, ensure_ascii=False, indent=1)
    for a in avisos:
        print("aviso:", a)
    print(len(chaves), "textos")
    erro = False
    pasta = os.path.join(RAIZ, "idiomas")
    for n in sorted(os.listdir(pasta)) if os.path.isdir(pasta) else []:
        if not n.endswith(".json"):
            continue
        p = os.path.join(pasta, n)
        pacote = json.load(open(p, encoding="utf-8"))
        t = pacote.get("textos", {})
        falta = [k for k in chaves if k not in t]
        sobra = [k for k in t if k not in vistos]
        print(f"{n}: faltam {len(falta)}, sobram {len(sobra)}")
        for k in falta[:20]:
            print("   falta:", k)
        if "--limpar" in sys.argv and sobra:
            for k in sobra:
                del t[k]
            with open(p, "w", encoding="utf-8") as f:
                json.dump(pacote, f, ensure_ascii=False, indent=0, sort_keys=True)
        erro = erro or bool(falta)
    return 1 if erro else 0


if __name__ == "__main__":
    sys.exit(main())
