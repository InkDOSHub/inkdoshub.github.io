# inkfinder.py - tests Finder-style file jobs on iPad/iPhone (a-Shell), pure Python.
# Creates its own test files in ~/Documents/teste/work (Files app: On My iPad > a-Shell > teste),
# runs every job, checks the result and writes ~/Documents/teste/inkfinder-log.txt.
# Jobs: sizes, search, merge (replace / keep both / skip), batch rename, compare + copy changes,
# duplicates, streaming ZIP and TAR (create + extract), with time and peak memory for each.
import os, sys, time, shutil, hashlib, zipfile, tarfile, random, traceback

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

def main():
    os.makedirs(ROOT, exist_ok=True)
    log("=== inkfinder %s | Python %s | %s ===" % (time.strftime("%Y-%m-%d %H:%M"), sys.version.split()[0], sys.platform))
    for f in (setup, sizes, search, merges, rename, compare, dupes, zips, tars): f()
    ok = sum(1 for _, o in results if o)
    log("Done: %d/%d passed. Peak memory %.0f MB with a %d MB file. Log: %s" % (ok, len(results), peak_mb(), BIG_MB, LOG))
    if "--keep" not in sys.argv:
        shutil.rmtree(WORK, ignore_errors=True); log("Test files removed (add --keep to keep them).")

main()
