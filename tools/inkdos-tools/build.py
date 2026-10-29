#!/usr/bin/env python3
"""Build the InkDOS advanced tools site.

Every tool is an existing open-source project, fetched at the exact commit pinned in tools.json,
built (or copied) with its own tooling and placed under <out>/<id>/ together with its licence.
Nothing is rewritten beyond what is needed to serve it from a sub-path and without CDNs.

    python build.py --out _site            # all tools
    python build.py --out _site --only id  # one tool (for local checks)
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MANIFEST = json.loads((ROOT / 'tools.json').read_text(encoding='utf-8'))
BASE = MANIFEST['base']
JSZIP_VERSION = '3.10.1'


def run(cmd: list[str], cwd: Path, env: dict | None = None) -> None:
    print('+', ' '.join(cmd), f'(in {cwd.name})', flush=True)
    subprocess.run(cmd, cwd=cwd, check=True, env={**os.environ, **(env or {})})


def fetch(tool: dict, work: Path) -> Path:
    src = work / tool['id']
    if (src / '.git').exists():
        head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=src, capture_output=True, text=True).stdout.strip()
        if head == tool['ref']:
            return src
        shutil.rmtree(src)
    src.mkdir(parents=True)
    run(['git', 'init', '-q'], src)
    run(['git', 'remote', 'add', 'origin', tool['repo']], src)
    run(['git', 'fetch', '-q', '--depth', '1', 'origin', tool['ref']], src)
    run(['git', 'checkout', '-q', 'FETCH_HEAD'], src)
    return src


def copy_files(src: Path, dest: Path, names: list[str]) -> None:
    for name in names:
        source = src / name
        target = dest / name
        if source.is_dir():
            shutil.copytree(source, target)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)


def patch(file: Path, edits: list[tuple[str, str]]) -> None:
    """Apply exact replacements to an upstream file; fail loudly if upstream no longer matches."""
    text = file.read_text(encoding='utf-8')
    for old, new in edits:
        if new in text:
            continue  # already applied (rebuild of the same checkout)
        if text.count(old) != 1:
            sys.exit(f'{file}: expected exactly one occurrence of {old!r}')
        text = text.replace(old, new)
    file.write_text(text, encoding='utf-8')


def inkdos_skin(page: Path, tool_id: str, theme_script: bool = True) -> None:
    """Give a tool page the InkDOS look: site-src/skins/inkdos.css (InkDOS tokens) and skins/<tool>.css after the
    tool's own styles; viewers/viewer-theme.js first, so the tokens follow the InkDOS light/dark appearance."""
    text = page.read_text(encoding='utf-8')
    links = (f'<link rel="stylesheet" href="{BASE}skins/inkdos.css"><link rel="stylesheet" href="{BASE}skins/{tool_id}.css">')
    if links in text:
        return
    if '<head>' not in text or '</head>' not in text:
        sys.exit(f'{page}: no <head> to add the InkDOS skin to')
    if theme_script:
        text = text.replace('<head>', f'<head><script src="{BASE}viewers/viewer-theme.js"></script>', 1)
    page.write_text(text.replace('</head>', links + '</head>', 1), encoding='utf-8')


# ---- builders: one per tool; each writes the tool's static files into `dest` -------------------

def build_pnk(src: Path, dest: Path, tool: dict) -> None:
    # needs cargo with the wasm32-unknown-unknown target and wasm-bindgen 0.2.127 on PATH
    # the viewer's only outbound request is an opt-out setting that asks Google Fonts for substitutes
    # of the fonts a document names; InkDOS tools make no network requests unless the user asks, so
    # the default is flipped to off (the setting stays available in the viewer)
    patch(src / 'viewer' / 'src' / 'webfonts.ts', [
        ('return window.localStorage.getItem(SETTING_KEY) !== "0";', 'return window.localStorage.getItem(SETTING_KEY) === "1";'),
        ('// Storage can throw (private mode, blocked site data). Default is on.\n    return true;',
         '// Storage can throw (private mode, blocked site data). Default is off.\n    return false;'),
    ])
    run(['npm', 'ci', '--no-audit', '--no-fund'], src / 'viewer')
    run(['bash', 'scripts/build_viewer.sh'], src)
    shutil.copytree(src / 'viewer' / 'dist', dest, dirs_exist_ok=True)
    shutil.copy2(src / 'LICENSE-APACHE', dest / 'UPSTREAM-LICENSE-APACHE.txt')
    # InkDOS embed mode (site-src/viewers/): follow the InkDOS theme and accept a file handed over by
    # an InkDOS workspace; pnk's own code is unchanged
    patch(dest / 'index.html', [
        ('<link rel="stylesheet" href="styles.css">',
         '<link rel="stylesheet" href="styles.css">\n  <link rel="stylesheet" href="../viewers/pnk-embed.css">\n'
         '  <script src="../viewers/viewer-theme.js"></script>'),
        ('</body>', '<script src="../viewers/pnk-embed.js"></script>\n<script src="../viewers/viewer-embed.js"></script>\n</body>'),
    ])


def build_odf(src: Path, dest: Path, tool: dict) -> None:
    # WebODF's own cmake build (closure compiler) produces webodf.js. Its 2016 build scripts use
    # Node APIs that later Node versions reject, so they run on Node 6 from the npm registry.
    node6 = src.parent / 'node6'
    if not (node6 / 'node_modules' / 'node').exists():
        node6.mkdir(parents=True, exist_ok=True)
        run(['npm', 'install', '--no-audit', '--no-fund', '--prefix', str(node6), 'node@6.17.1'], node6)
    node = (node6 / 'node_modules' / 'node' / 'bin' / 'node').resolve()
    build = src.parent / f"{tool['id']}-build"
    shutil.rmtree(build, ignore_errors=True)
    build.mkdir(parents=True)
    env = {'PATH': f"{node.parent}{os.pathsep}{os.environ['PATH']}"}
    # a shallow fetch has no tags for WebODF's git-describe version check; the pinned commit is v0.5.10
    run(['cmake', f'-DNODE={node}', '-DOVERRULED_WEBODF_VERSION=0.5.10', str(src)], build, env=env)
    run(['make', 'webodf.js-target'], build, env=env)
    shutil.copy2(build / 'webodf' / 'webodf.js', dest / 'webodf.js')
    # the viewer page around WebODF's OdfCanvas (site-src/odf/)
    copy_files(ROOT / 'site-src' / 'odf', dest, ['index.html', 'viewer.js'])


def npm_pack(specs: list[str], into: Path) -> list[Path]:
    """Download npm packages as tarballs (no install scripts run) and return their paths."""
    into.mkdir(parents=True, exist_ok=True)
    out = subprocess.run(['npm', 'pack', '--silent', *specs], cwd=into, check=True, capture_output=True, text=True).stdout
    return [into / name for name in out.split()]


# PyMuPDF engine (BentoPDF Condense compression and others): a 2200-page PDF ran an iPhone page out of memory (gray
# screen) at about 2.4 GB. The engine now starts with PyMuPDF and fontTools only (numpy, OpenCV, lxml and the Word
# converters load the first time a tool needs them); compression always repairs the file first (as upstream), looks
# for images only when there are any, and on long documents (over 300 pages) skips the full content clean, the thumbnail
# scrub and font subsetting unless the fonts are a large part of the file; the result comes back through the file
# system instead of base64. Measured in Chromium on a 15 MB, 2200-page text PDF: about 0.8 GB, twice as fast.
PYMUPDF_EDITS = [
    ("var PyMuPDF = class {", "var LIGHT_WHEEL = /^(pymupdf-|fonttools-|typing_extensions-)/;\nvar PyMuPDF = class {"),
    ("""  async load() {
    await this.getPyodide();
  }
  async getPyodide() {
    if (this.pyodide) return this.pyodide;""", """  async load() {
    await this.getPyodideBase();
  }
  async getPyodide() {
    const pyodide = await this.getPyodideBase();
    if (!this.fullPromise) this.fullPromise = (async () => {
      await Promise.all(ASSETS.wheels.filter((wheel) => !LIGHT_WHEEL.test(wheel)).map((wheel) => pyodide.loadPackage(this.getAssetPath(wheel))));
      pyodide.runPython("import cv2\\nimport numpy as np");
    })();
    await this.fullPromise;
    return pyodide;
  }
  async getPyodideBase() {
    if (this.pyodide) return this.pyodide;"""),
    ("      ASSETS.wheels.map((wheel) => pyodide.loadPackage(this.getAssetPath(wheel)))\n",
     "      ASSETS.wheels.filter((wheel) => LIGHT_WHEEL.test(wheel)).map((wheel) => pyodide.loadPackage(this.getAssetPath(wheel)))\n"),
    ("import pymupdf\nimport cv2\nimport numpy as np\npymupdf.TOOLS.store_shrink(100)", "import pymupdf\npymupdf.TOOLS.store_shrink(100)"),
    ("  async compressPdf(pdf, options) {\n    const pyodide = await this.getPyodide();",
     "  async compressPdf(pdf, options) {\n    const pyodide = await this.getPyodideBase();"),
    ("# Pre-repair: Fix corrupted xrefs before processing\ndoc = repair_pdf(doc)",
     "# Pre-repair every file, as upstream does (owner, 2026-10-11): a bad xref that opens without a repair stopped\n"
     "# scrub with 'bad xref'\n"
     "doc = repair_pdf(doc)\n"
     "_big = doc.page_count > 300 and ${globalThis.__inkdosLowMem ? \"True\" : \"False\"}\n"
     "def _font_bytes():\n"
     "    _total = 0\n"
     "    for _x in range(1, doc.xref_length()):\n"
     "        for _k in ('FontFile', 'FontFile2', 'FontFile3'):\n"
     "            _t, _v = doc.xref_get_key(_x, _k)\n"
     "            if _t == 'xref':\n"
     "                _l = doc.xref_get_key(int(_v.split()[0]), 'Length')\n"
     "                if _l[0] == 'int':\n"
     "                    _total += int(_l[1])\n"
     "    return _total"),
    ('    thumbnails=${scrubThumbnails ? "True" : "False"},', '    thumbnails=${scrubThumbnails ? "True" : "False"} and not _big,'),
    ('if ${compressImages ? "True" : "False"}:',
     'if ${compressImages ? "True" : "False"} and any(doc.xref_get_key(_x, "Subtype")[1] == "/Image" for _x in range(1, doc.xref_length())):'),
    ('if ${subsetFonts ? "True" : "False"}:\n    doc.subset_fonts()',
     'if ${subsetFonts ? "True" : "False"} and (not _big or _font_bytes() * 3 > ${originalSize}):\n    doc.subset_fonts()'),
    ("pdf_bytes = doc.tobytes(\n    garbage=${garbage},", "pdf_bytes = doc.tobytes(\n    garbage=min(${garbage}, 3) if _big else ${garbage},"),
    ('    clean=${clean ? "True" : "False"}\n)', '    clean=${clean ? "True" : "False"} and not _big\n)'),
    ("""json.dumps({
    'data': base64.b64encode(pdf_bytes).decode('ascii'),""", """with open("/compress_output_${docId}", "wb") as _f:
    _f.write(pdf_bytes)
pdf_bytes = None
json.dumps({"""),
    ("""    const parsed = JSON.parse(result);
    const binary = atob(parsed.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const compressedSize = parsed.compressedSize;""", """    const parsed = JSON.parse(result);
    const bytes = pyodide.FS.readFile(`/compress_output_${docId}`);
    try {
      pyodide.FS.unlink(`/compress_output_${docId}`);
    } catch {
    }
    const compressedSize = parsed.compressedSize;"""),
]


def untar(tgz: Path, dest: Path, inner: str = '') -> None:
    """Extract package/<inner> of an npm tarball into dest."""
    with tarfile.open(tgz) as tar:
        prefix = 'package/' + (inner.strip('/') + '/' if inner else '')
        for member in tar.getmembers():
            if not member.isfile() or not member.name.startswith(prefix):
                continue
            target = dest / member.name[len(prefix):]
            target.parent.mkdir(parents=True, exist_ok=True)
            with tar.extractfile(member) as data:
                target.write_bytes(data.read())


def build_bentopdf(src: Path, dest: Path, tool: dict) -> None:
    # Self-hosted ("simple mode") build with every runtime asset served from this site, following the
    # project's own air-gap recipe (scripts/prepare-airgap.sh): no CDN, no GitHub API call.
    base = f"{BASE}{tool['id']}/"
    wasm = base + 'wasm'
    versions = dict(re.findall(r"(\w+): '([^']+)'", (src / 'src/js/const/cdn-version.ts').read_text(encoding='utf-8')))
    lock = json.loads((src / 'package-lock.json').read_text(encoding='utf-8'))['packages']
    tesseract, tesseract_core = lock['node_modules/tesseract.js']['version'], lock['node_modules/tesseract.js-core']['version']
    cpdf = re.search(r"coherentpdf@([\d.]+)/", (src / 'src/js/utils/wasm-provider.ts').read_text(encoding='utf-8')).group(1)
    languages = ['eng', 'por']
    env = {
        'BASE_URL': base, 'SIMPLE_MODE': 'true', 'DISABLE_GITHUB_STARS': 'true', 'COMPRESSION_MODE': 'o',
        'SITE_URL': f"https://inkdos-tools.github.io{base}", 'HUSKY': '0', 'NODE_OPTIONS': '--max-old-space-size=4096',
        'VITE_WASM_PYMUPDF_URL': f'{wasm}/pymupdf/', 'VITE_WASM_GS_URL': f'{wasm}/gs/', 'VITE_WASM_CPDF_URL': f'{wasm}/cpdf/',
        'VITE_TESSERACT_WORKER_URL': f'{wasm}/ocr/worker.min.js', 'VITE_TESSERACT_CORE_URL': f'{wasm}/ocr/core',
        'VITE_TESSERACT_LANG_URL': f'{wasm}/ocr/lang-data', 'VITE_TESSERACT_AVAILABLE_LANGUAGES': ','.join(languages),
        'VITE_OCR_FONT_BASE_URL': f'{wasm}/ocr/fonts', 'VITE_EMBEDPDF_FONTS_URL': f'{wasm}/embedpdf',
        # the project's own branding options (docs/self-hosting): InkDOS name and PDF icon, upstream credit in the footer
        'VITE_BRAND_NAME': 'InkDOS PDF', 'VITE_BRAND_LOGO': 'images/inkdos-pdf.svg',
        'VITE_FOOTER_TEXT': f"Based on BentoPDF ({tool['license']}), source: {tool['repo']}",
    }
    shutil.copy2(ROOT / 'site-src' / 'skins' / 'pdf.svg', src / 'public' / 'images' / 'inkdos-pdf.svg')
    # The start page reloaded itself when its service worker took control (first visit, and after every deploy of
    # this site), and a new worker asked to reload too: a tool tapped meanwhile (slow on iPad/iPhone) was cancelled
    # by that reload and the user landed back on the list. The worker activates on its own (skipWaiting, claim) and
    # pages work without it, so the start page no longer reloads for it.
    patch(src / 'src/js/sw-register.ts', [
        ("                if (\n"
         "                  confirm(\n"
         "                    'A new version of BentoPDF is available. Reload to update?'\n"
         "                  )\n"
         "                ) {\n"
         "                  newWorker.postMessage({ type: 'SKIP_WAITING' });\n"
         "                  window.location.reload();\n"
         "                }",
         "                newWorker.postMessage({ type: 'SKIP_WAITING' }); // InkDOS-tools: no reload prompt"),
        ("      console.log('[SW] New service worker activated, reloading...');\n"
         "      window.location.reload();",
         "      console.log('[SW] New service worker activated'); // InkDOS-tools: no reload (it cancelled a tool being opened)"),
    ])
    # The project's own host serves every page under /<lang>/ too (pt/split-pdf.html); GitHub Pages cannot, so in a
    # browser set to another language than English every tool link led to a missing page and the 404 page sent the
    # user back to the list (Split PDF on an iPad in Portuguese). Links keep their plain address and the language
    # comes from storage and the browser, as on the start page.
    patch(src / 'src/js/i18n/i18n.ts', [
        ("  if (currentLang === 'en') return;\n",
         "  if (currentLang) return; // InkDOS-tools: no /<lang>/ pages on GitHub Pages, links stay as they are\n"),
        ("    newRelativePath = `/${lang}${pagePathWithoutLang}`;",
         "    newRelativePath = pagePathWithoutLang; // InkDOS-tools: no /<lang>/ pages; the language is stored"),
    ])
    # thumbnails: Organize and Delete pages drew every page at full size and every tool kept PNG data URLs, about
    # +750 MB in WebKit for a 300-page PDF (iPhone pages ran out of memory); there thumbnails are about 200 px wide JPEG
    # WebKit only (iOS/iPadOS/Safari, flagged by viewers/bento-carry.js as window.__inkdosLowMem); Chromium unchanged
    low = "(globalThis as any).__inkdosLowMem"
    thumb = f"({low} ? page.getViewport({{ scale: Math.min(1, 200 / page.getViewport({{ scale: 1 }}).width) }}) : page.getViewport({{ scale: 1 }}))"
    for name in ('organize-pdf-page.ts', 'delete-pages-page.ts'):
        patch(src / 'src/js/logic' / name, [("    const viewport = page.getViewport({ scale: 1 });\n", f"    const viewport = {thumb};\n")])
    for name in ('organize-pdf-page.ts', 'delete-pages-page.ts', 'duplicate-organize.ts', 'split-pdf-page.ts', 'merge-pdf-page.ts'):
        patch(src / 'src/js/logic' / name, [("img.src = canvas.toDataURL();",
               f"if ({low}) {{ img.src = canvas.toDataURL('image/jpeg', 0.8); canvas.width = canvas.height = 0; }} else img.src = canvas.toDataURL();")])
    # the shared page renderer (Rotate, Rotate custom, Split, Merge and other page tools) draws smaller pages there
    patch(src / 'src/js/utils/render-utils.ts', [("      scale: useLazyLoading ? 0.5 : 1,\n", f"      scale: {low} ? 0.3 : useLazyLoading ? 0.5 : 1,\n")])
    # previews (Crop, Posterize) drawn at 2.5x / 1.5x are drawn at 1x there; the final output keeps its scale
    for name, scale in (('crop-pdf-page.ts', '2.5'), ('cropper.ts', '2.5'), ('posterize-page.ts', '1.5')):
        patch(src / 'src/js/logic' / name, [(f"\n    const viewport = page.getViewport({{ scale: {scale} }});",
               f"\n    const viewport = page.getViewport({{ scale: {low} ? 1 : {scale} }});")])
    run(['npm', 'ci', '--no-audit', '--no-fund'], src, env={'HUSKY': '0'})
    run(['npx', 'vite', 'build'], src, env=env)
    shutil.copytree(src / 'dist', dest, dirs_exist_ok=True)
    packs = src.parent / f"{tool['id']}-packs"
    shutil.rmtree(packs, ignore_errors=True)
    tgz = dict(zip(['pymupdf', 'gs', 'cpdf', 'tess', 'core', 'latin', *languages], npm_pack([
        f"@bentopdf/pymupdf-wasm@{versions['pymupdf']}", f"@bentopdf/gs-wasm@{versions['ghostscript']}", f'coherentpdf@{cpdf}',
        f'tesseract.js@{tesseract}', f'tesseract.js-core@{tesseract_core}', '@embedpdf/fonts-latin@1.0.0',
        *[f'@tesseract.js-data/{lang}' for lang in languages]], packs)))
    out = dest / 'wasm'
    untar(tgz['pymupdf'], out / 'pymupdf')
    patch(out / 'pymupdf' / 'dist' / 'index.js', PYMUPDF_EDITS)
    untar(tgz['gs'], out / 'gs', 'assets')
    untar(tgz['cpdf'], out / 'cpdf', 'dist')
    untar(tgz['tess'], out / 'ocr', 'dist')
    untar(tgz['core'], out / 'ocr' / 'core')
    untar(tgz['latin'], out / 'embedpdf' / 'fonts-latin@1.0.0')
    for lang in languages:
        untar(tgz[lang], out / 'ocr' / 'lang-data', '4.0.0_best_int')
    font = re.search(r"'Noto Sans':\s*'([^']+)'", (src / 'src/js/config/font-mappings.ts').read_text(encoding='utf-8')).group(1)
    # the OCR text-layer font the project pins (Noto Sans Regular, OFL) is the same file @embedpdf/fonts-latin ships
    (out / 'ocr' / 'fonts').mkdir(parents=True, exist_ok=True)
    shutil.copy2(out / 'embedpdf' / 'fonts-latin@1.0.0' / 'fonts' / 'NotoSans-Regular.ttf', out / 'ocr' / 'fonts' / font.rsplit('/', 1)[1])
    # GitHub Pages cannot send COOP/COEP headers; LibreOffice WASM (Office/ODF to PDF) needs SharedArrayBuffer,
    # so the project's own service worker adds them (coi-serviceworker technique), but only to the pages whose
    # tool loads LibreOffice: on iOS Safari an isolated page opened from another one went straight back, so every
    # other tool stays a plain page
    coi_pages = sorted(base + page.name for page in dest.glob('*.html') if needs_isolation(page, dest, base))
    if not coi_pages:
        sys.exit('bentopdf: no page loads LibreOffice; the isolation list would be empty')
    sw = dest / 'sw.js'
    # a new cache name, so devices that kept the previous PyMuPDF engine (cache-first, same file names) take this one
    sw.write_text(re.sub(r"const CACHE_VERSION = '([^']+?)(?:-inkdos\d+)?';", r"const CACHE_VERSION = '\1-inkdos2';",
                         sw.read_text(encoding='utf-8'), count=1), encoding='utf-8')
    sw.write_text(COI_PRELUDE.replace('__COI_PAGES_JSON__', json.dumps(coi_pages)) + sw.read_text(encoding='utf-8'), encoding='utf-8')
    # offline: pages stored without their query (?inkdos-theme=) still answer for it, and the files the project's
    # worker leaves to the network (OCR data and other extensions it does not list) are kept the same way as pages
    patch(sw, [
        ('    const cachedResponse = await caches.match(request);\n',
         '    const cachedResponse = await caches.match(request, { ignoreSearch: true });\n'),
        ('    event.respondWith(networkFirstStrategy(event.request));\n  }\n});',
         '    event.respondWith(networkFirstStrategy(event.request));\n  } else if (isLocal) {\n'
         '    event.respondWith(networkFirstStrategy(event.request));\n  }\n});'),
    ])
    reload = COI_RELOAD.replace('SW_URL', json.dumps(base + 'sw.js'))
    for page in dest.rglob('*.html'):
        text = page.read_text(encoding='utf-8')
        if base + page.name in coi_pages and page.parent == dest and '<head>' in text and reload not in text:
            page.write_text(text.replace('<head>', '<head>' + reload, 1), encoding='utf-8')
        text = page.read_text(encoding='utf-8')
        if '<head>' in text and BFCACHE_OFF not in text:
            text = text.replace('<head>', '<head>' + BFCACHE_OFF, 1)
            page.write_text(text, encoding='utf-8')
        if '<head>' in text and DOWNLOAD_PANEL not in text:
            text = text.replace('<head>', '<head>' + DOWNLOAD_PANEL, 1)
            page.write_text(text, encoding='utf-8')
        if page.parent == dest and '<head>' in text and BENTO_CARRY not in text:  # the toolkit pages, not the viewers
            text = text.replace('<head>', '<head>' + BENTO_CARRY, 1)
            page.write_text(text, encoding='utf-8')
        if '<head>' in text and '</head>' in text:
            # page titles name the upstream brand directly (the branding options cover header and footer)
            title = re.sub(r'<title>(.*?)</title>', lambda m: m.group(0).replace('BentoPDF', 'InkDOS PDF'),
                           page.read_text(encoding='utf-8'), count=1, flags=re.S)
            page.write_text(title, encoding='utf-8')
            inkdos_skin(page, tool['id'])
    # the PDF.js viewer opens a file handed over by the InkDOS Office Home (its PDF card)
    viewer = dest / 'pdfjs-viewer' / 'viewer.html'
    handoff = (f'<script src="{BASE}viewers/file-handoff.js" data-mode="pdfjs"></script>'
               f'<script src="{BASE}viewers/viewer-embed.js"></script>')
    text = viewer.read_text(encoding='utf-8')
    if '</body>' not in text:
        sys.exit('bentopdf: pdfjs-viewer/viewer.html has no </body>')
    if handoff not in text:
        viewer.write_text(text.replace('</body>', handoff + '</body>', 1), encoding='utf-8')
    # every file the toolkit uses, for "Download all" on the InkDOS Office Home: it stores them in the project's
    # cache ahead of use (the Office/ODF converters, LibreOffice, are a group of their own: large)
    cache = re.search(r"const CACHE_VERSION = '([^']+)'", sw.read_text(encoding='utf-8'))
    if not cache:
        sys.exit('bentopdf: sw.js names no CACHE_VERSION; the offline list would not reach its cache')
    files = [{'url': base + rel, 'size': (dest / rel).stat().st_size, 'group': 'office' if rel.startswith('libreoffice-wasm/') else 'pdf'}
             for rel in sorted(path.relative_to(dest).as_posix() for path in dest.rglob('*') if path.is_file())
             if rel not in ('sw.js', OFFLINE_LIST) and not rel.endswith('.map') and not precompressed_copy(dest / rel)]
    files += [{'url': BASE + rel, 'size': 0, 'group': 'pdf'} for rel in
              ('skins/inkdos.css', f"skins/{tool['id']}.css", 'viewers/viewer-theme.js', 'viewers/download-fallback.js',
               'viewers/file-handoff.js', 'viewers/viewer-embed.js', 'viewers/bento-carry.js')]
    offline_list(dest, {'cache': cache.group(1) + '-static', 'worker': base + 'sw.js', 'scope': base, 'files': files})


# "Download all" on the InkDOS Office Home (inkdos-tools.github.io, same origin) reads <tool>/inkdos-offline.json:
# the worker that serves the tool offline, its cache and the files to keep there
OFFLINE_LIST = 'inkdos-offline.json'


def precompressed_copy(path: Path) -> bool:
    """x.gz / x.br next to x: a copy for servers that send precompressed files (GitHub Pages does not), never loaded.
    LibreOffice's .gz files have no plain sibling: the converter loads those itself."""
    return path.suffix in ('.gz', '.br') and path.with_suffix('').is_file()


def offline_list(dest: Path, data: dict) -> None:
    (dest / OFFLINE_LIST).write_text(json.dumps(data, separators=(',', ':')), encoding='utf-8')


def needs_isolation(page: Path, dest: Path, base: str) -> bool:
    """A BentoPDF page needs cross-origin isolation when its entry script loads LibreOffice WASM."""
    entry = re.search(r'<script type="module"[^>]*src="([^"]+)"', page.read_text(encoding='utf-8'))
    if not entry or not entry.group(1).startswith(base):
        return False
    script = dest / entry.group(1)[len(base):]
    return script.is_file() and b'libreoffice' in script.read_bytes()


# BentoPDF pages are large (the start page lists 130 tools with a 3 MB icon set). On iPad/iPhone, opening a tool from
# such a page kept the previous page alive in the back-forward cache and the new one went straight back to the list
# (or froze); an unload listener makes Safari drop the previous page instead of caching it.
BFCACHE_OFF = "<script>/* InkDOS-tools: no back-forward cache (memory on iPad) */addEventListener('unload',function(){})</script>"
# Tools hand their result over as a download; for a browser that cannot save those, the result can be offered in a
# panel with the share sheet and Open (site-src/viewers/download-fallback.js, off unless turned on in storage).
DOWNLOAD_PANEL = f'<script src="{BASE}viewers/download-fallback.js"></script>'
# "Edit PDF" in the InkDOS PDF workspace: the open PDF follows into whichever toolkit page is chosen
# (site-src/viewers/bento-carry.js; viewer-embed.js after it answers the InkDOS frame)
# BentoPDF keeps its original start page (search bar, its own tool layout; owner, 2026-10-10): viewers/bento-list.js
# (the one-line grouped list) is no longer added to the pages
BENTO_CARRY = f'<script src="{BASE}viewers/bento-carry.js"></script><script src="{BASE}viewers/viewer-embed.js"></script>'


COI_PRELUDE = """// InkDOS-tools: add cross-origin isolation headers to the pages that load LibreOffice WASM and to worker scripts
// (GitHub Pages cannot send them).
const INKDOS_COI_PAGES = new Set(__COI_PAGES_JSON__);
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const isolated = (request.mode === 'navigate' && INKDOS_COI_PAGES.has(url.pathname))
    || request.destination === 'worker' || request.destination === 'sharedworker';
  if (!isolated || url.origin !== location.origin) return;
  event.stopImmediatePropagation();
  event.respondWith((async () => {
    let response;
    try { response = await fetch(request); if (response.ok) (await caches.open('inkdos-tools-pages')).put(request, response.clone()); }
    catch (error) { response = await caches.match(request, { ignoreSearch: true }); if (!response) throw error; }
    if (!response || response.type === 'opaqueredirect' || response.status === 0) return response;
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  })());
});
"""
COI_RELOAD = ("<script>/* InkDOS-tools: on a page that needs it, register the tool's service worker (the project registers it "
              "from its start page only) and reload once so the page becomes cross-origin isolated */"
              "if(!self.crossOriginIsolated&&'serviceWorker' in navigator){navigator.serviceWorker.register(SW_URL).catch(function(){});"
              "navigator.serviceWorker.ready.then(function(){"
              "try{var k='inkdos-coi:'+location.pathname;if(sessionStorage.getItem(k))return;sessionStorage.setItem(k,'1')}catch(_){return}"
              "location.reload()})}</script>")


def build_python(src: Path, dest: Path, tool: dict) -> None:
    # Pyodide's own console page from its npm release (the commit pinned in tools.json is that release's
    # tag); the terminal libraries it loads from CDNs are served from this site instead
    version = '314.0.7'
    packs = src.parent / f"{tool['id']}-packs"
    shutil.rmtree(packs, ignore_errors=True)
    pyodide, jquery, terminal, idb = npm_pack([f'pyodide@{version}', 'jquery@3.7.1', 'jquery.terminal@2.35.2', 'idb-keyval@5.0.2'], packs)
    untar(pyodide, dest)
    vendor = dest / 'vendor'
    untar(jquery, vendor / 'jquery')  # whole packages, so each keeps its licence file
    untar(terminal, vendor / 'jquery.terminal')
    untar(idb, vendor / 'idb-keyval')
    shutil.copy2(dest / 'console.html', dest / 'index.html')
    inkdos_skin(dest / 'index.html', tool['id'])
    patch(dest / 'index.html', [
        ('https://cdn.jsdelivr.net/npm/jquery.terminal@2.35.2/css/jquery.terminal.min.css', './vendor/jquery.terminal/css/jquery.terminal.min.css'),
        ('https://cdn.jsdelivr.net/npm/jquery.terminal@2.35.2/js/jquery.terminal.min.js', './vendor/jquery.terminal/js/jquery.terminal.min.js'),
        ('https://cdn.jsdelivr.net/npm/jquery.terminal@2.35.2/js/unix_formatting.min.js', './vendor/jquery.terminal/js/unix_formatting.min.js'),
        ('https://cdn.jsdelivr.net/npm/jquery@3.7.1', './vendor/jquery/dist/jquery.min.js'),
        ('https://unpkg.com/idb-keyval@5.0.2/dist/esm/index.js', './vendor/idb-keyval/dist/esm/index.js'),
    ])
    # Python packages served from this site, so `import pandas` works offline: the Pyodide builds of
    # PYTHON_PACKAGES and their dependencies (each checked against the sha256 in Pyodide's own lock file), plus
    # the pure-Python wheels of PYPI_WHEELS (pinned by sha256) registered in that lock file
    lock_file = dest / 'pyodide-lock.json'
    lock = json.loads(lock_file.read_text(encoding='utf-8'))
    packages, wanted = lock['packages'], set()
    def need(name: str) -> None:
        if name not in wanted:
            wanted.add(name)
            for dep in packages[name]['depends']:
                need(dep)
    for name in PYTHON_PACKAGES + [dep for wheel in PYPI_WHEELS for dep in wheel['depends'] if dep in packages]:
        need(name)
    for name in sorted(wanted):
        entry = packages[name]
        fetch_checked(f"https://cdn.jsdelivr.net/pyodide/v{version}/full/{entry['file_name']}", entry['sha256'], dest / entry['file_name'])
    for wheel in PYPI_WHEELS:
        fetch_checked(wheel['url'], wheel['sha256'], dest / wheel['url'].rsplit('/', 1)[1])
        packages[wheel['name']] = {'depends': wheel['depends'], 'file_name': wheel['url'].rsplit('/', 1)[1], 'imports': wheel['imports'],
                                   'install_dir': 'site', 'name': wheel['name'], 'package_type': 'package', 'sha256': wheel['sha256'],
                                   'tool': {}, 'unvendored_tests': False, 'version': wheel['version']}
    lock_file.write_text(json.dumps(lock), encoding='utf-8')
    # InkDOS bar (open/save files, offline/online terminal); online.html is the same terminal with PyPI allowed in its
    # connect-src (CSP_CONNECT), for micropip.install()
    shutil.copy2(ROOT / 'site-src' / 'python' / 'inkdos-python.js', dest / 'inkdos-python.js')
    console = (dest / 'index.html').read_text(encoding='utf-8')
    if '</body>' not in console:
        sys.exit(f'{dest / "index.html"}: no </body> for the InkDOS bar')
    console = console.replace('</body>', '<script src="./inkdos-python.js"></script></body>', 1)
    console = console.replace('<head>', '<head>' + DOWNLOAD_PANEL, 1)  # Save file is a download too
    (dest / 'index.html').write_text(console.replace('<html>', '<html data-inkdos-python="offline">', 1), encoding='utf-8')
    online = console.replace('<html>', '<html data-inkdos-python="online">', 1).replace(
        '<head>', '<head>' + CSP_CONNECT_META.format(' '.join(PYPI_ORIGINS)), 1)
    (dest / 'online.html').write_text(online, encoding='utf-8')
    # service worker: the terminal and every bundled package stay on the device (site-src/python/sw.js)
    core = ['./', 'index.html', 'online.html', 'inkdos-python.js', 'pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm',
            'python_stdlib.zip', 'pyodide-lock.json', 'vendor/jquery/dist/jquery.min.js',
            'vendor/jquery.terminal/js/jquery.terminal.min.js',
            'vendor/jquery.terminal/css/jquery.terminal.min.css', 'vendor/idb-keyval/dist/esm/index.js',
            '../viewers/viewer-theme.js', '../viewers/download-fallback.js', '../skins/inkdos.css', f"../skins/{tool['id']}.css"]
    for file in core[1:]:
        if not file.startswith('../') and not (dest / file).is_file():
            sys.exit(f'python: {file} is not in the build; the offline list would be incomplete')
    files = sorted({packages[name]['file_name'] for name in wanted} | {w['url'].rsplit('/', 1)[1] for w in PYPI_WHEELS})
    stamp = hashlib.sha256(json.dumps([version, files, (ROOT / 'site-src' / 'python' / 'inkdos-python.js').read_text(encoding='utf-8')]).encode()).hexdigest()[:16]
    sw = (ROOT / 'site-src' / 'python' / 'sw.js').read_text(encoding='utf-8')
    (dest / 'sw.js').write_text(sw.replace('__VERSION__', stamp).replace('__CORE__', json.dumps(core))
                                .replace('__PACKAGES__', json.dumps(files)), encoding='utf-8')
    scope = f"{BASE}{tool['id']}/"
    offline_list(dest, {'cache': 'inkdos-python-' + stamp, 'worker': scope + 'sw.js', 'scope': scope,
                        'files': [{'url': scope + f if f != './' else scope, 'size': (dest / f).stat().st_size if (dest / f).is_file() else 0}
                                  for f in core + files]})


def fetch_checked(url: str, sha256: str, target: Path) -> None:
    """Download a file and keep it only if its sha256 is the pinned one."""
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == sha256:
        return
    print('+ fetch', url, flush=True)
    data = subprocess.run(['curl', '-fsSL', '--retry', '3', url], check=True, capture_output=True).stdout
    if hashlib.sha256(data).hexdigest() != sha256:
        sys.exit(f'{url}: sha256 does not match the pinned {sha256}')
    target.write_bytes(data)


# Python terminal: packages importable without a network (Pyodide builds; dependencies are added from its lock file)
PYTHON_PACKAGES = ['numpy', 'pandas', 'matplotlib', 'scipy', 'statsmodels', 'sympy', 'networkx', 'pillow', 'regex', 'pyyaml',
                   'beautifulsoup4', 'lxml', 'xlrd', 'micropip']
# pure-Python wheels from PyPI for Office files, pinned by sha256 (openpyxl: Excel .xlsx; python-docx: Word .docx)
PYPI_WHEELS = [
    {'name': 'et-xmlfile', 'version': '2.0.0', 'imports': ['et_xmlfile'], 'depends': [],
     'url': 'https://files.pythonhosted.org/packages/c1/8b/5fe2cc11fee489817272089c4203e679c63b570a5aaeb18d852ae3cbba6a/et_xmlfile-2.0.0-py3-none-any.whl',
     'sha256': '7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa'},
    {'name': 'openpyxl', 'version': '3.1.5', 'imports': ['openpyxl'], 'depends': ['et-xmlfile'],
     'url': 'https://files.pythonhosted.org/packages/c0/da/977ded879c29cbd04de313843e76868e6e13408a94ed6b987245dc7c8506/openpyxl-3.1.5-py2.py3-none-any.whl',
     'sha256': '5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2'},
    {'name': 'python-docx', 'version': '1.2.0', 'imports': ['docx'], 'depends': ['lxml', 'typing-extensions'],
     'url': 'https://files.pythonhosted.org/packages/d0/00/1e03a4989fa5795da308cd774f05b704ace555a70f9bf9d3be057b680bcf/python_docx-1.2.0-py3-none-any.whl',
     'sha256': '3fd478f3250fbbbfd3b94fe1e985955737c145627498896a8a6bf81f4baf66c7'},
]
# the only outside addresses a page here may contact: PyPI, for the online Python terminal (python/online.html)
PYPI_ORIGINS = ('https://pypi.org', 'https://files.pythonhosted.org')
CSP_CONNECT_META = '<meta name="inkdos-tools-connect" content="{}">'


def build_docx(src: Path, dest: Path, tool: dict) -> None:
    # docx-preview's own build is committed with the pinned release (dist/); it needs JSZip as a global, served
    # next to it from the npm package (MIT, dual-licensed with GPL-3.0). The viewer page is site-src/docx/.
    shutil.copy2(src / 'dist' / 'docx-preview.min.js', dest / 'docx-preview.min.js')
    packs = src.parent / f"{tool['id']}-packs"
    for tgz in npm_pack([f'jszip@{JSZIP_VERSION}'], packs):
        untar(tgz, dest / 'jszip-pkg')
    shutil.copy2(dest / 'jszip-pkg' / 'dist' / 'jszip.min.js', dest / 'jszip.min.js')
    shutil.copy2(dest / 'jszip-pkg' / 'LICENSE.markdown', dest / 'JSZIP-LICENSE.txt')
    shutil.rmtree(dest / 'jszip-pkg')
    copy_files(ROOT / 'site-src' / 'docx', dest, ['index.html', 'viewer.js', 'viewer.css'])


def build_pptx(src: Path, dest: Path, tool: dict) -> None:
    # pptx-renderer's standalone browser build (JSZip and ECharts bundled, no PDF.js) from the npm release of the
    # pinned tag; its third-party notices and licences go with it. The viewer page is site-src/pptx/.
    version = json.loads((src / 'package.json').read_text(encoding='utf-8'))['version']
    packs = src.parent / f"{tool['id']}-packs"
    for tgz in npm_pack([f"@aiden0z/pptx-renderer@{version}"], packs):
        untar(tgz, dest / 'pkg')
    shutil.copy2(dest / 'pkg' / 'dist' / 'aiden0z-pptx-renderer.browser.es.js', dest / 'pptx-renderer.js')
    shutil.copy2(dest / 'pkg' / 'THIRD_PARTY_NOTICES.md', dest / 'THIRD_PARTY_NOTICES.md')
    shutil.copytree(dest / 'pkg' / 'licenses', dest / 'licenses')
    shutil.rmtree(dest / 'pkg')
    copy_files(ROOT / 'site-src' / 'pptx', dest, ['index.html', 'viewer.js', 'viewer.css'])

BUILDERS = {
    'pnk': build_pnk,
    'bentopdf': build_bentopdf,
    'python': build_python,
    'odf': build_odf,
    'docx': build_docx,
    'pptx': build_pptx,
}


# Every page gets a Content-Security-Policy (GitHub Pages cannot send headers, so a <meta> first in <head>):
# the tools run entirely in the browser, so nothing may be fetched from or sent to another site (one exception:
# python/online.html, the terminal the user opens to install packages, may reach PyPI; see page_csp). Inline
# scripts are allowed only by their exact hash; WebAssembly is allowed, eval() is not. Audited per tool
# (each one used under this policy without violations): BentoPDF, Pyodide, WebODF, pnk, docx-preview and
# pptx-renderer.
CSP_BASE = ("default-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
            # frame-src also allows the InkDOS origin: a PDF InkDOS hands over as a separate page comes through a hidden
            # InkDOS page (viewers/bento-carry.js)
            "connect-src 'self' data: blob:", "worker-src 'self' blob:", "frame-src 'self' blob: https://vfydr2m9wk-ops.github.io",
            "media-src 'self' data: blob:",
            "object-src 'none'", "base-uri 'self'", "form-action 'none'")
INLINE_SCRIPT = re.compile(r'<script(?![^>]*\bsrc\s*=)[^>]*>(.*?)</script>', re.S | re.I)
CSP_META = re.compile(r'<meta http-equiv="Content-Security-Policy" content="[^"]*" data-inkdos-tools>')


def page_csp(html: str) -> str:
    hashes = sorted({"'sha256-" + base64.b64encode(hashlib.sha256(body.encode('utf-8')).digest()).decode() + "'"
                     for body in INLINE_SCRIPT.findall(html)})
    script = " ".join(["script-src 'self' 'wasm-unsafe-eval'", *hashes])
    policy = list(CSP_BASE[1:])
    # a page may name outside origins it connects to (CSP_CONNECT_META); only PYPI_ORIGINS are accepted
    marker = re.search(r'<meta name="inkdos-tools-connect" content="([^"]*)">', html)
    if marker:
        extra = marker.group(1).split()
        if not extra or not set(extra) <= set(PYPI_ORIGINS):
            sys.exit(f'connect-src exception not allowed: {extra}')
        policy = [' '.join([d, *extra]) if d.startswith('connect-src ') else d for d in policy]
    return "; ".join((CSP_BASE[0], script, *policy))


def add_csp(page: Path) -> None:
    text = CSP_META.sub('', page.read_text(encoding='utf-8'))
    # first thing in <head>; a page without one (e.g. a test page inside a vendored package) gets it at the
    # start, where the parser opens the head implicitly
    at = re.search(r'<head[^>]*>', text, re.I) or re.match(r'\s*(<!doctype[^>]*>\s*)?(<html[^>]*>)?', text, re.I)
    meta = f'<meta http-equiv="Content-Security-Policy" content="{page_csp(text)}" data-inkdos-tools>'
    page.write_text(text[:at.end()] + meta + text[at.end():], encoding='utf-8')


def write_index(out: Path, tools: list[dict]) -> None:
    listing = [{k: t[k] for k in ('id', 'name', 'title', 'group', 'description', 'repo', 'license')} | {'href': f"{t['id']}/"}
               for t in tools]
    (out / 'tools.json').write_text(json.dumps({'tools': listing}, indent=2) + '\n', encoding='utf-8')
    template = (ROOT / 'site-src' / 'index.html').read_text(encoding='utf-8')
    items = '\n'.join(
        f'      <li><a href="./{t["id"]}/"><strong>{t["title"]}</strong><small>{t["description"]}</small>'
        f'<em>{t["name"]} · {t["license"]}</em></a></li>' for t in tools)
    (out / 'index.html').write_text(template.replace('<!-- TOOLS -->', items), encoding='utf-8')
    shutil.copy2(ROOT / 'LICENSE', out / 'LICENSE.txt')
    # shared by the viewers: InkDOS look, theme and the embed protocol (site-src/viewers/)
    shutil.copytree(ROOT / 'site-src' / 'viewers', out / 'viewers', dirs_exist_ok=True)
    # the InkDOS look for the tools' own pages (inkdos_skin)
    shutil.copytree(ROOT / 'site-src' / 'skins', out / 'skins', dirs_exist_ok=True)
    # diagnostics page for browsers without developer tools (an iPad app): shows what a PDF toolkit page does
    shutil.copytree(ROOT / 'site-src' / 'diag', out / 'diag', dirs_exist_ok=True)
    (out / '.nojekyll').write_text('', encoding='utf-8')
    # GitHub Pages serves one 404 page per site: send a deep link inside a tool (single-page apps with
    # history routing) back to that tool's start page instead of a dead end
    ids = json.dumps([t['id'] for t in tools])
    (out / '404.html').write_text(
        '<!doctype html><head><meta charset="utf-8"><title>InkDOS tools</title></head>\n'
        f'<script>(function(){{var base={json.dumps(BASE)},ids={ids},rest=location.pathname.indexOf(base)===0?'
        'location.pathname.slice(base.length):"",id=rest.split("/")[0];'
        # an old /<lang>/ address of the PDF toolkit (see build_bentopdf) opens the page itself
        'var lang=/^bentopdf\\/(?:en|ar|fr|es|de|zh|zh-TW|vi|tr|id|it|pt|nl|be|da|ko|sv|ru|ja|uk|sk)\\/(.*)$/.exec(rest);'
        'if(lang){location.replace(base+"bentopdf/"+lang[1]+location.search+location.hash);return}'
        'location.replace(base+(ids.indexOf(id)>=0?id+"/":""))})()</script>\n', encoding='utf-8')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='_site')
    parser.add_argument('--work', default='.work')
    parser.add_argument('--only', action='append', default=[])
    args = parser.parse_args()
    out, work = Path(args.out).resolve(), Path(args.work).resolve()
    tools = [t for t in MANIFEST['tools'] if not args.only or t['id'] in args.only]
    unknown = set(args.only) - {t['id'] for t in MANIFEST['tools']}
    if unknown:
        sys.exit(f'Unknown tool(s): {", ".join(sorted(unknown))}')
    out.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    for tool in tools:
        dest = out / tool['id']
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True)
        src = fetch(tool, work)
        BUILDERS[tool['id']](src, dest, tool)
        shutil.copy2(src / tool['license_file'], dest / 'UPSTREAM-LICENSE.txt')
        (dest / 'UPSTREAM-SOURCE.txt').write_text(f"{tool['name']}\n{tool['repo']}\ncommit {tool['ref']}\nlicense {tool['license']}\n",
                                                  encoding='utf-8')
        if not (dest / 'index.html').exists():
            sys.exit(f"{tool['id']}: build produced no index.html")
        print(f"built {tool['id']}", flush=True)
    write_index(out, [t for t in MANIFEST['tools'] if (out / t['id'] / 'index.html').exists()])
    # last step, after every page edit above: the policy carries the hashes of the final inline scripts
    for page in [out / 'index.html', out / '404.html', *(p for t in tools for p in (out / t['id']).rglob('*.html'))]:
        add_csp(page)


if __name__ == '__main__':
    main()
