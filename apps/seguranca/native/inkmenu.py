# InkDOS tools: one command, a numbered menu. Works in a-Shell (iPhone/iPad) and any terminal with Python 3.
# Every job asks for the folder when it runs. Nothing to type except numbers (and text for rename).
import os, sys, urllib.request

BASE = "https://hub.inkdos.workers.dev/apps/seguranca/native/"
V = "8"

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

HUB = "https://hub.inkdos.workers.dev/"

def hub(path, what):
    url = HUB + path
    print("\n%s needs a screen to see the pages, so it opens in the InkDOS Hub (still on this device, nothing uploaded):" % what)
    print("   " + url)
    try:
        import webbrowser; webbrowser.open(url)
    except Exception: pass
    print("If it didn't open, copy the link above into Safari.")

def media(group, job, opt=""):
    run("inkmedia.py", [group, job] + ([opt] if opt else []))

def pdf_rotate():
    media("pdf", "rotate", ask("Turn the pages:", [("Right (90)", "90"), ("Upside down (180)", "180"), ("Left (270)", "270")]))

PDF = [
    ("Merge PDFs into one", lambda: media("pdf", "merge")),
    ("Split a PDF into single pages", lambda: media("pdf", "split")),
    ("Keep only some pages", lambda: media("pdf", "extract")),
    ("Delete pages", lambda: media("pdf", "delete")),
    ("Change the page order", lambda: media("pdf", "reorder")),
    ("Rotate pages", pdf_rotate),
    ("Make smaller (compress)", lambda: media("pdf", "compress")),
    ("Add a password", lambda: media("pdf", "protect")),
    ("Remove the password", lambda: media("pdf", "unlock")),
    ("See or remove metadata (author, dates...)", lambda: media("pdf", "meta")),
    ("Images to PDF", lambda: media("pdf", "fromimg")),
    ("Save the images inside a PDF", lambda: media("pdf", "images")),
    ("PDF to text (.txt)", lambda: media("pdf", "text")),
    ("PDF to Word, text only (.docx)", lambda: media("pdf", "word")),
    ("Clean risky content (scripts, auto actions)", lambda: run("inkclean.py", [])),
    ("PDF to JPG or PNG (opens the Hub)", lambda: hub("visualizadores/bentopdf/pdf-to-jpg.html", "PDF to images")),
    ("PDF to Word keeping the layout (opens the Hub)", lambda: hub("visualizadores/bentopdf/pdf-to-docx.html", "PDF to Word")),
    ("PDF to Excel (opens the Hub)", lambda: hub("visualizadores/bentopdf/pdf-to-excel.html", "PDF to Excel")),
    ("Make a scanned PDF searchable, OCR (opens the Hub)", lambda: hub("visualizadores/bentopdf/ocr-pdf.html", "OCR")),
    ("Sign a PDF (opens the Hub)", lambda: hub("visualizadores/bentopdf/sign-pdf.html", "Signing")),
    ("Page numbers (opens the Hub)", lambda: hub("visualizadores/bentopdf/page-numbers.html", "Page numbers")),
    ("Watermark (opens the Hub)", lambda: hub("visualizadores/bentopdf/add-watermark.html", "Watermark")),
    ("Fill a form (opens the Hub)", lambda: hub("visualizadores/bentopdf/form-filler.html", "Form filling")),
    ("Edit text and annotate (opens the Hub)", lambda: hub("apps/editar-pdf/", "Editing")),
]

def img_convert():
    fr = ask("Convert images of type:", [("HEIC (iPhone photos)", "heic"), ("PNG", "png"), ("JPG", "jpg"), ("WebP", "webp"),
                                         ("TIFF", "tiff"), ("GIF", "gif"), ("BMP", "bmp")])
    to = ask("To:", [("JPG (smaller, works everywhere)", "jpg"), ("PNG", "png"), ("WebP", "webp"), ("PDF (one per image)", "pdf"),
                     ("TIFF", "tiff"), ("GIF", "gif"), ("BMP", "bmp")])
    if fr == to: print("Same type chosen, nothing to do."); return
    run("inkfinder.py", ["images", fr, to])

IMAGES = [
    ("Convert (HEIC to JPG and others)", img_convert),
    ("Resize", lambda: media("img", "resize", ask("Longest side:", [("3000 px (print)", "3000"), ("2000 px", "2000"),
                                                                    ("1280 px (web, e-mail)", "1280"), ("800 px (small)", "800")], 3))),
    ("Make smaller (compress to JPG)", lambda: media("img", "compress", ask("Quality:", [("High (85)", "85"), ("Medium (70)", "70"), ("Low (50)", "50")], 2))),
    ("Rotate", lambda: media("img", "rotate", ask("Turn:", [("Right (90)", "90"), ("Upside down (180)", "180"), ("Left (270)", "270")]))),
    ("Remove location and camera data", lambda: media("img", "strip")),
    ("Combine images into one PDF", lambda: media("pdf", "fromimg")),
    ("Edit, crop or draw (opens the Hub)", lambda: hub("apps/foto/", "Photo editing")),
]

def vid_convert():
    run("inkfinder.py", ["video", ask("Convert to:", [("MP4 video (plays everywhere)", "mp4"), ("MOV video (Apple)", "mov"), ("MKV video", "mkv"),
                                                      ("WebM video", "webm"), ("GIF animation", "gif"), ("MP3 audio only", "mp3"),
                                                      ("M4A audio only (Apple)", "m4a"), ("WAV audio only", "wav")])])

VIDEO = [
    ("Convert", vid_convert),
    ("Make smaller", lambda: media("video", "small", ask("How small:", [("A bit smaller, same size on screen", "4M"),
                                                                       ("Smaller, 720p", "2M"), ("Much smaller, 720p", "1M")], 2))),
    ("Cut (keep from a start to an end time)", lambda: media("video", "cut")),
    ("Save only the audio", lambda: media("video", "audio", ask("Audio type:", [("M4A (Apple)", "m4a"), ("MP3", "mp3"), ("WAV", "wav")]))),
    ("Make a GIF (first 15 seconds)", lambda: media("video", "gif")),
    ("Remove the sound", lambda: media("video", "mute")),
    ("Rotate", lambda: media("video", "rotate", ask("Turn:", [("Right (90)", "90"), ("Upside down (180)", "180"), ("Left (270)", "270")]))),
    ("Edit or record (opens the Hub)", lambda: hub("apps/video/", "Video editing")),
]

AUDIO = [
    ("Convert", lambda: media("audio", "convert", ask("Convert to:", [("MP3", "mp3"), ("M4A (Apple)", "m4a"), ("WAV", "wav"),
                                                                      ("FLAC (lossless)", "flac"), ("OGG", "ogg")]))),
    ("Cut (keep from a start to an end time)", lambda: media("audio", "cut")),
    ("Change the volume", lambda: media("audio", "volume", ask("Volume:", [("Even it out (normalise)", "even"), ("Louder (x1.5)", "1.5"),
                                                                           ("Much louder (x2)", "2"), ("Quieter (x0.6)", "0.6")]))),
    ("Join tracks into one", lambda: media("audio", "join")),
    ("Edit or record (opens the Hub)", lambda: hub("apps/musica/", "Audio editing")),
]

OFFICE = [
    ("Clean macros and risky links (Word, Excel, PowerPoint)", lambda: run("inksec.py", ["office", "--here"])),
    ("Excel to CSV", lambda: media("office", "csv")),
    ("CSV to Excel", lambda: media("office", "xlsx")),
    ("Word, PowerPoint or Excel to text", lambda: media("office", "text")),
    ("Save the images inside a document", lambda: media("office", "images")),
    ("Word to PDF (opens the Hub)", lambda: hub("visualizadores/bentopdf/word-to-pdf.html", "Word to PDF")),
    ("Excel to PDF (opens the Hub)", lambda: hub("visualizadores/bentopdf/excel-to-pdf.html", "Excel to PDF")),
    ("PowerPoint to PDF (opens the Hub)", lambda: hub("visualizadores/bentopdf/powerpoint-to-pdf.html", "PowerPoint to PDF")),
]

FILES = [
    ("See folder sizes", lambda: run("inkfinder.py", ["sizes"])),
    ("Find files by size, date or type", job_search),
    ("Find duplicate files", lambda: run("inkfinder.py", ["dupes"])),
    ("Merge two folders", job_merge),
    ("Rename many files at once", job_rename),
    ("Copy new and changed files to another folder", job_sync),
    ("Make a ZIP of a folder", lambda: run("inkfinder.py", ["zip"])),
    ("Open (extract) a ZIP", lambda: run("inkfinder.py", ["unzip"])),
    ("Check ZIPs and risky files (report only)", lambda: run("inksec.py", ["archive", "--here"])),
    ("Self-test (checks everything works on this device)", lambda: run("inkfinder.py", ["test"])),
]

GROUPS = [("PDF", PDF), ("Images", IMAGES), ("Video", VIDEO), ("Music and audio", AUDIO), ("Office documents", OFFICE), ("Files and folders", FILES)]

def number(prompt, n):
    try: a = input(prompt).strip()
    except (EOFError, KeyboardInterrupt): print(); sys.exit(0)
    if a.lower() in ("q", "exit", "quit"): sys.exit(0)
    return int(a) if a.isdigit() and 0 <= int(a) <= n else -1

print("\nInkDOS tools. Everything runs on this device; nothing is uploaded.")
print("You will choose the folder in a menu (a-Shell) or drag it here (computer).")
while True:
    print("\nWhat do you want to work with?")
    for i, (t, _) in enumerate(GROUPS, 1): print("  %d  %s" % (i, t))
    print("  0  Exit")
    g = number("Type a number and press Enter: ", len(GROUPS))
    if g == 0: break
    if g < 0: print("Please type a number from the list."); continue
    title, jobs = GROUPS[g - 1]
    while True:
        print("\n%s: what do you want to do?" % title)
        for i, (t, _) in enumerate(jobs, 1): print("  %2d  %s" % (i, t))
        print("   0  Back")
        j = number("Type a number and press Enter: ", len(jobs))
        if j == 0: break
        if j < 0: print("Please type a number from the list."); continue
        print()
        jobs[j - 1][1]()
        print("\nDone. Back to the %s menu." % title)
print("Bye.")
