# InkDOS tools: one command, a numbered menu. Works in a-Shell (iPhone/iPad) and any terminal with Python 3.
# Every job asks for the folder when it runs. Nothing to type except numbers (and text for rename).
import os, sys, urllib.request

BASE = "https://hub.inkdos.workers.dev/apps/seguranca/native/"
V = "5"

def get(name):
    req = urllib.request.Request(BASE + name + "?v=" + V, headers={"User-Agent": "curl/8"})
    return urllib.request.urlopen(req).read()

def run(script, args):
    start = os.getcwd()
    sys.argv = [script] + args
    try:
        exec(compile(get(script), script, "exec"), {"__name__": "__main__", "__file__": script})
    except SystemExit:
        pass
    except KeyboardInterrupt:
        print("\nStopped.")
    except Exception as e:
        print("Something went wrong: %s" % e)
    finally:
        try: os.chdir(start)
        except OSError: pass

def ask(question, options, default=1):
    print("\n" + question)
    for i, o in enumerate(options, 1): print("  %d  %s" % (i, o[0] if isinstance(o, tuple) else o))
    while True:
        try: a = input("Type a number and press Enter [%d]: " % default).strip()
        except EOFError: a = ""
        if not a: n = default
        elif a.isdigit(): n = int(a)
        else: n = 0
        if 1 <= n <= len(options):
            o = options[n - 1]
            return o[1] if isinstance(o, tuple) else o
        print("Please type a number from 1 to %d." % len(options))

def text(question, default=""):
    try: a = input("\n%s%s: " % (question, " [%s]" % default if default else "")).strip()
    except EOFError: a = ""
    return a or default

def yes(question, default=False):
    return ask(question, [("Yes", True), ("No", False)], 1 if default else 2)

def preview_first():
    return ask("Try it first without changing anything?", [("Yes, only show what would happen", True), ("No, do it now", False)], 1)

def job_search():
    mb = ask("Bigger than:", [("Any size", "0"), ("10 MB", "10"), ("100 MB", "100"), ("500 MB", "500"), ("1 GB", "1000")])
    days = ask("Changed in the last:", [("Any time", "0"), ("Day", "1"), ("Week", "7"), ("Month", "30"), ("Year", "365")])
    ext = ask("Type:", [("Any", "0"), ("PDF", "pdf"), ("Word", "docx"), ("Excel", "xlsx"), ("Photos (jpg)", "jpg"),
                        ("Photos (heic)", "heic"), ("Video (mp4)", "mp4"), ("Video (mov)", "mov"), ("ZIP", "zip")])
    run("inkfinder.py", ["search", mb, days, ext])

def job_merge():
    rule = ask("When a file already exists:", [("Keep both (adds a number to the new one)", "keep"),
                                               ("Replace with the other folder's file", "replace"), ("Skip it", "skip")])
    print("\nFirst choose the folder that RECEIVES the files, then the folder to copy FROM.")
    run("inkfinder.py", ["merge", "-", rule] + (["preview"] if preview_first() else []))

def job_rename():
    print("\nRenames the files in one folder (not the folders inside it).")
    find = text("Text to find in the names (Enter = none)")
    to = text("Replace it with" if find else "New name for all files (Enter = keep names)")
    args = ["rename", find, to]
    if yes("Add numbers 001, 002, 003...?", not find): args.append("number")
    if yes("Add the file date at the start?"): args.append("date")
    run("inkfinder.py", args + (["preview"] if preview_first() else []))

def job_sync():
    print("\nFirst choose the folder to copy FROM, then the destination. Nothing is deleted.")
    run("inkfinder.py", ["sync"] + (["preview"] if preview_first() else []))

def job_video():
    to = ask("Convert to:", [("MP4 video (plays everywhere)", "mp4"), ("MOV video (Apple)", "mov"), ("MKV video", "mkv"),
                             ("WebM video", "webm"), ("GIF animation", "gif"), ("MP3 audio only", "mp3"),
                             ("M4A audio only (Apple)", "m4a"), ("WAV audio only", "wav")])
    run("inkfinder.py", ["video", to])

def job_images():
    fr = ask("Convert images of type:", [("HEIC (iPhone photos)", "heic"), ("PNG", "png"), ("JPG", "jpg"), ("WebP", "webp"),
                                         ("TIFF", "tiff"), ("GIF", "gif"), ("BMP", "bmp")])
    to = ask("To:", [("JPG (smaller, works everywhere)", "jpg"), ("PNG", "png"), ("WebP", "webp"), ("PDF", "pdf"),
                     ("TIFF", "tiff"), ("GIF", "gif"), ("BMP", "bmp")])
    if fr == to: print("Same type chosen, nothing to do."); return
    run("inkfinder.py", ["images", fr, to])

JOBS = [
    ("Clean PDFs (remove hidden scripts and auto actions)", lambda: run("inkclean.py", [])),
    ("Clean Word/Excel/PowerPoint, check ZIPs and risky files", lambda: run("inksec.py", ["all", "--here"])),
    ("See folder sizes", lambda: run("inkfinder.py", ["sizes"])),
    ("Find files by size, date or type", job_search),
    ("Find duplicate files", lambda: run("inkfinder.py", ["dupes"])),
    ("Merge two folders", job_merge),
    ("Rename many files at once", job_rename),
    ("Copy new and changed files to another folder", job_sync),
    ("Make a ZIP of a folder", lambda: run("inkfinder.py", ["zip"])),
    ("Open (extract) a ZIP", lambda: run("inkfinder.py", ["unzip"])),
    ("Convert a video or audio file", job_video),
    ("Convert images", job_images),
    ("Self-test (checks everything works on this device)", lambda: run("inkfinder.py", ["test"])),
]

print("\nInkDOS tools. Everything runs on this device; nothing is uploaded.")
print("You will choose the folder in a menu (a-Shell) or drag it here (computer).")
while True:
    print("\nWhat do you want to do?")
    for i, (t, _) in enumerate(JOBS, 1): print("  %2d  %s" % (i, t))
    print("   0  Exit")
    try: a = input("Type a number and press Enter: ").strip()
    except (EOFError, KeyboardInterrupt): break
    if a == "0" or a.lower() in ("q", "exit", "quit"): break
    if not a.isdigit() or not 1 <= int(a) <= len(JOBS):
        print("Please type a number from the list."); continue
    print()
    JOBS[int(a) - 1][1]()
    print("\nDone. Back to the menu.")
print("Bye.")
