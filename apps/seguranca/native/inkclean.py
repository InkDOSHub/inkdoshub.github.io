# inkclean.py - PDF cleaner for a-Shell (iPad/iPhone). Pure Python, no installs.
# Run inside the folder chosen with pickFolder. Scans every PDF below it and
# neutralises risky names in place (/JavaScript -> /xxxxxxxxxx, same length,
# so the file keeps its size and structure). Dangers hidden in compressed
# object streams are only flagged. Reads 1 MB at a time: safe for big files.
# Log: inkclean-log.txt in the folder. Undo: python inkclean.py --undo
import os, re, sys, zlib, time

NAMES = ["JavaScript", "JS", "OpenAction", "AA", "Launch", "EmbeddedFiles",
         "EmbeddedFile", "RichMedia", "Flash", "Movie", "Sound", "XFA",
         "ImportData", "GoToE", "SubmitForm", "GoToR"]
def name_re(n):
    # PDF names are case-sensitive; only the #xx hex digits may vary in case
    return b"".join(b"(?:" + re.escape(c.encode()) + b"|#(?i:" + b"%02x" % ord(c) + b"))" for c in n)
DELIM = rb"(?=[\s/<>\[\]()%{}]|$)"
RX = re.compile(rb"/(?:" + b"|".join(name_re(n) for n in NAMES) + rb")" + DELIM)
RX_OBJSTM = re.compile(rb"/ObjStm" + DELIM)
CHUNK, OVER = 1 << 20, 64
LOG = "inkclean-log.txt"

def log(f, msg):
    print(msg)
    f.write(msg + "\n"); f.flush()

def objstm_risky(fh, offsets):
    # decompress each object stream a piece at a time and look for risky names
    for off in offsets:
        fh.seek(max(0, off - 2048)); head = fh.read(4096)
        i = head.find(b"stream", 2048 - min(off, 2048))
        if i < 0 or b"FlateDecode" not in head[:i]: continue
        j = i + 6
        if head[j:j+2] == b"\r\n": j += 2
        elif head[j:j+1] in (b"\n", b"\r"): j += 1
        fh.seek(max(0, off - 2048) + j)
        d, tail, total = zlib.decompressobj(), b"", 0
        try:
            while not d.eof:
                raw = fh.read(CHUNK)
                if not raw: break
                out = tail + d.decompress(raw, 8 * CHUNK)
                while d.unconsumed_tail and len(out) < 16 * CHUNK:
                    out += d.decompress(d.unconsumed_tail, 8 * CHUNK)
                if RX.search(out): return True
                tail = out[-OVER:]; total += len(out)
                if total > 256 * CHUNK: break  # cap 256 MB per stream
        except zlib.error:
            pass
    return False

def clean(path, lf):
    hits, objstm, enc = [], [], False
    with open(path, "rb") as fh:
        pos, prev = 0, b""
        while True:
            data = fh.read(CHUNK)
            if not data: break
            buf, base = prev + data, pos - len(prev)
            for m in RX.finditer(buf):
                a = base + m.start()
                if m.end() < len(buf) or not data or len(data) < CHUNK:
                    if not hits or hits[-1][0] != a: hits.append((a, m.group()))
            for m in RX_OBJSTM.finditer(buf):
                a = base + m.start()
                if a not in objstm: objstm.append(a)
            if b"/Encrypt" in buf: enc = True
            pos += len(data); prev = buf[-OVER:]
        hidden = False
        if objstm and not enc: hidden = objstm_risky(fh, objstm)
    seen, uniq = set(), []
    for a, t in hits:
        if a not in seen: seen.add(a); uniq.append((a, t))
    if uniq:
        with open(path, "r+b") as fh:
            for a, t in uniq:
                fh.seek(a)
                if fh.read(len(t)) != t: continue
                lf.write("PATCH\t%s\t%d\t%s\n" % (path, a, t.decode("latin-1"))); lf.flush()
                fh.seek(a); fh.write(b"/" + b"x" * (len(t) - 1))
        lf.flush()
    names = sorted(set(t.decode("latin-1") for _, t in uniq))
    if uniq: log(lf, "CLEANED  %s  (%s)" % (path, ", ".join(names)))
    if hidden: log(lf, "FLAGGED  %s  (risky content inside compressed streams, not cleaned)" % path)
    if objstm and enc: log(lf, "FLAGGED  %s  (encrypted, compressed parts not checked)" % path)
    return bool(uniq), hidden or (objstm and enc)

def real_name(t):
    return re.sub(r"#([0-9a-fA-F]{2})", lambda m: chr(int(m.group(1), 16)), t)[1:] in NAMES

def undo(only_wrong_case=False):
    n = 0
    if not os.path.exists(LOG): return 0
    for line in open(LOG, encoding="utf-8", errors="surrogateescape"):
        p = line.rstrip("\n").split("\t")
        if p[0] != "PATCH" or not os.path.exists(p[1]): continue
        if only_wrong_case and real_name(p[3]): continue
        t = p[3].encode("latin-1")
        with open(p[1], "r+b") as fh:
            fh.seek(int(p[2]))
            if fh.read(len(t)) == b"/" + b"x" * (len(t) - 1):
                fh.seek(int(p[2])); fh.write(t); n += 1
    if not only_wrong_case: print("Undo done: %d change(s) restored." % n)
    return n

def main():
    if "--undo" in sys.argv: return undo()
    t0, n, nc, nf, ne, cloud = time.time(), 0, 0, 0, 0, 0
    with open(LOG, "a", encoding="utf-8", errors="surrogateescape") as lf:
        log(lf, "=== inkclean %s in %s ===" % (time.strftime("%Y-%m-%d %H:%M"), os.getcwd()))
        lf.flush(); r = undo(True)
        if r: log(lf, "Restored %d harmless lowercase name(s) changed by the first version (e.g. /aa, /js)." % r)
        for root, dirs, files in os.walk("."):
            dirs[:] = [d for d in dirs if not d.startswith(".Trash")]
            for f in sorted(files):
                low = f.lower()
                if low.endswith(".pdf.icloud"): cloud += 1; continue
                if not low.endswith(".pdf"): continue
                path = os.path.join(root, f); n += 1
                print("[%d] %s" % (n, path), flush=True)
                try:
                    c, fl = clean(path, lf); nc += c; nf += bool(fl)
                except Exception as e:
                    ne += 1; log(lf, "ERROR    %s  (%s)" % (path, e))
        log(lf, "Done in %ds: %d PDF(s), %d cleaned, %d flagged, %d error(s), %d not downloaded from iCloud (skipped)."
            % (time.time() - t0, n, nc, nf, ne, cloud))
        if cloud: log(lf, "To check those too: in the Files app, long-press the folder > Download Now, then run again.")

main()
