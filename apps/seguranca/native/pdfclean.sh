#!/usr/bin/env bash
# InkDOS Security - pdfclean (Linux and macOS). Run in a terminal:
#   curl -fsSL "https://hub.inkdos.workers.dev/apps/seguranca/native/pdfclean.sh?$RANDOM" | bash
# Downloads the shared engine (inksec.py) to a temp folder and runs it in "pdf" mode.
set -e
command -v python3 >/dev/null || { echo "python3 is needed (macOS: xcode-select --install, Linux: install python3)"; exit 1; }
t=$(mktemp -d)
curl -fsSL "https://hub.inkdos.workers.dev/apps/seguranca/native/inksec.py?$RANDOM" -o "$t/inksec.py"
python3 "$t/inksec.py" pdf </dev/tty || true
rm -rf "$t"
