# InkDOS Security - riskyfiles (Windows). Run in PowerShell:
#   irm "https://hub.inkdos.workers.dev/apps/seguranca/native/riskyfiles.ps1?$(Get-Random)" | iex
# Loads the shared engine (inksec.ps1) in "loose" mode.
$env:INKSEC_MODE = 'loose'
irm "https://hub.inkdos.workers.dev/apps/seguranca/native/inksec.ps1?$(Get-Random)" | iex
