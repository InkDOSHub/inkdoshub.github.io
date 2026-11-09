# inkfinder.py - Finder-style file jobs for any terminal (Windows, Linux, macOS) and a-Shell (iPhone/iPad).
# Pure Python, standard library only. Works on the current folder; reads files in 1 MB blocks.
# Commands (first argument):
#   test                      self-test in ~/Documents/teste with its own sample files (default)
#   sizes                     size of every folder, biggest first
#   search [min_MB] [days] [ext]   files over min_MB, changed in the last days, with that extension (0 = any)
#   dupes                     duplicate files (same size, then same hash)
#   merge SRC RULE            copy SRC into this folder; RULE = replace | keep | skip
#   rename FIND TO [number] [date]   in this folder: replace text in names; "number" adds 001, 002...; "date" adds the file date
#   sync DEST                 copy new and changed files from this folder to DEST (nothing is deleted)
#   zip NAME                  compress this folder into NAME.zip (next to it)
#   unzip FILE                extract FILE.zip into a folder with the same name
# Add "preview" to merge, rename or sync to see what would happen without changing anything.
# Every command writes inkfinder-log.txt in the folder.
import os, sys, time, shutil, hashlib, zipfile, tarfile, random, traceback

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

ROOT = os.path.expanduser("~/Documents/teste")
WORK = os.path.join(ROOT, "work")
LOG = os.path.join(ROOT, "inkfinder-log.txt")
BIG_MB = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 300
CHUNK = 1 << 20
results = []

def peak_mb():
    try:
        import resource
        r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return r / (1 << 20) if sys.platform in ("darwin", "ios") else r / 1024
    except Exception:
        return -1

def log(msg):
    print(msg, flush=True)
    with open(LOG, "a", encoding="utf-8") as f: f.write(msg + "\n")

def write(path, data=b"", mtime=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f: f.write(data)
    if mtime: os.utime(path, (mtime, mtime))

def digest(path):
    h = hashlib.blake2b(digest_size=16)
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(CHUNK), b""): h.update(b)
    return h.hexdigest()

def files_in(d):
    for r, _, fs in os.walk(d):
        for f in fs: yield os.path.join(r, f)

def rel(p, base): return os.path.relpath(p, base)

def step(name):
    def deco(fn):
        def run():
            t0 = time.time()
            try:
                detail = fn() or ""
                ok = True
            except AssertionError as e:
                ok, detail = False, "check failed: %s" % e
            except Exception as e:
                ok, detail = False, "error: %s | %s" % (e, traceback.format_exc().strip().splitlines()[-2].strip())
            dt = time.time() - t0
            results.append((name, ok))
            log("%s  %-28s %6.1fs  peak %5.0f MB  %s" % ("PASS" if ok else "FAIL", name, dt, peak_mb(), detail))
        return run
    return deco

# ---------- test data ----------
@step("1 create test files")
def setup():
    if os.path.exists(WORK): shutil.rmtree(WORK)
    A, B = os.path.join(WORK, "A"), os.path.join(WORK, "B")
    old = time.time() - 400 * 86400
    random.seed(1)
    for i in range(40):
        write(os.path.join(A, "docs", "note %02d.txt" % i), ("note %d\n" % i).encode() * 50)
    for i in range(10):
        write(os.path.join(A, "photos", "IMG_%04d.jpg" % i), os.urandom(200 * 1024), old)
    write(os.path.join(A, "docs", "report.pdf"), b"%PDF-1.4\n" + os.urandom(3 << 20))
    same = os.urandom(512 * 1024)
    write(os.path.join(A, "dupes", "copy1.bin"), same)
    write(os.path.join(A, "dupes", "sub", "copy2.bin"), same)
    write(os.path.join(A, "dupes", "different.bin"), os.urandom(512 * 1024))
    # B: overlaps A (same, changed and new files)
    for i in range(20):
        write(os.path.join(B, "docs", "note %02d.txt" % i), ("note %d\n" % i).encode() * 50)
    for i in range(20, 25):
        write(os.path.join(B, "docs", "note %02d.txt" % i), b"changed in B\n")
    write(os.path.join(B, "only-in-B.txt"), b"keep me")
    blk = os.urandom(CHUNK)
    with open(os.path.join(A, "big.bin"), "wb") as f:
        for _ in range(BIG_MB): f.write(blk)
    n = sum(1 for _ in files_in(WORK))
    return "%d files, big file %d MB" % (n, BIG_MB)

# ---------- jobs ----------
def folder_sizes(d):
    out = {}
    for r, dirs, fs in os.walk(d, topdown=False):
        out[r] = sum(os.path.getsize(os.path.join(r, f)) for f in fs) + sum(out.get(os.path.join(r, x), 0) for x in dirs)
    return out

@step("2 folder sizes")
def sizes():
    A = os.path.join(WORK, "A")
    s = folder_sizes(A)
    total = sum(os.path.getsize(p) for p in files_in(A))
    assert s[A] == total, "top folder size %d != %d" % (s[A], total)
    return "A = %.1f MB, photos = %.1f MB" % (s[A] / 1e6, s[os.path.join(A, "photos")] / 1e6)

@step("3 search size/date/type")
def search():
    A = os.path.join(WORK, "A")
    big = [p for p in files_in(A) if os.path.getsize(p) > 1 << 20]
    old = [p for p in files_in(A) if os.path.getmtime(p) < time.time() - 365 * 86400]
    jpg = [p for p in files_in(A) if p.lower().endswith(".jpg")]
    assert len(big) == 2 and len(old) == 10 and len(jpg) == 10, "big %d old %d jpg %d" % (len(big), len(old), len(jpg))
    return "over 1 MB: %d, older than 1 year: %d, .jpg: %d" % (len(big), len(old), len(jpg))

def merge(src, dst, policy):
    n = {"copied": 0, "replaced": 0, "kept both": 0, "skipped": 0}
    for p in files_in(src):
        t = os.path.join(dst, rel(p, src))
        os.makedirs(os.path.dirname(t), exist_ok=True)
        if not os.path.exists(t):
            shutil.copyfile(p, t); n["copied"] += 1
        elif policy == "replace":
            shutil.copyfile(p, t); n["replaced"] += 1
        elif policy == "keep":
            b, e = os.path.splitext(t); i = 2
            while os.path.exists("%s %d%s" % (b, i, e)): i += 1
            shutil.copyfile(p, "%s %d%s" % (b, i, e)); n["kept both"] += 1
        else:
            n["skipped"] += 1
    return n

@step("4 merge folders x3")
def merges():
    A = os.path.join(WORK, "A", "docs")
    out = []
    for pol in ("replace", "keep", "skip"):
        D = os.path.join(WORK, "merge-" + pol)
        shutil.copytree(os.path.join(WORK, "B", "docs"), D)
        n = merge(A, D, pol)
        cnt = len(list(files_in(D)))
        want = {"replace": 41, "keep": 66, "skip": 41}[pol]
        assert cnt == want, "%s: %d files, expected %d" % (pol, cnt, want)
        if pol == "replace": assert open(os.path.join(D, "note 20.txt"), "rb").read().startswith(b"note"), "replace kept old file"
        if pol == "skip": assert open(os.path.join(D, "note 20.txt"), "rb").read() == b"changed in B\n", "skip overwrote"
        out.append("%s %s" % (pol, n))
    return " | ".join(out)

@step("5 batch rename")
def rename():
    D = os.path.join(WORK, "A", "photos")
    fs = sorted(os.listdir(D))
    plan = []
    for i, f in enumerate(fs, 1):
        d = time.strftime("%Y-%m-%d", time.localtime(os.path.getmtime(os.path.join(D, f))))
        plan.append((f, "%s Trip %03d.jpg" % (d, i)))
    assert len(set(n for _, n in plan)) == len(plan), "name clash in plan"
    for a, b in plan: os.rename(os.path.join(D, a), os.path.join(D, b))
    now = sorted(os.listdir(D))
    assert now == sorted(n for _, n in plan), "names differ"
    return "%d renamed, e.g. %s -> %s" % (len(plan), plan[0][0], plan[0][1])

@step("6 compare + copy changes")
def compare():
    A, B = os.path.join(WORK, "A", "docs"), os.path.join(WORK, "B", "docs")
    new = changed = same = 0
    for p in files_in(A):
        t = os.path.join(B, rel(p, A))
        if not os.path.exists(t): new += 1; shutil.copyfile(p, t)
        elif os.path.getsize(p) != os.path.getsize(t) or digest(p) != digest(t): changed += 1; shutil.copyfile(p, t)
        else: same += 1
    assert (new, changed, same) == (16, 5, 20), "new %d changed %d same %d" % (new, changed, same)
    again = sum(1 for p in files_in(A) if digest(p) != digest(os.path.join(B, rel(p, A))))
    assert again == 0, "%d still differ" % again
    return "new %d, changed %d, same %d; second pass: in sync" % (new, changed, same)

@step("7 find duplicates")
def dupes():
    A = os.path.join(WORK, "A")
    by = {}
    for p in files_in(A): by.setdefault(os.path.getsize(p), []).append(p)
    groups = {}
    for ps in by.values():
        if len(ps) > 1:
            for p in ps: groups.setdefault(digest(p), []).append(p)
    found = [g for g in groups.values() if len(g) > 1]
    assert len(found) == 1 and len(found[0]) == 2, "groups %s" % [len(g) for g in found]
    return "1 group: " + ", ".join(rel(p, A) for p in found[0])

@step("8 ZIP create + extract")
def zips():
    A = os.path.join(WORK, "A")
    Z = os.path.join(WORK, "A.zip")
    with zipfile.ZipFile(Z, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as z:
        for p in files_in(A): z.write(p, rel(p, A))
    X = os.path.join(WORK, "unzipped")
    with zipfile.ZipFile(Z) as z:
        for i in z.infolist():
            t = os.path.join(X, i.filename); os.makedirs(os.path.dirname(t), exist_ok=True)
            with z.open(i) as s, open(t, "wb") as d: shutil.copyfileobj(s, d, CHUNK)
    bad = [p for p in files_in(A) if digest(p) != digest(os.path.join(X, rel(p, A)))]
    assert not bad, "%d files differ" % len(bad)
    return "zip %.0f MB, all files identical after extract" % (os.path.getsize(Z) / 1e6)

@step("9 TAR.GZ create + extract")
def tars():
    A = os.path.join(WORK, "A")
    T = os.path.join(WORK, "A.tar.gz")
    with tarfile.open(T, "w:gz", compresslevel=1) as t: t.add(A, arcname="A")
    X = os.path.join(WORK, "untarred")
    with tarfile.open(T, "r:gz") as t:
        t.extractall(X, filter="data") if hasattr(tarfile, "data_filter") else t.extractall(X)
    bad = [p for p in files_in(A) if digest(p) != digest(os.path.join(X, "A", rel(p, A)))]
    assert not bad, "%d files differ" % len(bad)
    return "tar.gz %.0f MB, all files identical" % (os.path.getsize(T) / 1e6)

def test_main():
    os.makedirs(ROOT, exist_ok=True)
    log("=== inkfinder %s | Python %s | %s ===" % (time.strftime("%Y-%m-%d %H:%M"), sys.version.split()[0], sys.platform))
    for f in (setup, sizes, search, merges, rename, compare, dupes, zips, tars): f()
    ok = sum(1 for _, o in results if o)
    log("Done: %d/%d passed. Peak memory %.0f MB with a %d MB file. Log: %s" % (ok, len(results), peak_mb(), BIG_MB, LOG))
    if "--keep" not in sys.argv:
        shutil.rmtree(WORK, ignore_errors=True); log("Test files removed (add --keep to keep them).")

# ---------- real-use commands ----------

PREVIEW = "preview" in sys.argv
ARGS = [a for a in sys.argv[1:] if a != "preview"]
if ARGS and ARGS[0] != "test" and not CHOSEN: pick()
HERE = os.getcwd()

def say(msg):
    print(msg, flush=True)
    try:
        with open(os.path.join(HERE, "inkfinder-log.txt"), "a", encoding="utf-8") as f: f.write(msg + "\n")
    except OSError: pass

def human(n):
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024: return "%.0f %s" % (n, u) if u == "B" else "%.1f %s" % (n, u)
        n /= 1024
    return "%.1f TB" % n

def mine(p): return os.path.basename(p) != "inkfinder-log.txt"

def cmd_sizes():
    s = folder_sizes(HERE)
    top = sorted(((v, k) for k, v in s.items()), reverse=True)[:40]
    for v, k in top: say("%10s  %s" % (human(v), rel(k, HERE)))

def cmd_search():
    mn = float(ARGS[1]) if len(ARGS) > 1 else 0; days = float(ARGS[2]) if len(ARGS) > 2 else 0
    ext = ARGS[3].lower().lstrip(".") if len(ARGS) > 3 and ARGS[3] != "0" else ""
    n = 0
    for p in files_in(HERE):
        st = os.stat(p)
        if mn and st.st_size < mn * 1e6: continue
        if days and st.st_mtime < time.time() - days * 86400: continue
        if ext and not p.lower().endswith("." + ext): continue
        n += 1; say("%10s  %s  %s" % (human(st.st_size), time.strftime("%Y-%m-%d", time.localtime(st.st_mtime)), rel(p, HERE)))
    say("%d file(s) found." % n)

DUP = "Duplicates removed"

def cmd_dupes():
    # dupes [list|auto|one]: list only, keep one of each automatically, or decide group by group.
    # Removed copies go to the folder DUP (same sub-paths), so nothing is lost until it is emptied.
    mode = ARGS[1] if len(ARGS) > 1 else "list"
    box = os.path.join(HERE, DUP)
    if os.path.isdir(box):
        old = [p for p in files_in(box)]
        size = sum(os.path.getsize(p) for p in old)
        say("The folder '%s' from an earlier run holds %d file(s), %s." % (DUP, len(old), human(size)))
        try: a = input("Delete it PERMANENTLY now? This cannot be undone. Type yes to delete, or Enter to keep it: ").strip().lower()
        except EOFError: a = ""
        if a == "yes":
            shutil.rmtree(box); say("Deleted '%s' permanently (%s freed)." % (DUP, human(size)))
        else: say("Kept '%s'." % DUP)
    by = {}
    for p in files_in(HERE):
        if mine(p) and not os.path.realpath(p).startswith(os.path.realpath(box) + os.sep): by.setdefault(os.path.getsize(p), []).append(p)
    groups = []
    for size, ps in sorted(by.items(), reverse=True):
        if len(ps) < 2 or size == 0: continue
        hs = {}
        for p in ps: hs.setdefault(digest(p), []).append(p)
        groups += [(size, sorted(same, key=lambda p: (os.path.getmtime(p), len(p)))) for same in hs.values() if len(same) > 1]
    waste = sum(size * (len(ps) - 1) for size, ps in groups)
    say("%d group(s) of duplicates, %s could be freed." % (len(groups), human(waste)))
    if not groups: return
    def move(p):
        t = os.path.join(box, rel(p, HERE)); os.makedirs(os.path.dirname(t), exist_ok=True)
        if os.path.exists(t): t = os.path.splitext(t)[0] + " (%d)" % int(time.time()) + os.path.splitext(t)[1]
        shutil.move(p, t); say("   moved  " + rel(p, HERE))
    moved = freed = 0
    for g, (size, ps) in enumerate(groups, 1):
        print("\nGroup %d of %d (%s each):" % (g, len(groups), human(size)))
        for i, p in enumerate(ps, 1):
            print("  %d  %s   %s" % (i, rel(p, HERE), time.strftime("%Y-%m-%d", time.localtime(os.path.getmtime(p)))))
        if mode == "list": continue
        keep = 1
        if mode == "one":
            try: a = input("Number to KEEP (the others are moved), Enter = skip, 0 = stop: ").strip()
            except EOFError: a = "0"
            if a == "0": break
            if not a.isdigit() or not 1 <= int(a) <= len(ps): print("  skipped"); continue
            keep = int(a)
        say("   keep   " + rel(ps[keep - 1], HERE))
        for i, p in enumerate(ps, 1):
            if i != keep: move(p); moved += 1; freed += size
    if mode != "list":
        say("\n%d file(s) moved to '%s' (%s). Check it in the Files app; run this again to delete it permanently." % (moved, DUP, human(freed)))
    else: say("Nothing was changed.")

def cmd_merge():
    rule = ARGS[2] if len(ARGS) > 2 else "skip"
    src = os.path.abspath(os.path.expanduser(ARGS[1])) if len(ARGS) > 1 and ARGS[1] not in ("", "-") else pick("folder to copy from", stay=False)
    assert os.path.isdir(src), "folder not found: " + src
    assert os.path.realpath(src) != os.path.realpath(HERE), "choose a different folder to copy from"
    if PREVIEW:
        n = {"new": 0, "exists": 0}
        for p in files_in(src): n["new" if not os.path.exists(os.path.join(HERE, rel(p, src))) else "exists"] += 1
        say("Preview: %d new file(s), %d already here (rule: %s). Nothing changed." % (n["new"], n["exists"], rule)); return
    say("Merged: %s" % merge(src, HERE, rule))

def cmd_rename():
    find, to = (ARGS[1] if len(ARGS) > 1 else ""), (ARGS[2] if len(ARGS) > 2 else "")
    fs = sorted(f for f in os.listdir(HERE) if os.path.isfile(os.path.join(HERE, f)) and f != "inkfinder-log.txt")
    plan = []
    for i, f in enumerate(fs, 1):
        b, e = os.path.splitext(f)
        nb = b.replace(find, to) if find else b
        if "number" in ARGS[3:]: nb = "%s %03d" % (nb if find else (to or nb), i) if (find or to) else "%03d %s" % (i, nb)
        if "date" in ARGS[3:]: nb = time.strftime("%Y-%m-%d ", time.localtime(os.path.getmtime(os.path.join(HERE, f)))) + nb
        if nb + e != f: plan.append((f, nb + e))
    news = [b for _, b in plan]
    clash = [b for b in news if news.count(b) > 1 or (os.path.exists(os.path.join(HERE, b)) and b not in [a for a, _ in plan])]
    assert not clash, "names would clash: " + ", ".join(sorted(set(clash))[:5])
    for a, b in plan:
        say("%s -> %s" % (a, b))
        if not PREVIEW: os.rename(os.path.join(HERE, a), os.path.join(HERE, b))
    say("%d file(s) %s." % (len(plan), "would be renamed (preview)" if PREVIEW else "renamed"))

def cmd_sync():
    dst = os.path.abspath(os.path.expanduser(ARGS[1])) if len(ARGS) > 1 and ARGS[1] else pick("destination folder", stay=False)
    os.makedirs(dst, exist_ok=True)
    new = changed = same = 0
    for p in files_in(HERE):
        if not mine(p): continue
        t = os.path.join(dst, rel(p, HERE))
        if not os.path.exists(t): new += 1; act = True
        elif os.path.getsize(p) != os.path.getsize(t) or digest(p) != digest(t): changed += 1; act = True
        else: same += 1; act = False
        if act:
            say(("NEW      " if not os.path.exists(t) else "CHANGED  ") + rel(p, HERE))
            if not PREVIEW: os.makedirs(os.path.dirname(t), exist_ok=True); shutil.copyfile(p, t)
    say("%d new, %d changed, %d same.%s" % (new, changed, same, " Preview: nothing copied." if PREVIEW else ""))

def cmd_zip():
    out = os.path.join(os.path.dirname(HERE), (ARGS[1] if len(ARGS) > 1 else os.path.basename(HERE)).removesuffix(".zip") + ".zip")
    n = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for p in files_in(HERE):
            if mine(p): z.write(p, rel(p, HERE)); n += 1
            if n % 200 == 0 and n: print("  ... %d" % n, flush=True)
    say("%d file(s) -> %s (%s)" % (n, out, human(os.path.getsize(out))))

def cmd_unzip():
    src = os.path.abspath(os.path.expanduser(ARGS[1] if len(ARGS) > 1 and ARGS[1] else pick_file([".zip"], "zip"))); X = os.path.splitext(src)[0]
    n = 0
    with zipfile.ZipFile(src) as z:
        for i in z.infolist():
            t = os.path.realpath(os.path.join(X, i.filename))
            assert t.startswith(os.path.realpath(X)), "unsafe path in zip: " + i.filename
            if i.is_dir(): os.makedirs(t, exist_ok=True); continue
            os.makedirs(os.path.dirname(t), exist_ok=True)
            with z.open(i) as s, open(t, "wb") as d: shutil.copyfileobj(s, d, CHUNK)
            n += 1
    say("%d file(s) extracted to %s" % (n, X))

VIDEO_IN = [".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".wmv", ".flv", ".3gp", ".mts", ".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg", ".opus", ".wma", ".aiff"]
IMAGE_IN = [".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".tif", ".tiff", ".bmp", ".avif"]

def run(cmd):
    print("$ " + cmd, flush=True)
    return os.system(cmd)

def q(p): return "'" + p.replace("'", "'\\''") + "'"

def pick_some(fs, what):
    # One file or all of them, chosen from a numbered list.
    if len(fs) == 1: print("File: " + fs[0]); return fs
    print("\n   0  ALL %d %s in this folder" % (len(fs), what))
    for i, f in enumerate(fs, 1): print("%4d  %s" % (i, f))
    try: a = input("Type a number (0 = all) and press Enter: ").strip()
    except EOFError: a = ""
    if a == "0": return fs
    if a.isdigit() and 1 <= int(a) <= len(fs): return [fs[int(a) - 1]]
    print("Invalid number."); sys.exit(1)

def cmd_video():
    to = (ARGS[1] if len(ARGS) > 1 else "mp4").lower().lstrip(".")
    fs = sorted(f for f in os.listdir(".") if os.path.isfile(f) and f.lower().endswith(tuple(VIDEO_IN)))
    if not fs: say("No video or audio files in this folder."); return
    for f in pick_some(fs, "video/audio files"):
        out = os.path.splitext(f)[0] + "." + to
        if os.path.exists(out): out = os.path.splitext(f)[0] + " (converted)." + to
        r = run("ffmpeg -nostdin -hide_banner -loglevel error -i %s %s" % (q(f), q(out)))
        say(("%s -> %s (%s)" % (f, out, human(os.path.getsize(out)))) if r == 0 and os.path.exists(out) else "FAILED   %s (ffmpeg code %s)" % (f, r))

def cmd_images():
    fr = (ARGS[1] if len(ARGS) > 1 else "heic").lower().lstrip("."); to = (ARGS[2] if len(ARGS) > 2 else "jpg").lower().lstrip(".")
    exts = (".jpg", ".jpeg") if fr in ("jpg", "jpeg") else (".heic", ".heif") if fr in ("heic", "heif") else (".tif", ".tiff") if fr in ("tif", "tiff") else ("." + fr,)
    fs = sorted(f for f in os.listdir(".") if os.path.isfile(f) and f.lower().endswith(exts))
    if not fs: say("No .%s images in this folder." % fr); return
    fs = pick_some(fs, ".%s images" % fr)
    try: from PIL import Image
    except ImportError: Image = None
    ok = bad = 0
    for f in fs:
        out = os.path.splitext(f)[0] + "." + to
        if os.path.exists(out): out = os.path.splitext(f)[0] + " (converted)." + to
        done = False
        if Image and fr not in ("heic", "heif", "avif"):
            try:
                im = Image.open(f)
                if to in ("jpg", "jpeg", "bmp") and im.mode not in ("RGB", "L"): im = im.convert("RGB")
                im.save(out); done = True
            except Exception: done = False
        if not done: done = run("magick %s %s" % (q(f), q(out))) == 0 and os.path.exists(out)
        if done: ok += 1; say("%s -> %s" % (f, out))
        else: bad += 1; say("FAILED   " + f)
    say("%d converted, %d failed. Originals kept." % (ok, bad))

CMDS = {"sizes": cmd_sizes, "search": cmd_search, "dupes": cmd_dupes, "merge": cmd_merge, "rename": cmd_rename,
        "sync": cmd_sync, "zip": cmd_zip, "unzip": cmd_unzip, "video": cmd_video, "images": cmd_images}
if not ARGS or ARGS[0] == "test":
    test_main()
elif ARGS[0] in CMDS:
    say("=== %s %s===" % (" ".join(ARGS), "(preview) " if PREVIEW else ""))
    t0 = time.time()
    try: CMDS[ARGS[0]]()
    except (AssertionError, IndexError, OSError, zipfile.BadZipFile) as e: say("STOPPED: %s" % (e or "missing argument"))
    say("Done in %.1fs, peak memory %.0f MB." % (time.time() - t0, peak_mb()))
else:
    print("Unknown command. Use: test, " + ", ".join(CMDS))
