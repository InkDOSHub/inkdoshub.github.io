#!/usr/bin/env python3
"""Gera os arquivos de teste de desempenho do InkDOS Hub: um simples, um médio e um complexo para cada app.

Saída em testes/arquivos/<nível>/ (fora do git). A action arquivos-teste.yml gera os três níveis e publica na
release "arquivos-teste", de onde o windows/teste-arquivos.bat baixa (assim o clone do repositório não cresce). Os arquivos são sintéticos, mas com a estrutura
de arquivos reais (texto, tabelas, imagens, fórmulas, capítulos), e saem sempre iguais (semente fixa).
Precisa de: python-docx, openpyxl, python-pptx, reportlab, Pillow e ffmpeg (libx264, libmp3lame).
Uso: python3 tools/gerar_arquivos_teste.py [simples|medio|complexo ...]
"""
import io, json, os, random, subprocess, sys, zipfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "testes", "arquivos")
NIVEIS = {
    #            páginas PDF, págs. DOCX, linhas XLSX, slides, KB de texto, capítulos EPUB, foto (px), vídeo, música (s), linhas de código, formas do quadro
    "simples":  dict(pdf=1,   docx=1,   xlsx=50,     pptx=3,  txt=2,     epub=3,   foto=(1600, 1200), video=("1280x720", 10, "2M"),   musica=30,   codigo=200,    quadro=10),
    "medio":    dict(pdf=30,  docx=15,  xlsx=5000,   pptx=20, txt=500,   epub=30,  foto=(4032, 3024), video=("1920x1080", 30, "8M"),  musica=240,  codigo=5000,   quadro=500),
    "complexo": dict(pdf=300, docx=120, xlsx=100000, pptx=80, txt=20000, epub=300, foto=(8064, 6048), video=("3840x2160", 30, "25M"), musica=3600, codigo=100000, quadro=5000),
}
PALAVRAS = ("desempenho memória arquivo documento tabela gráfico relatório projeto equipe resultado análise "
            "processo sistema usuário página texto imagem vídeo leitura escrita teste rápido leve local "
            "aplicativo janela motor navegador código revisão versão dados valor média total").split()


def frase(r, n=None):
    n = n or r.randint(8, 22)
    s = " ".join(r.choice(PALAVRAS) for _ in range(n))
    return s[0].upper() + s[1:] + "."


def paragrafo(r, n=None):
    return " ".join(frase(r) for _ in range(n or r.randint(3, 7)))


def foto(r, w, h, nome=None):
    """Imagem com gradiente, formas e ruído: comprime como uma foto, não como um desenho liso."""
    from PIL import Image, ImageDraw, ImageFilter
    base = Image.linear_gradient("L").resize((w, h)).convert("RGB")
    d = ImageDraw.Draw(base)
    for _ in range(40):
        x, y = r.randint(0, w), r.randint(0, h)
        s = r.randint(w // 30, w // 6)
        d.ellipse([x - s, y - s, x + s, y + s], fill=(r.randint(0, 255), r.randint(0, 255), r.randint(0, 255)))
    base = base.filter(ImageFilter.GaussianBlur(max(1, w // 400)))
    ruido = Image.effect_noise((w, h), 40).convert("RGB")
    img = Image.blend(base, ruido, 0.18)
    if nome:
        img.save(nome, "JPEG", quality=88)
    return img


def jpg_bytes(r, w, h):
    b = io.BytesIO()
    foto(r, w, h).save(b, "JPEG", quality=82)
    return b.getvalue()


def gerar_pdf(r, n, arq):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas
    c = canvas.Canvas(arq, pagesize=A4)
    c.setTitle("InkDOS Hub - teste de desempenho")
    w, h = A4
    img = ImageReader(io.BytesIO(jpg_bytes(r, 1200, 800))) if n > 1 else None
    for p in range(n):
        c.bookmarkPage("p%d" % p)
        if p % 10 == 0:
            c.addOutlineEntry("Capítulo %d" % (p // 10 + 1), "p%d" % p, 0)
        c.setFont("Helvetica-Bold", 16)
        c.drawString(50, h - 60, "Capítulo %d · página %d" % (p // 10 + 1, p + 1))
        c.setFont("Helvetica", 10)
        y = h - 90
        if img and p % 3 == 1:
            c.drawImage(img, 50, y - 240, width=360, height=240)
            y -= 260
        if p % 4 == 2:  # tabela
            for i in range(12):
                for j in range(5):
                    c.rect(50 + j * 95, y - i * 16, 95, 16)
                    c.drawString(54 + j * 95, y - i * 16 + 4, str(r.randint(100, 99999)) if i else "Coluna %d" % (j + 1))
            y -= 220
        t = c.beginText(50, y)
        for _ in range(int((y - 60) / 13)):
            t.textLine(frase(r, 14)[:95])
        c.drawText(t)
        c.showPage()
    c.save()


def gerar_docx(r, n, arq):
    from docx import Document
    from docx.shared import Inches
    d = Document()
    d.add_heading("Relatório de teste do InkDOS Hub", 0)
    img = jpg_bytes(r, 1200, 800) if n > 1 else None
    for p in range(n):
        d.add_heading("Seção %d" % (p + 1), 1)
        for _ in range(4):
            d.add_paragraph(paragrafo(r))
        if n > 1 and p % 3 == 0:
            t = d.add_table(rows=8, cols=5)
            t.style = "Table Grid"
            for i, row in enumerate(t.rows):
                for j, cel in enumerate(row.cells):
                    cel.text = "Coluna %d" % (j + 1) if i == 0 else str(r.randint(1, 9999))
        if img and p % 4 == 1:
            d.add_picture(io.BytesIO(img), width=Inches(5))
        d.add_paragraph(frase(r), style="List Bullet")
        if p < n - 1:
            d.add_page_break()
    d.save(arq)


def gerar_xlsx(r, n, arq):
    from openpyxl import Workbook
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("Vendas")
    ws.append(["Data", "Produto", "Região", "Quantidade", "Preço", "Total", "Desconto", "Líquido", "Imposto", "Final"])
    for i in range(2, n + 2):
        ws.append(["2026-%02d-%02d" % (r.randint(1, 12), r.randint(1, 28)), r.choice(PALAVRAS), r.choice(["Norte", "Sul", "Leste", "Oeste"]),
                   r.randint(1, 500), round(r.uniform(1, 999), 2), "=D%d*E%d" % (i, i), round(r.uniform(0, 0.3), 2),
                   "=F%d*(1-G%d)" % (i, i), "=H%d*0.12" % i, "=H%d+I%d" % (i, i)])
    res = wb.create_sheet("Resumo")
    res.append(["Região", "Total"])
    for reg in ["Norte", "Sul", "Leste", "Oeste"]:
        res.append([reg, '=SUMIF(Vendas!C:C,"%s",Vendas!J:J)' % reg])
    if n > 1000:
        piv = wb.create_sheet("Médias")
        piv.append(["Coluna", "Média", "Máximo"])
        for col in "DEFHJ":
            piv.append([col, "=AVERAGE(Vendas!%s:%s)" % (col, col), "=MAX(Vendas!%s:%s)" % (col, col)])
    wb.save(arq)


def gerar_pptx(r, n, arq):
    from pptx import Presentation
    from pptx.util import Inches, Pt
    p = Presentation()
    img = jpg_bytes(r, 1600, 1000) if n > 3 else None
    for s in range(n):
        if s == 0:
            sl = p.slides.add_slide(p.slide_layouts[0])
            sl.shapes.title.text = "Teste de desempenho"
            sl.placeholders[1].text = "InkDOS Hub"
            continue
        sl = p.slides.add_slide(p.slide_layouts[1] if s % 3 else p.slide_layouts[5])
        sl.shapes.title.text = "Slide %d: %s" % (s + 1, frase(r, 4)[:-1])
        if s % 3:
            tf = sl.placeholders[1].text_frame
            tf.text = frase(r, 10)
            for _ in range(4):
                tf.add_paragraph().text = frase(r, 9)
        elif img:
            sl.shapes.add_picture(io.BytesIO(img), Inches(1), Inches(1.6), width=Inches(8))
        else:
            caixa = sl.shapes.add_textbox(Inches(1), Inches(2), Inches(8), Inches(3))
            caixa.text_frame.text = paragrafo(r)
            caixa.text_frame.paragraphs[0].runs[0].font.size = Pt(20)
    p.save(arq)


def gerar_txt(r, kb, arq):
    with open(arq, "w", encoding="utf-8") as f:
        n = 0
        while n < kb * 1024:
            s = paragrafo(r) + "\n\n"
            f.write(s)
            n += len(s.encode())


def gerar_epub(r, n, arq):
    img = jpg_bytes(r, 1000, 700) if n > 3 else None
    with zipfile.ZipFile(arq, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip")  # sem compressão, primeiro arquivo
        z.writestr("META-INF/container.xml", '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', zipfile.ZIP_DEFLATED)
        itens, ordem, nav = [], [], []
        if img:
            z.writestr("OEBPS/capa.jpg", img, zipfile.ZIP_DEFLATED)
            itens.append('<item id="capa" href="capa.jpg" media-type="image/jpeg"/>')
        for c in range(n):
            corpo = "".join("<p>%s</p>" % paragrafo(r) for _ in range(12))
            if img and c % 10 == 0:
                corpo = '<img src="capa.jpg" alt=""/>' + corpo
            xhtml = '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Capítulo %d</title></head><body><h1>Capítulo %d</h1>%s</body></html>' % (c + 1, c + 1, corpo)
            z.writestr("OEBPS/c%d.xhtml" % c, xhtml, zipfile.ZIP_DEFLATED)
            itens.append('<item id="c%d" href="c%d.xhtml" media-type="application/xhtml+xml"/>' % (c, c))
            ordem.append('<itemref idref="c%d"/>' % c)
            nav.append('<li><a href="c%d.xhtml">Capítulo %d</a></li>' % (c, c + 1))
        z.writestr("OEBPS/nav.xhtml", '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Sumário</title></head><body><nav epub:type="toc"><ol>%s</ol></nav></body></html>' % "".join(nav), zipfile.ZIP_DEFLATED)
        itens.append('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>')
        opf = ('<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
               '<dc:identifier id="id">inkdoshub-teste-%d</dc:identifier><dc:title>Livro de teste (%d capítulos)</dc:title><dc:language>pt-BR</dc:language><meta property="dcterms:modified">2026-10-30T00:00:00Z</meta></metadata>'
               '<manifest>%s</manifest><spine>%s</spine></package>') % (n, n, "".join(itens), "".join(ordem))
        z.writestr("OEBPS/content.opf", opf, zipfile.ZIP_DEFLATED)


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"] + list(args), check=True)


def gerar_video(tam, seg, taxa, arq):
    # imagem que muda o tempo todo (como uma câmera), H.264 com som AAC, igual a um vídeo de celular
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=%s:rate=30" % tam, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
           "-vf", "noise=alls=12:allf=t", "-t", str(seg), "-c:v", "libx264", "-preset", "veryfast", "-b:v", taxa, "-maxrate", taxa, "-bufsize", taxa,
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", arq)


def gerar_musica(seg, arq):
    ffmpeg("-f", "lavfi", "-i", "aevalsrc='0.3*sin(2*PI*(220+110*sin(0.2*t))*t)+0.1*sin(2*PI*660*t)':s=44100:c=stereo",
           "-f", "lavfi", "-i", "anoisesrc=a=0.02:c=pink", "-filter_complex", "amix=inputs=2", "-t", str(seg),
           "-c:a", "libmp3lame", "-b:a", "192k", "-metadata", "title=Faixa de teste (%d s)" % seg, "-metadata", "artist=InkDOS Hub", arq)


def gerar_codigo(r, linhas, arq):
    with open(arq, "w", encoding="utf-8") as f:
        f.write("// Código de teste do InkDOS Hub (%d linhas): funções, classes e objetos.\n" % linhas)
        i = 1
        while i < linhas:
            k = r.randint(0, 2)
            if k == 0:
                f.write("export function calcular%d(lista, fator = %d) {\n  let total = 0;\n  for (const item of lista) {\n    if (item.valor > %d) total += item.valor * fator;\n    else total -= item.valor / 2;\n  }\n  return Math.round(total * 100) / 100;\n}\n\n" % (i, r.randint(1, 9), r.randint(1, 500)))
                i += 10
            elif k == 1:
                f.write("export class Modulo%d {\n  constructor(nome) { this.nome = nome; this.itens = []; }\n  adicionar(x) { this.itens.push(x); return this; }\n  get tamanho() { return this.itens.length; }\n  // %s\n}\n\n" % (i, frase(r, 8)))
                i += 8
            else:
                f.write("export const config%d = %s;\n\n" % (i, json.dumps({"nome": r.choice(PALAVRAS), "ativo": r.random() > 0.5, "limite": r.randint(1, 1000), "tags": r.sample(PALAVRAS, 3)}, ensure_ascii=False)))
                i += 2


def gerar_quadro(r, n, arq):
    els = []
    for i in range(n):
        tipo = r.choice(["rectangle", "ellipse", "diamond", "arrow", "text"])
        x, y = r.randint(0, 4000), r.randint(0, 3000)
        e = {"id": "e%d" % i, "type": tipo, "x": x, "y": y, "width": r.randint(40, 300), "height": r.randint(30, 200), "angle": 0,
             "strokeColor": "#1e1e1e", "backgroundColor": r.choice(["transparent", "#a5d8ff", "#ffec99", "#b2f2bb"]), "fillStyle": "hachure",
             "strokeWidth": 1, "strokeStyle": "solid", "roughness": 1, "opacity": 100, "groupIds": [], "frameId": None, "roundness": None,
             "seed": r.randint(1, 2 ** 30), "version": 1, "versionNonce": r.randint(1, 2 ** 30), "isDeleted": False, "boundElements": None,
             "updated": 1, "link": None, "locked": False}
        if tipo == "arrow":
            e.update(points=[[0, 0], [e["width"], e["height"]]], startBinding=None, endBinding=None, startArrowhead=None, endArrowhead="arrow", lastCommittedPoint=None)
        if tipo == "text":
            t = frase(r, 4)
            e.update(text=t, originalText=t, fontSize=20, fontFamily=1, textAlign="left", verticalAlign="top", containerId=None, lineHeight=1.25, autoResize=True)
        els.append(e)
    json.dump({"type": "excalidraw", "version": 2, "source": "https://inkdoshub.github.io", "elements": els, "appState": {"viewBackgroundColor": "#ffffff"}, "files": {}},
              open(arq, "w", encoding="utf-8"))


def main():
    niveis = sys.argv[1:] or ["simples", "medio", "complexo"]
    for nivel in niveis:
        c = NIVEIS[nivel]
        pasta = os.path.join(SAIDA, nivel)
        os.makedirs(pasta, exist_ok=True)
        r = random.Random(nivel)
        a = lambda nome: os.path.join(pasta, nome)
        passos = [
            ("pdf", lambda: gerar_pdf(r, c["pdf"], a("documento-%dpag.pdf" % c["pdf"]))),
            ("docx", lambda: gerar_docx(r, c["docx"], a("documento-%dpag.docx" % c["docx"]))),
            ("xlsx", lambda: gerar_xlsx(r, c["xlsx"], a("planilha-%dlinhas.xlsx" % c["xlsx"]))),
            ("pptx", lambda: gerar_pptx(r, c["pptx"], a("apresentacao-%dslides.pptx" % c["pptx"]))),
            ("txt", lambda: gerar_txt(r, c["txt"], a("texto-%dKB.txt" % c["txt"]))),
            ("epub", lambda: gerar_epub(r, c["epub"], a("livro-%dcap.epub" % c["epub"]))),
            ("foto", lambda: foto(r, c["foto"][0], c["foto"][1], a("foto-%dx%d.jpg" % c["foto"]))),
            ("video", lambda: gerar_video(c["video"][0], c["video"][1], c["video"][2], a("video-%s-%ds.mp4" % (c["video"][0].split("x")[1] + "p", c["video"][1])))),
            ("musica", lambda: gerar_musica(c["musica"], a("musica-%ds.mp3" % c["musica"]))),
            ("codigo", lambda: gerar_codigo(r, c["codigo"], a("codigo-%dlinhas.js" % c["codigo"]))),
            ("quadro", lambda: gerar_quadro(r, c["quadro"], a("quadro-%dformas.excalidraw" % c["quadro"]))),
        ]
        for nome, f in passos:
            print("%-9s %-6s" % (nivel, nome), flush=True)
            f()
    for nivel in niveis:
        pasta = os.path.join(SAIDA, nivel)
        total = sum(os.path.getsize(os.path.join(pasta, x)) for x in os.listdir(pasta))
        print("%s: %.1f MB" % (nivel, total / 1e6))


if __name__ == "__main__":
    main()
