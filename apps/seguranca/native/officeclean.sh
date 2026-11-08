#!/usr/bin/env bash
# InkDOS Security - officeclean (Linux and macOS). Run in a terminal:
#   curl -fsSL "https://hub.inkdos.workers.dev/apps/seguranca/native/officeclean.sh?$RANDOM" | bash
# Downloads the shared engine (inksec.py) to a temp folder and runs it in "office" mode.
set -e
command -v python3 >/dev/null || { echo "python3 is needed (macOS: xcode-select --install, Linux: install python3)"; exit 1; }
t=$(mktemp -d)
curl -fsSL "https://hub.inkdos.workers.dev/apps/seguranca/native/inksec.py?$RANDOM" -o "$t/inksec.py"
python3 "$t/inksec.py" office </dev/tty || true
rm -rf "$t"
