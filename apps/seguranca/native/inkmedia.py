# InkDOS media tools: PDF, images, video, audio and Office jobs that run on this device (a-Shell or any Python 3).
# Usage (normally from inkmenu.py): python3 inkmedia.py <group> <job> [options]. Every job asks for the folder.
import os, re, sys, time, zipfile, csv, io, shutil
from xml.sax.saxutils import escape

# ---------- choose the folder (a-Shell: Apple menu; terminal: drag the folder in) ----------
ASH = "/Containers/Data/Application/" in os.path.expanduser("~")
def pick(what="folder", stay=True):
    before = os.getcwd()
    if ASH:
        home = os.path.realpath(os.path.expanduser("~"))
        while True:
            print("Choose the %s in the menu that opens..." % what, flush=True)
            try: os.system("pickFolder")
            except Exception: pass
            p = os.getcwd()
            if not (os.path.realpath(p) == os.path.realpath(before) and os.path.realpath(p) in (home, os.path.join(home, "Documents"))): break
            try: a = input("No folder was chosen. Press Enter to open the menu again, or type 0 to go back: ").strip()
            except EOFError: a = "0"
            if a == "0": sys.exit(1)
    else:
        try: p = input("Drag the %s here (or type its path) and press Enter. Enter alone = %s: " % (what, before))
        except EOFError: p = ""
        p = p.strip().strip("'\"").replace("\\ ", " ")
        p = os.path.abspath(os.path.expanduser(p)) if p else before
        if not os.path.isdir(p): print("Folder not found: " + p); sys.exit(1)
    os.chdir(p if stay else before)
    show = p
    if "com~apple~CloudDocs" in p: show = "iCloud Drive" + p.split("com~apple~CloudDocs", 1)[1]
    elif "File Provider Storage" in p: show = "On My iPhone/iPad" + p.split("File Provider Storage", 1)[1]
    elif ASH and p.startswith(os.path.expanduser("~")): show = "a-Shell" + p[len(os.path.expanduser("~")):]
    print("%s: %s" % (what[0].upper() + what[1:], show), flush=True)
    return p

def pick_file(exts, what="file"):
    fs = sorted(f for f in os.listdir(".") if os.path.isfile(f) and f.lower().endswith(tuple(exts)))
    if not fs: print("No %s here (%s)." % (what, ", ".join(exts))); sys.exit(1)
    if len(fs) == 1: print("File: " + fs[0]); return fs[0]
    for i, f in enumerate(fs, 1): print("%3d  %s" % (i, f))
    try: n = int(input("Number of the %s: " % what))
    except (ValueError, EOFError): n = 0
    if not 1 <= n <= len(fs): print("Invalid number."); sys.exit(1)
    return fs[n - 1]

CHOSEN = "--in" in sys.argv  # the Hub page already set the folder
if CHOSEN: sys.argv.remove("--in")

def ask_text(q, default=""):
    try: a = input("%s%s: " % (q, " [%s]" % default if default else "")).strip()
    except EOFError: print(); sys.exit(1)
    return a or default

def parse_list(a, n):
    # "1,3,5-7" -> [0,2,4,5,6] (keeps the order typed)
    out = []
    for part in a.replace(" ", "").split(","):
        if not part: continue
        m = re.fullmatch(r"(\d+)-(\d+)", part)
        if m:
            x, y = int(m.group(1)), int(m.group(2))
            out += list(range(x, y + 1) if x <= y else range(x, y - 1, -1))
        elif part.isdigit(): out.append(int(part))
        else: raise ValueError(part)
    if not out or any(not 1 <= i <= n for i in out): raise ValueError(a)
    return [i - 1 for i in out]

def files(exts):
    cloud = [f for f in os.listdir(".") if f.startswith(".") and f.endswith(".icloud") and f[1:-7].lower().endswith(tuple(exts))]
    if cloud: print("Note: %d matching file(s) are in iCloud but not downloaded and will be skipped (Files app > long-press > Download Now)." % len(cloud))
    return sorted((f for f in os.listdir(".") if os.path.isfile(f) and f.lower().endswith(tuple(exts)) and not f.startswith(".")), key=str.lower)

def choose(exts, what, many=True):
    fs = files(exts)
    if not fs: print("No %s in this folder." % what); sys.exit(1)
    if len(fs) == 1: print("File: " + fs[0]); return fs
    print()
    if many: print("   0  ALL %d %s" % (len(fs), what))
    for i, f in enumerate(fs, 1): print("%4d  %s" % (i, f))
    hint = "Type a number" + (" (0 = all; or several like 1,3,5 or 2-6)" if many else "")
    while True:
        a = ask_text(hint + " and press Enter")
        if many and a == "0": return fs
        try:
            idx = parse_list(a, len(fs))
            if not many and len(idx) != 1: raise ValueError(a)
            return [fs[i] for i in idx]
        except ValueError: print("Please type a number from the list.")

def out_name(f, tag, ext=None):
    b, e = os.path.splitext(f); ext = ext or e
    o = "%s%s%s" % (b, (" (%s)" % tag) if tag else "", ext)
    n = 2
    while os.path.exists(o): o = "%s (%s %d)%s" % (b, tag or "copy", n, ext); n += 1
    return o

def human(n):
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024: return "%.0f %s" % (n, u) if u == "B" else "%.1f %s" % (n, u)
        n /= 1024
    return "%.1f TB" % n

def done(f, out):
    try: print("  %s -> %s (%s -> %s)" % (f, out, human(os.path.getsize(f)), human(os.path.getsize(out))) if os.path.exists(f) else "  -> %s (%s)" % (out, human(os.path.getsize(out))))
    except OSError: print("  -> " + out)

# ---------- PDF (pypdf, installed once) ----------
def pypdf():
    try:
        import pypdf as P; return P
    except ImportError: pass
    print("First time only: installing the PDF library (pypdf, about 1 MB)...", flush=True)
    if ASH: os.system("pip install --quiet pypdf")
    else:
        import subprocess
        subprocess.call([sys.executable, "-m", "pip", "install", "--quiet", "--user", "pypdf"])
    import importlib, site
    try: sys.path.append(site.getusersitepackages())
    except Exception: pass
    importlib.invalidate_caches()
    try:
        import pypdf as P; return P
    except ImportError:
        print("Could not install pypdf. Check the internet connection and try again."); sys.exit(1)

PDF = [".pdf"]
IMG = [".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".gif", ".tif", ".tiff", ".bmp"]

def reader(f, P):
    r = P.PdfReader(f)
    if r.is_encrypted:
        if not r.decrypt(""):
            pw = ask_text("%s has a password. Type it" % f)
            if not r.decrypt(pw): print("Wrong password."); sys.exit(1)
    return r

def write(w, out):
    with open(out, "wb") as fh: w.write(fh)

def pages_of(r, q):
    a = ask_text(q + " (e.g. 1-3,5; this PDF has %d pages)" % len(r.pages))
    try: return parse_list(a, len(r.pages))
    except ValueError: print("Invalid pages."); sys.exit(1)

def pdf_merge(P):
    fs = choose(PDF, "PDFs (pick them in the order you want)")
    if len(fs) < 2: print("Pick at least 2 PDFs."); return
    w = P.PdfWriter()
    for f in fs: print("  + " + f); w.append(reader(f, P))
    out = out_name("merged.pdf", ""); write(w, out); done("", out)

def pdf_split(P):
    for f in choose(PDF, "PDFs"):
        r = reader(f, P); d = os.path.splitext(f)[0] + " (pages)"; os.makedirs(d, exist_ok=True)
        for i, p in enumerate(r.pages, 1):
            w = P.PdfWriter(); w.add_page(p); write(w, os.path.join(d, "page %03d.pdf" % i))
        print("  %s -> %d files in '%s'" % (f, len(r.pages), d))

def pdf_extract(P, keep=True):
    f = choose(PDF, "PDF", many=False)[0]; r = reader(f, P)
    idx = pages_of(r, "Pages to keep" if keep else "Pages to delete")
    w = P.PdfWriter()
    for i in (idx if keep else [i for i in range(len(r.pages)) if i not in set(idx)]): w.add_page(r.pages[i])
    out = out_name(f, "pages" if keep else "edited"); write(w, out); done(f, out)

def pdf_rotate(P, deg):
    for f in choose(PDF, "PDFs"):
        r = reader(f, P); w = P.PdfWriter()
        for p in r.pages: p.rotate(int(deg)); w.add_page(p)
        out = out_name(f, "rotated"); write(w, out); done(f, out)

def pdf_reorder(P):
    f = choose(PDF, "PDF", many=False)[0]; r = reader(f, P); n = len(r.pages)
    a = ask_text("New page order (e.g. 3,1,2 or %d-1 to reverse; this PDF has %d pages)" % (n, n))
    try: idx = parse_list(a, n)
    except ValueError: print("Invalid order."); return
    w = P.PdfWriter()
    for i in idx: w.add_page(r.pages[i])
    out = out_name(f, "reordered"); write(w, out); done(f, out)

def pdf_compress(P):
    for f in choose(PDF, "PDFs"):
        r = reader(f, P); w = P.PdfWriter(clone_from=r)
        for p in w.pages:
            try: p.compress_content_streams(level=9)
            except Exception: pass
        try: w.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)
        except TypeError:
            try: w.compress_identical_objects(remove_identicals=True, remove_orphans=True)
            except Exception: pass
        except Exception: pass
        out = out_name(f, "smaller"); write(w, out)
        if os.path.getsize(out) >= os.path.getsize(f): os.remove(out); print("  %s: already as small as it gets." % f)
        else: done(f, out)

def pdf_protect(P):
    pw = ask_text("Password to open the PDF(s)")
    if not pw: print("No password typed."); return
    for f in choose(PDF, "PDFs"):
        w = P.PdfWriter(clone_from=reader(f, P)); w.encrypt(pw, algorithm="AES-256")
        out = out_name(f, "protected"); write(w, out); done(f, out)

def pdf_unlock(P):
    for f in choose(PDF, "PDFs"):
        w = P.PdfWriter(clone_from=reader(f, P))
        out = out_name(f, "unlocked"); write(w, out); done(f, out)

def pdf_meta(P):
    fs = choose(PDF, "PDFs")
    for f in fs:
        r = reader(f, P); m = r.metadata or {}
        print("\n  " + f)
        for k, v in m.items(): print("    %s: %s" % (k.lstrip("/"), v))
        if not m: print("    (no metadata)")
    if ask_text("Remove all metadata from them? Type y for yes, Enter for no").lower().startswith("y"):
        for f in fs:
            r = reader(f, P); w = P.PdfWriter(clone_from=r); w.metadata = None
            try: w._root_object.pop("/Metadata", None)
            except Exception: pass
            out = out_name(f, "no metadata"); write(w, out); done(f, out)

def pdf_from_images():
    Image, ImageOps = pil()
    fs = choose(IMG, "images (pick them in page order)")
    pages = []
    for f in fs:
        im = open_img(f, Image, ImageOps)
        if im is None: print("  skipped " + f); continue
        pages.append(im.convert("RGB"))
    if not pages: return
    out = out_name("images.pdf", ""); pages[0].save(out, save_all=True, append_images=pages[1:], resolution=150)
    done("", out)

def pdf_images(P):
    for f in choose(PDF, "PDFs"):
        r = reader(f, P); d = os.path.splitext(f)[0] + " (images)"; os.makedirs(d, exist_ok=True); n = 0
        for i, p in enumerate(r.pages, 1):
            try: ims = p.images
            except Exception: continue
            for im in ims:
                n += 1
                with open(os.path.join(d, "page %03d - %s" % (i, im.name)), "wb") as fh: fh.write(im.data)
        print("  %s -> %d image(s) in '%s'" % (f, n, d))

def pdf_text(P, word=False):
    for f in choose(PDF, "PDFs"):
        r = reader(f, P); pages = []
        for p in r.pages:
            try: pages.append(p.extract_text() or "")
            except Exception: pages.append("")
        if not any(t.strip() for t in pages): print("  %s: no text found (scanned? use OCR in the Hub)." % f); continue
        if word:
            out = out_name(f, "", ".docx"); make_docx(pages, out)
        else:
            out = out_name(f, "", ".txt")
            with open(out, "w", encoding="utf-8") as fh: fh.write("\n\n".join(pages))
        done(f, out)

def make_docx(pages, out):
    body = []
    for n, t in enumerate(pages):
        if n: body.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
        for line in t.splitlines():
            body.append('<w:p><w:r><w:t xml:space="preserve">%s</w:t></w:r></w:p>' % escape(re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", line)))
    W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document %s><w:body>%s</w:body></w:document>' % (W, "".join(body)))

# ---------- PDF to Word / Excel / JPG (pure Python on top of pypdf) ----------
def page_lines(p):
    # Text pieces with position and size -> lines [(y, size, bold, text)] in reading order.
    chunks = []
    def vis(text, cm, tm, font, size):
        if not text: return
        y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]
        sc = (abs(tm[3]) or abs(tm[0]) or 1) * (abs(cm[3]) or 1)
        name = str((font or {}).get("/BaseFont", "")) if hasattr(font, "get") else ""
        chunks.append((y, (size or 10) * sc, bool(re.search(r"Bold|Black|Heavy|Semibold", name)), text))
    try: p.extract_text(visitor_text=vis)
    except Exception: chunks = []
    lines, cur = [], None
    for y, size, bold, t in chunks:
        part = t.replace("\n", " ")
        if not part.strip(): continue
        if cur is None or abs(y - cur[0]) > max(2, 0.5 * size):
            if cur and cur[3].strip(): lines.append(cur)
            cur = [y, size, bold, part]; continue
        sep = "" if cur[3].endswith(" ") or part.startswith(" ") else " "
        cur[3] += sep + part; cur[1] = max(cur[1], size); cur[2] = cur[2] and bold
    if cur and cur[3].strip(): lines.append(cur)
    return lines

def page_paragraphs(lines, body):
    # Lines join into one paragraph only when the line before is nearly full (it wrapped); short lines,
    # like table rows or list items, stay on their own.
    paras, last = [], None
    full = 0.6 * max([len(re.sub(r"\s+", " ", l[3]).strip()) for l in lines] or [1])
    for y, size, bold, t in lines:
        t = re.sub(r"\s+", " ", t).strip()
        head = size >= body * 1.25 and len(t) < 150
        if last and not head and not last["head"] and last["len"] >= full and abs(last["y"] - y) <= body * 1.9 and abs(last["size"] - size) < 1.5:
            last["text"] = (last["text"][:-1] if last["text"].endswith("-") else last["text"] + " ") + t
            last["bold"] = last["bold"] and bold; last["y"] = y; last["len"] = len(t)
        else:
            last = {"text": t, "size": size, "bold": bold, "head": head, "y": y, "len": len(t)}; paras.append(last)
    return paras

def img_bytes(im):
    # (data, ext, w, h) in a format Word opens (png/jpeg); converts others with Pillow.
    data, ext = im.data, os.path.splitext(im.name)[1].lower()
    try:
        from PIL import Image
        pi = Image.open(io.BytesIO(data)); w, h = pi.size
        if ext not in (".png", ".jpg", ".jpeg"):
            b = io.BytesIO(); (pi.convert("RGB") if pi.mode not in ("RGB", "L", "RGBA") else pi).save(b, "PNG"); data, ext = b.getvalue(), ".png"
        return data, (".jpeg" if ext == ".jpg" else ext), w, h
    except Exception:
        return (data, ext, 600, 400) if ext in (".png", ".jpg", ".jpeg") else None

def pdf_to_word(P):
    for f in choose(PDF, "PDFs"):
        r = reader(f, P); pages = []
        sizes = []
        for p in r.pages:
            ls = page_lines(p); pages.append((p, ls)); sizes += [round(l[1]) for l in ls]
        body = max(set(sizes), key=sizes.count) if sizes else 11
        doc, media = [], []
        for n, (p, ls) in enumerate(pages):
            if n: doc.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
            for para in page_paragraphs(ls, body):
                pt = max(8, min(36, round(para["size"] * (11.0 / body)))) if para["head"] else 11
                rpr = ("<w:b/>" if para["bold"] or para["head"] else "") + '<w:sz w:val="%d"/>' % (pt * 2)
                doc.append('<w:p><w:r><w:rPr>%s</w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>' % (rpr, escape(re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", para["text"]))))
            try: ims = list(p.images)
            except Exception: ims = []
            for im in ims:
                b = img_bytes(im)
                if not b or len(b[0]) < 300: continue
                media.append(b); k = len(media)
                cx = min(5486400, b[2] * 9525); cy = int(cx * b[3] / max(1, b[2]))
                doc.append('<w:p><w:r><w:drawing><wp:inline><wp:extent cx="%d" cy="%d"/><wp:docPr id="%d" name="Picture %d"/>'
                           '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="%d" name="img%d"/><pic:cNvPicPr/></pic:nvPicPr>'
                           '<pic:blipFill><a:blip r:embed="img%d"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
                           % (cx, cy, k, k, k, k, k, cx, cy))
        if not any("<w:t" in d for d in doc) and not media: print("  %s: no text or pictures found." % f); continue
        out = out_name(f, "", ".docx"); write_docx(doc, media, out); done(f, out)

def write_docx(doc, media, out):
    NS = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
          'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
          'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"')
    rels = "".join('<Relationship Id="img%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image%d%s"/>' % (k, k, m[1]) for k, m in enumerate(media, 1))
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">%s</Relationships>' % rels)
        for k, m in enumerate(media, 1): z.writestr("word/media/image%d%s" % (k, m[1]), m[0])
        z.writestr("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document %s><w:body>%s<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>' % (NS, "".join(doc)))

def num_cell(v):
    t = v.strip()
    if re.fullmatch(r"-?\d+(\.\d+)?", t): return t
    if re.fullmatch(r"-?\d{1,3}(\.\d{3})*(,\d+)?|-?\d+,\d+", t): return t.replace(".", "").replace(",", ".")
    return None

def write_xlsx(sheets, out):
    M = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'; R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>%s</Types>'
                   % "".join('<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % i for i in range(1, len(sheets) + 1)))
        z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook %s %s><sheets>%s</sheets></workbook>' % (M, R, "".join('<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (escape(n[:31]), i, i) for i, (n, _) in enumerate(sheets, 1))))
        z.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">%s</Relationships>' % "".join('<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>' % (i, i) for i in range(1, len(sheets) + 1)))
        for i, (_, rows) in enumerate(sheets, 1):
            xr = []
            for ri, r in enumerate(rows, 1):
                cs = []
                for ci, v in enumerate(r, 1):
                    ref = "%s%d" % (col(ci), ri); n = num_cell(v)
                    if n is not None: cs.append('<c r="%s"><v>%s</v></c>' % (ref, n))
                    elif v.strip(): cs.append('<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (ref, escape(re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", v.strip()))))
                xr.append('<row r="%d">%s</row>' % (ri, "".join(cs)))
            z.writestr("xl/worksheets/sheet%d.xml" % i, '<?xml version="1.0" encoding="UTF-8"?><worksheet %s><sheetData>%s</sheetData></worksheet>' % (M, "".join(xr)))

def pdf_to_excel(P):
    for f in choose(PDF, "PDFs"):
        r = reader(f, P); sheets = []
        for n, p in enumerate(r.pages, 1):
            try: t = p.extract_text(extraction_mode="layout")
            except Exception: t = p.extract_text() or ""
            rows = [re.split(r"\s{2,}", l.strip()) for l in t.splitlines() if l.strip()]
            if rows: sheets.append(("Page %d" % n, rows))
        if not sheets: print("  %s: no text found (scanned PDF)." % f); continue
        out = out_name(f, "", ".xlsx"); write_xlsx(sheets, out); done(f, out)

def pdf_to_jpg(P):
    try: from PIL import Image
    except ImportError: Image = None
    for f in choose(PDF, "PDFs"):
        r = reader(f, P); d = os.path.splitext(f)[0] + " (JPG)"; n = 0; vector = 0
        for i, p in enumerate(r.pages, 1):
            try: ims = list(p.images)
            except Exception: ims = []
            if not ims: vector += 1; continue
            big = max(ims, key=lambda im: len(im.data)); os.makedirs(d, exist_ok=True); o = os.path.join(d, "page %03d.jpg" % i)
            try:
                pi = Image.open(io.BytesIO(big.data)); pi.convert("RGB").save(o, quality=90)
            except Exception:
                with open(os.path.splitext(o)[0] + os.path.splitext(big.name)[1], "wb") as fh: fh.write(big.data)
            n += 1
        print("  %s -> %d page(s) in '%s'%s" % (f, n, d, ("; %d page(s) are text/drawings, not photos: those need a renderer and were skipped" % vector) if vector else ""))

# ---------- images (Pillow; HEIC through magick) ----------
def pil():
    try:
        from PIL import Image, ImageOps; return Image, ImageOps
    except ImportError:
        print("Pillow is not available here. On a computer: pip install pillow"); sys.exit(1)

def open_img(f, Image, ImageOps):
    try: return ImageOps.exif_transpose(Image.open(f))
    except Exception:
        tmp = ".inkdos-tmp.png"
        if os.system("magick %s %s" % (q(f), q(tmp))) == 0 and os.path.exists(tmp):
            im = Image.open(tmp); im.load(); os.remove(tmp); return im
        return None

def q(p): return "'" + p.replace("'", "'\\''") + "'"

def save_img(im, out):
    if out.lower().endswith((".jpg", ".jpeg")) and im.mode not in ("RGB", "L"): im = im.convert("RGB")
    im.save(out, quality=85) if out.lower().endswith((".jpg", ".jpeg", ".webp")) else im.save(out)

def img_job(kind, opt):
    Image, ImageOps = pil(); ok = 0
    for f in choose(IMG, "images"):
        im = open_img(f, Image, ImageOps)
        if im is None: print("  FAILED " + f); continue
        ext = os.path.splitext(f)[1].lower()
        if ext in (".heic", ".heif"): ext = ".jpg"
        if kind == "resize":
            im.thumbnail((int(opt), int(opt))); out = out_name(f, "%spx" % opt, ext); save_img(im, out)
        elif kind == "compress":
            out = out_name(f, "smaller", ".jpg"); im = im.convert("RGB"); im.save(out, quality=int(opt), optimize=True)
        elif kind == "rotate":
            im = im.rotate(-int(opt), expand=True); out = out_name(f, "rotated", ext); save_img(im, out)
        elif kind == "strip":
            clean = Image.new(im.mode, im.size); clean.paste(im)
            out = out_name(f, "no location", ext); save_img(clean, out)
        done(f, out); ok += 1
    print("%d image(s) done. Originals kept." % ok)

# ---------- video and audio (ffmpeg, built into a-Shell) ----------
VID = [".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".wmv", ".flv", ".3gp", ".mts"]
AUD = [".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg", ".opus", ".wma", ".aiff", ".aif"]

def ff(args, out):
    cmd = "ffmpeg -nostdin -y -hide_banner -loglevel error " + args
    print("  working...", flush=True)
    r = os.system(cmd)
    ok = r == 0 and os.path.exists(out) and os.path.getsize(out) > 0
    if not ok and os.path.exists(out): os.remove(out)
    return ok

def venc(bitrate):
    # Hardware encoder on iPhone/iPad (fast, low battery); software x264 elsewhere.
    return "-c:v h264_videotoolbox -b:v %s" % bitrate if ASH else "-c:v libx264 -preset veryfast -b:v %s" % bitrate

def time_ask(q, default):
    a = ask_text(q + " (like 1:30 or 0:05)", default)
    return a if re.fullmatch(r"\d+(:\d{1,2}){0,2}(\.\d+)?", a) else default

def media_job(group, kind, opt):
    exts = VID if group == "video" else AUD
    what = "videos" if group == "video" else "audio files"
    fs = choose(exts + (AUD if group == "video" and kind == "convert" else []), what, many=kind != "join")
    if kind == "cut":
        s = time_ask("Start at", "0:00"); e = time_ask("End at (Enter = end of file)", "")
    ok = 0
    for f in (fs if kind != "join" else []):
        ext = os.path.splitext(f)[1].lower()
        if kind == "convert":
            out = out_name(f, "", "." + opt); a = "-i %s %s" % (q(f), q(out))
        elif kind == "small":
            out = out_name(f, "smaller", ".mp4"); scale = "" if opt == "4M" else " -vf scale=w=1280:h=1280:force_original_aspect_ratio=decrease:force_divisible_by=2"
            a = "-i %s %s%s -c:a aac -b:a 128k %s" % (q(f), venc({"4M": "4M", "2M": "2M", "1M": "1M"}[opt]), scale, q(out))
        elif kind == "cut":
            out = out_name(f, "cut", ext); a = "-ss %s %s-i %s -c copy %s" % (s, ("-to %s " % e) if e else "", q(f), q(out))
        elif kind == "audio":
            out = out_name(f, "", "." + opt); a = "-i %s -vn %s" % (q(f), q(out))
        elif kind == "gif":
            out = out_name(f, "", ".gif"); a = "-i %s -t 15 -vf fps=10,scale=480:-1 %s" % (q(f), q(out))
        elif kind == "mute":
            out = out_name(f, "no sound", ext); a = "-i %s -an -c:v copy %s" % (q(f), q(out))
        elif kind == "rotate":
            t = {"90": "transpose=1", "270": "transpose=2", "180": "transpose=1,transpose=1"}[opt]
            out = out_name(f, "rotated", ".mp4"); a = "-i %s -vf %s %s -c:a copy %s" % (q(f), t, venc("6M"), q(out))
        elif kind == "volume":
            out = out_name(f, "volume", ext); a = "-i %s -filter:a %s %s" % (q(f), "loudnorm" if opt == "even" else "volume=" + opt, q(out))
        else: print("Unknown job."); return
        print("  " + f)
        if ff(a, out): done(f, out); ok += 1
        else: print("  FAILED (this format may not be supported here)")
    if kind == "join":
        lst = ".inkdos-list.txt"
        with open(lst, "w", encoding="utf-8") as fh:
            for f in fs: fh.write("file '%s'\n" % os.path.abspath(f).replace("'", "'\\''"))
        out = out_name("joined" + os.path.splitext(fs[0])[1].lower(), "")
        good = ff("-f concat -safe 0 -i %s -c copy %s" % (q(lst), q(out)), out) or ff("-f concat -safe 0 -i %s %s" % (q(lst), q(out)), out)
        os.remove(lst)
        if good: done("", out); ok = len(fs)
        else: print("  FAILED to join.")
    print("%d file(s) done. Originals kept." % ok)

# ---------- Office (pure Python) ----------
def xml_text(data, tag):
    return re.findall(r"<%s(?: [^>]*)?>([^<]*)</%s>" % (tag, tag), data)

def office_text():
    import html
    for f in choose([".docx", ".pptx", ".xlsx"], "Office files"):
        with zipfile.ZipFile(f) as z:
            names = z.namelist(); out_lines = []
            if f.lower().endswith(".docx"):
                d = z.read("word/document.xml").decode("utf-8", "replace")
                for para in re.split(r"</w:p>", d): out_lines.append("".join(xml_text(para, "w:t")))
            elif f.lower().endswith(".pptx"):
                slides = sorted((n for n in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)), key=lambda n: int(re.findall(r"\d+", n)[-1]))
                for i, n in enumerate(slides, 1):
                    out_lines.append("--- Slide %d ---" % i)
                    d = z.read(n).decode("utf-8", "replace")
                    for para in re.split(r"</a:p>", d): out_lines.append("".join(xml_text(para, "a:t")))
            else:
                for sheet, rows in xlsx_rows(z): out_lines.append("--- %s ---" % sheet); out_lines += ["\t".join(r) for r in rows]
        out = out_name(f, "", ".txt")
        with open(out, "w", encoding="utf-8") as fh: fh.write(html.unescape("\n".join(out_lines)))
        done(f, out)

def xlsx_rows(z):
    import html
    names = z.namelist(); shared = []
    if "xl/sharedStrings.xml" in names:
        d = z.read("xl/sharedStrings.xml").decode("utf-8", "replace")
        shared = [html.unescape("".join(xml_text(si, "t"))) for si in re.findall(r"<si>(.*?)</si>", d, re.S)]
    wb = z.read("xl/workbook.xml").decode("utf-8", "replace")
    titles = [html.unescape(t) for t in re.findall(r'<sheet [^>]*name="([^"]*)"', wb)]
    sheets = sorted((n for n in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)), key=lambda n: int(re.findall(r"\d+", n)[-1]))
    for k, n in enumerate(sheets):
        d = z.read(n).decode("utf-8", "replace"); rows = []
        for row in re.findall(r"<row[^>]*>(.*?)</row>", d, re.S):
            cells = {}
            for attrs, inner in re.findall(r"<c ([^>]*?)(?:/>|>(.*?)</c>)", row, re.S):
                ref = re.search(r'r="([A-Z]+)', attrs); col = 0
                for ch in (ref.group(1) if ref else "A"): col = col * 26 + ord(ch) - 64
                v = re.search(r"<v>(.*?)</v>", inner or "", re.S); t = re.search(r't="(\w+)"', attrs)
                if t and t.group(1) == "s" and v: val = shared[int(v.group(1))]
                elif t and t.group(1) == "inlineStr": val = html.unescape("".join(xml_text(inner, "t")))
                else: val = html.unescape(v.group(1)) if v else ""
                cells[col] = val
            rows.append([cells.get(i, "") for i in range(1, max(cells) + 1)] if cells else [])
        yield (titles[k] if k < len(titles) else "Sheet%d" % (k + 1)), rows

def xlsx_to_csv():
    for f in choose([".xlsx", ".xlsm"], "Excel files"):
        with zipfile.ZipFile(f) as z:
            for sheet, rows in xlsx_rows(z):
                out = out_name(os.path.splitext(f)[0] + " - " + re.sub(r'[\\/:*?"<>|]', "_", sheet) + ".csv", "")
                with open(out, "w", newline="", encoding="utf-8-sig") as fh: csv.writer(fh).writerows(rows)
                done("", out)

def col(i):
    s = ""
    while i: i, r = divmod(i - 1, 26); s = chr(65 + r) + s
    return s

def csv_to_xlsx():
    for f in choose([".csv"], "CSV files"):
        raw = open(f, "rb").read().decode("utf-8-sig", "replace")
        try: dialect = csv.Sniffer().sniff(raw[:4096], delimiters=",;\t")
        except csv.Error: dialect = csv.excel
        rows = list(csv.reader(io.StringIO(raw), dialect))
        xr = []
        for ri, r in enumerate(rows, 1):
            cs = []
            for ci, v in enumerate(r, 1):
                ref = "%s%d" % (col(ci), ri)
                if re.fullmatch(r"-?\d+(\.\d+)?", v.strip()): cs.append('<c r="%s"><v>%s</v></c>' % (ref, v.strip()))
                elif v != "": cs.append('<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (ref, escape(v)))
            xr.append('<row r="%d">%s</row>' % (ri, "".join(cs)))
        out = out_name(f, "", ".xlsx")
        M = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'; R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
            z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
            z.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook %s %s><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>' % (M, R))
            z.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
            z.writestr("xl/worksheets/sheet1.xml", '<?xml version="1.0" encoding="UTF-8"?><worksheet %s><sheetData>%s</sheetData></worksheet>' % (M, "".join(xr)))
        done(f, out)

def office_images():
    for f in choose([".docx", ".xlsx", ".pptx", ".docm", ".xlsm", ".pptm"], "Office files"):
        d = os.path.splitext(f)[0] + " (images)"; n = 0
        with zipfile.ZipFile(f) as z:
            for name in z.namelist():
                if "/media/" in name and not name.endswith("/"):
                    os.makedirs(d, exist_ok=True); n += 1
                    with z.open(name) as s, open(os.path.join(d, os.path.basename(name)), "wb") as o: shutil.copyfileobj(s, o)
        print("  %s -> %d image(s)%s" % (f, n, (" in '%s'" % d) if n else ""))

# ---------- run ----------
A = sys.argv[1:]
if len(A) < 2: print("Usage: inkmedia.py <pdf|img|video|audio|office> <job> [option]"); sys.exit(1)
G, J, O = A[0], A[1], (A[2] if len(A) > 2 else "")
if not CHOSEN: pick()
t0 = time.time()
try:
    if G == "pdf":
        if J == "fromimg": pdf_from_images()
        else:
            P = pypdf()
            {"merge": lambda: pdf_merge(P), "split": lambda: pdf_split(P), "extract": lambda: pdf_extract(P, True),
             "delete": lambda: pdf_extract(P, False), "rotate": lambda: pdf_rotate(P, O or "90"), "reorder": lambda: pdf_reorder(P),
             "compress": lambda: pdf_compress(P), "protect": lambda: pdf_protect(P), "unlock": lambda: pdf_unlock(P),
             "meta": lambda: pdf_meta(P), "images": lambda: pdf_images(P), "text": lambda: pdf_text(P),
             "word": lambda: pdf_to_word(P), "excel": lambda: pdf_to_excel(P), "jpg": lambda: pdf_to_jpg(P)}[J]()
    elif G == "img": img_job(J, O)
    elif G in ("video", "audio"): media_job(G, J, O)
    elif G == "office": {"text": office_text, "csv": xlsx_to_csv, "xlsx": csv_to_xlsx, "images": office_images}[J]()
    else: print("Unknown group.")
except KeyError: print("Unknown job.")
except (OSError, zipfile.BadZipFile, ValueError) as e: print("STOPPED: %s" % e)
print("Done in %.1fs." % (time.time() - t0))
