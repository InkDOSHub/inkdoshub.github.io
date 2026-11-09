#!/usr/bin/env python3
"""InkDOS Security engine for Linux and macOS (same jobs as the Windows scripts).

Not run directly: pdfclean.sh, officeclean.sh, archivescan.sh and riskyfiles.sh (same folder)
download this file and run:  python3 inksec.py pdf|office|archive|loose
One file type per run keeps scans small; several terminals can run at once (own temp folder each).
Only files of the chosen type are opened, so iCloud/OneDrive online-only videos are not downloaded.

pdf     needs qpdf (Linux: apt/dnf install qpdf, macOS: brew install qpdf). Renames risky PDF names
        (JavaScript, OpenAction, Launch, EmbeddedFiles...) to same-length harmless ones and rebuilds.
office  removes VBA macros, points external links (not hyperlinks) to about:blank, empties embedded
        OLE objects. Old .doc/.xls/.ppt with macros are only reported.
archive lists .zip (and .rar/.7z with 7z/7zz installed) and reports executables, scripts, shortcuts,
        disk images and double extensions. Report only.
loose   reports loose .exe/.lnk/.js/.vbs/.bat/.hta/.sh/.command/.app... files. Report only.
a-Shell (iPad/iPhone): cd into the folder, then  python3 inksec.py all  (office + archive + loose, no questions;
        Office files are cleaned in place, originals of changed files kept in ~/Documents/inkdos-backup).
Env (used by the retry line saved next to the report): INKSEC_RETRY = report CSV, INKSEC_OUT = R or folder.
"""
import csv, os, re, shutil, subprocess, sys, tempfile, time, zipfile

MODE = (sys.argv[1] if len(sys.argv) > 1 else "office").lower()
ASHELL = "/Containers/Data/Application/" in os.path.expanduser("~")
HERE_MODE = ASHELL or "--here" in sys.argv  # no questions: this folder, clean in place with backup
MODES = ["office", "archive", "loose"] if MODE == "all" else [MODE]
MODE = MODES[0]
TAG = {"pdf": "pdfclean", "office": "officeclean", "archive": "archivescan", "loose": "riskyfiles"}.get(MODE)
if not TAG:
    sys.exit("Unknown mode: " + MODE)
IS_MAC = sys.platform == "darwin"
BASE = "https://hub.inkdos.workers.dev/apps/seguranca/native/"

OOXML = {"docx", "docm", "dotx", "dotm", "xlsx", "xlsm", "xltx", "xltm", "xlam", "pptx", "pptm", "potx", "potm", "ppsx", "ppsm", "ppam"}
LEGACY = {"doc", "dot", "xls", "xlt", "ppt", "pps", "pot"}
ARCH = {"zip", "rar", "7z"}
RISK = {"exe", "scr", "com", "pif", "bat", "cmd", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "lnk", "ps1", "psm1",
        "msi", "msp", "reg", "jar", "cpl", "scf", "chm", "iso", "img", "vhd", "vhdx", "appx", "msix", "application",
        "sh", "command", "app", "pkg", "dmg", "desktop", "appimage", "deb", "rpm", "run", "scpt", "workflow"}
MACRO_OFFICE = {"docm", "xlsm", "pptm", "dotm", "xltm", "potm", "ppsm"}
DOC_RX = re.compile(r"\.(pdf|docx?|xlsx?|pptx?|txt|rtf|csv|jpe?g|png|gif|bmp|mp3|mp4|avi|mov|zip|rar|7z)[\s.]*\.[^.]+$", re.I)
BIG_CLOUD = 500 * 1024 * 1024
SF_DATALESS = 0x40000000  # macOS: online-only (iCloud Drive / OneDrive File Provider)
PDF_RISKY = ["JavaScript", "JS", "OpenAction", "AA", "Launch", "EmbeddedFiles", "RichMedia", "XFA", "SubmitForm", "ImportData", "GoToR"]

def ask(q):
    try:
        return input(q).strip().strip('"').strip("'")
    except EOFError:
        return ""

def ext_of(n):
    i = n.rfind(".")
    return "" if i < 0 else n[i + 1:].lower()

def risk_of(name):
    leaf = re.split(r"[\\/]", name.rstrip("/"))[-1]
    if "‮" in leaf:
        return "hidden right-to-left character in name"
    e = ext_of(leaf)
    if e in RISK:
        return ("double extension (.%s)" if DOC_RX.search(leaf) else "executable/script (.%s)") % e
    if e in MACRO_OFFICE:
        return "macro-enabled Office (.%s)" % e
    return ""

def is_cloud(p):
    try:
        return IS_MAC and bool(os.stat(p).st_flags & SF_DATALESS)
    except (OSError, AttributeError):
        return False

def evict(p):
    # put it back to online-only (iCloud Drive); other providers ignore it
    if ASHELL: return
    try: subprocess.run(["brctl", "evict", p], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception: pass

# ---------- PDF ----------
QPDF = shutil.which("qpdf") if MODE == "pdf" else None
if MODE == "pdf" and not QPDF:
    sys.exit("qpdf is needed. Install it with:  " + ("brew install qpdf" if IS_MAC else "sudo apt install qpdf   (or dnf/pacman install qpdf)"))

def run_qpdf(*a):
    r = subprocess.run([QPDF] + list(a), stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    msg = [l for l in r.stdout.decode("utf-8", "replace").splitlines() if re.search("qpdf|error|password", l)]
    return r.returncode, (msg[-1] if msg else "")

def clean_pdf(path, tmp):
    a, b, c = (os.path.join(tmp, x) for x in ("a.pdf", "b.pdf", "c.pdf"))
    code, msg = run_qpdf("--decrypt", "--object-streams=disable", "--stream-data=preserve", "--no-original-object-ids", "--", path, a)
    if code not in (0, 3):
        raise RuntimeError("qpdf could not read it (password-protected or badly damaged), exit %d: %s" % (code, msg.replace(path, "file")))
    data = open(a, "rb").read()
    hits = []
    for n in PDF_RISKY:
        rx = re.compile(rb"/" + n.encode() + rb"(?=[\s/<>\[\]()%{}]|$)")
        data, k = rx.subn(b"/" + n[:-1].encode() + (b"Z" if n.endswith("X") else b"X"), data)
        if k:
            hits.append("%s(%d)" % (n, k))
    if not hits:
        return None, ""
    open(b, "wb").write(data)
    code, msg = run_qpdf("--object-streams=generate", "--compress-streams=y", "--", b, c)
    if code not in (0, 3):
        raise RuntimeError("rebuild failed, exit %d" % code)
    return c, " ".join(hits)

# ---------- Office ----------
REL_RX = re.compile(r"<Relationship\b[^>]*?(/>|>\s*</Relationship>)")

def clean_ooxml(path, tmp):
    out = os.path.join(tmp, "o.zip")
    cnt = {"vba": 0, "ext": 0, "ole": 0}
    notes = []
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        names = {i.filename for i in infos}
        if "[Content_Types].xml" not in names:
            raise RuntimeError("not an Office file (no [Content_Types].xml)")
        removed = {"/" + n for n in names if re.search(r"(^|/)(vbaProject\.bin|vbaData\.xml|_rels/vbaProject\.bin\.rels)$", n)}
        cnt["vba"] = sum(1 for n in removed if n.endswith("vbaProject.bin"))
        xlm = sum(1 for n in names if "/macrosheets/" in n and "_rels/" not in n)
        ax = sum(1 for n in names if re.search(r"/activeX/[^/]+\.bin$", n))
        dde = False

        def rel(m):
            t = m.group(0)
            ty = (re.search(r'\bType="([^"]*)"', t) or [None, ""])[1]
            tg = (re.search(r'\bTarget="([^"]*)"', t) or [None, ""])[1]
            if ty.endswith("vbaProject") or tg.endswith("vbaProject.bin"):
                return ""
            if 'TargetMode="External"' in t and not ty.endswith("/hyperlink") and tg != "about:blank":
                cnt["ext"] += 1
                return re.sub(r'\bTarget="[^"]*"', 'Target="about:blank"', t)
            return t

        with zipfile.ZipFile(out, "w") as w:
            for i in infos:
                n = i.filename
                if "/" + n in removed:
                    continue
                data = z.read(i)
                if re.search(r"/embeddings/[^/]+\.(bin|docm|xlsm|pptm|xlsb)$", n) and data:
                    data = b""
                    cnt["ole"] += 1
                elif n.endswith(".rels"):
                    s = data.decode("utf-8-sig")
                    s2 = REL_RX.sub(rel, s)
                    if s2 != s:
                        data = s2.encode("utf-8")
                elif n == "[Content_Types].xml" and removed:
                    s = data.decode("utf-8-sig")
                    for p in removed:
                        s = re.sub(r'<Override\b[^>]*PartName="' + re.escape(p) + r'"[^>]*/>', "", s)
                    data = s.encode("utf-8")
                elif re.match(r"^word/(document|header\d*|footer\d*)\.xml$", n) or re.match(r"^xl/externalLinks/[^/]+\.xml$", n):
                    if re.search(rb"DDEAUTO|>\s*DDE\s|<ddeLink", data):
                        dde = True
                w.writestr(i, data, compress_type=i.compress_type)
    found = [f for f in ("macros(%d)" % cnt["vba"] if cnt["vba"] else "", "external-links(%d)" % cnt["ext"] if cnt["ext"] else "",
                         "OLE-objects(%d)" % cnt["ole"] if cnt["ole"] else "") if f]
    if xlm: notes.append("Excel 4.0 macro sheet(s): %d (not removed)" % xlm)
    if ax: notes.append("ActiveX control(s): %d (not removed)" % ax)
    if dde: notes.append("DDE field/link (not removed)")
    with zipfile.ZipFile(out) as z:  # result must still be a readable package
        if z.testzip() is not None:
            raise RuntimeError("rebuilt file failed the zip check")
    return (out if found else None), " ".join(found), "; ".join(notes)

def legacy_macros(path):
    with open(path, "rb") as f:
        return "_VBA_PROJECT".encode("utf-16-le") in f.read()

# ---------- Archives ----------
SEVEN = None if ASHELL else shutil.which("7zz") or shutil.which("7z") or shutil.which("7za")

def archive_names(path, e):
    if e == "zip":
        try:
            with zipfile.ZipFile(path) as z:
                return z.namelist()
        except Exception as ex:
            if not SEVEN:
                raise RuntimeError("could not read zip: %s" % ex)
    if not SEVEN:
        return None
    r = subprocess.run([SEVEN, "l", "-slt", "-ba", "-pinkdos-no-password", "--", path], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
    if r.returncode != 0:
        raise RuntimeError("7-Zip could not list it (password-protected or damaged), exit %d" % r.returncode)
    return [l[7:] for l in r.stdout.decode("utf-8", "replace").splitlines() if l.startswith("Path = ")]

# ---------- main ----------
def main():
    print("InkDOS Security: " + TAG)
    retry = os.environ.pop("INKSEC_RETRY", ""); out_pre = os.environ.pop("INKSEC_OUT", "")
    src = ""
    if HERE_MODE:
        src, out_pre = os.getcwd(), "R"
    elif not retry:
        a = os.path.expanduser(ask("Folder or drive to scan (or a %s report .csv to retry only its failed files): " % TAG))
        if a.lower().endswith(".csv"): retry = a
        else: src = a
    rows = None
    if retry:
        allr = list(csv.DictReader(open(retry, encoding="utf-8-sig")))
        rows = [r for r in allr if r["Status"].startswith("FAILED")]
        src = allr[0]["Root"] if allr and allr[0].get("Root") else os.path.dirname(os.path.abspath(retry))
        print("Retry mode: %d failed file(s) from %s" % (len(rows), retry))
        if not rows:
            print("No failed files in that report. Nothing to do."); return
    if not os.path.isdir(src):
        sys.exit("Folder not found: " + src)
    src = os.path.join(os.path.realpath(src), "")
    desk = os.path.expanduser("~/Desktop") if os.path.isdir(os.path.expanduser("~/Desktop")) else os.path.expanduser("~")
    cleaner = MODE in ("pdf", "office")
    in_place = False
    if cleaner:
        defo = os.path.join(desk, "PDF-clean" if MODE == "pdf" else "Office-clean")
        dst = out_pre or ask("Output folder [Enter = %s, R = replace the originals in place]: " % defo)
        if dst in ("R", "r"):
            in_place = True
            print("IN-PLACE MODE: risky files will be overwritten with the cleaned version. Everything else is left untouched.")
            if not out_pre and ask("Type YES to continue: ") != "YES":
                print("Cancelled."); return
            dst = src
        else:
            dst = os.path.expanduser(dst or defo)
    else:
        dst = src if HERE_MODE else os.path.join(desk, "InkDOS-security")
    os.makedirs(dst, exist_ok=True)
    dst = os.path.join(os.path.realpath(dst), "")

    want = {"pdf": {"pdf"}, "office": OOXML | LEGACY, "archive": ARCH}.get(MODE)
    if rows is not None:
        files = []
        for r in rows:
            p = os.path.join(src, r["File"])
            if os.path.isfile(p): files.append(p)
            else: print("Missing now: " + r["File"])
    else:
        print("Listing files (nothing is downloaded yet)...")
        files = []
        for root, dirs, fs in os.walk(src):
            if not in_place and os.path.join(root, "").startswith(dst) and dst != src:
                dirs[:] = []; continue
            if MODE == "loose":  # .app bundles are folders on macOS
                for d in list(dirs):
                    if d.lower().endswith(".app"):
                        files.append(os.path.join(root, d)); dirs.remove(d)
            for f in fs:
                if want is None or ext_of(f) in want:
                    if not f.startswith("~$"): files.append(os.path.join(root, f))
    total = len(files)
    print("%d file(s) found." % total)
    tmp = tempfile.mkdtemp(prefix="inkdos-%s-" % TAG)
    report = []
    n_fix = n_flag = n_fail = 0
    for i, p in enumerate(files, 1):
        rel = p[len(src):]
        e = ext_of(p)
        size = os.path.getsize(p) if os.path.isfile(p) else 0
        row = {"File": rel, "Kind": MODE, "Status": "", "Found": "", "Note": "", "SizeKB": size // 1024, "Root": src}
        if MODE == "loose":
            r = risk_of(p)
            if r:
                row.update(Status="FLAGGED", Found=r, Note="not changed"); report.append(row); n_flag += 1
                print("FLAGGED  %s  ->  %s" % (rel, r))
            continue
        if i % 20 == 0: print("  ... %d/%d" % (i, total))
        cloud = is_cloud(p)
        try:
            if MODE in ("pdf", "office") and e not in LEGACY:
                if MODE == "pdf":
                    res, found = clean_pdf(p, tmp); note = ""
                else:
                    res, found, note = clean_ooxml(p, tmp)
                target = p if in_place else os.path.join(dst, rel)
                if not in_place: os.makedirs(os.path.dirname(target), exist_ok=True)
                if res:
                    if HERE_MODE:
                        bk = os.path.join(os.path.expanduser("~/Documents" if os.path.isdir(os.path.expanduser("~/Documents")) else "~"), "inkdos-backup", rel)
                        os.makedirs(os.path.dirname(bk), exist_ok=True); shutil.copyfile(p, bk)
                    shutil.copyfile(res, target)
                    row.update(Status="CLEANED", Found=found); n_fix += 1
                    print("CLEANED  %s  ->  %s" % (rel, found))
                else:
                    if not in_place: shutil.copyfile(p, target)
                    row["Status"] = "clean (unchanged)"
                if note:
                    row["Note"] = note; n_flag += 1; print("NOTE     %s  ->  %s" % (rel, note))
            elif MODE == "office":
                if size > 200 * 1024 * 1024: row.update(Status="skipped", Note="over 200 MB")
                elif legacy_macros(p):
                    row.update(Status="FLAGGED", Found="macros (old format, not changed)"); n_flag += 1
                    print("FLAGGED  %s  ->  macros (old format)" % rel)
                else: row["Status"] = "no macros found"
            else:
                if cloud and size > BIG_CLOUD: row.update(Status="skipped", Note="online-only and over 500 MB (not downloaded)")
                else:
                    names = archive_names(p, e)
                    if names is None: row.update(Status="skipped", Note=("not checkable on iPad (only .zip)" if ASHELL else "needs 7-Zip (" + ("brew install sevenzip" if IS_MAC else "sudo apt install 7zip") + ")"))
                    else:
                        bad = ["%s [%s]" % (n, risk_of(n)) for n in names if risk_of(n)]
                        if bad:
                            row.update(Status="FLAGGED", Found="%d risky item(s)" % len(bad), Note="; ".join(bad[:15]) + ("; ..." if len(bad) > 15 else ""))
                            n_flag += 1; print("FLAGGED  %s  ->  %d risky item(s)" % (rel, len(bad)))
                        else: row["Status"] = "ok (%d item(s))" % len(names)
        except Exception as ex:
            row.update(Status="FAILED (left as is)", Note=str(ex)); n_fail += 1
            print("FAILED   %s  ->  %s" % (rel, ex))
        if cloud: evict(p)
        report.append(row)
    shutil.rmtree(tmp, ignore_errors=True)
    stamp = "" if cleaner else time.strftime("-%Y%m%d-%H%M%S") + "-%d" % os.getpid()
    rep = os.path.join(dst, "%s-report%s%s.csv" % (TAG, "-retry" if retry else "", stamp))
    with open(rep, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["File", "Kind", "Status", "Found", "Note", "SizeKB", "Root"]); w.writeheader(); w.writerows(report)
    print()
    if cleaner: print("Done. %d file(s): %d cleaned, %d flagged for you to check, %d failed." % (total, n_fix, n_flag, n_fail))
    else: print("Done. %d file(s) looked at: %d flagged for you to check, %d failed. Nothing was changed." % (total, n_flag, n_fail))
    print("Output: " + dst); print("Report: " + rep)
    if n_fail and not HERE_MODE:
        q = lambda v: "'" + v.replace("'", "'\\''") + "'"
        cmd = 'curl -fsSL "%s%s.sh?$RANDOM" | INKSEC_RETRY=%s INKSEC_OUT=%s bash' % (BASE, TAG, q(rep), q("R" if in_place else dst))
        txt = os.path.join(dst, "%s-retry%s.txt" % (TAG, stamp))
        open(txt, "w").write("Retry only the %d failed file(s): paste this line into the terminal\n\n%s\n" % (n_fail, cmd))
        print("Failed files were NOT changed. Retry command saved to: " + txt)

for MODE in MODES:
    TAG = {"office": "officeclean", "archive": "archivescan", "loose": "riskyfiles"}.get(MODE, TAG)
    main(); print()
