# Security of the InkDOS advanced tools site

Site: https://inkdos-tools.github.io/InkDOS-tools/ (GitHub Pages, organization `inkdos-tools`).

## The site only serves files

- GitHub Pages serves static files from the `gh-pages` branch. There is no server program, database,
  login or upload behind the site: a visitor can only download its files, never change them.
- Nothing a visitor does on one of these pages reaches other visitors. Each tool runs in the visitor's own
  browser tab, on the visitor's own files.
- Files you open in a tool are read by your browser and stay on your device. They are not uploaded.

## Only the maintainers can change it

- The site changes only when a commit lands on `main` of `inkdos-tools/InkDOS-tools`; the workflow in
  `.github/workflows/pages.yml` then builds every tool and publishes the result. Only members of the
  organization with write access can do that.
- Anyone else can at most open a pull request, which changes nothing until a maintainer reviews and merges
  it. Pull requests from forks do not publish anything.
- The remaining risk is a maintainer's GitHub account itself: keep two-factor authentication on for every
  member, and give write access to as few people as possible.

## What is published is pinned and checked

- Every tool is built from the exact commit recorded in `tools.json`.
- The Python terminal's packages are the Pyodide builds checked against the sha256 in Pyodide's own lock file,
  plus a few pure-Python wheels from PyPI pinned by sha256 in `build.py`. A different file stops the build.
- The workflow's actions are pinned to commit SHAs.

## What a page may do in the browser

- Every page carries a Content-Security-Policy: code is loaded only from this site (inline scripts only by
  their exact hash), and pages may not connect to any other site.
- One deliberate exception: `python/online.html`, the online Python terminal the user opens on purpose (it
  asks first), may connect to PyPI (`pypi.org`, `files.pythonhosted.org`) so that `micropip.install()` can
  download packages. The offline terminal (`python/`) cannot.
- This site is a separate origin from InkDOS (`vfydr2m9wk-ops.github.io/InkDOS/`): its pages cannot read
  InkDOS documents, recovery drafts or settings.

## What is not protected

- Packages you install from PyPI in the online terminal are code written by third parties. They run only in
  that tab, on this site, with no access to InkDOS or to the rest of your device, but they can read whatever
  you open in Python. The page's policy only lets them connect to PyPI, which makes sending your data
  elsewhere harder but not impossible. Install only packages you trust.

## Reporting a problem

Open an issue in https://github.com/inkdos-tools/InkDOS-tools or contact the InkDOS maintainer through
https://github.com/vfydr2m9wk-ops/InkDOS.
