# InkDOS Security - archivescan (Windows). Run in PowerShell:
#   irm "https://hub.inkdos.workers.dev/apps/seguranca/native/archivescan.ps1?$(Get-Random)" | iex
# Loads the shared engine (inksec.ps1) in "archive" mode.
$env:INKSEC_MODE = 'archive'
irm "https://hub.inkdos.workers.dev/apps/seguranca/native/inksec.ps1?$(Get-Random)" | iex
