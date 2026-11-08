# InkDOS Security - officeclean (Windows). Run in PowerShell:
#   irm "https://hub.inkdos.workers.dev/apps/seguranca/native/officeclean.ps1?$(Get-Random)" | iex
# Loads the shared engine (inksec.ps1) in "office" mode.
$env:INKSEC_MODE = 'office'
irm "https://hub.inkdos.workers.dev/apps/seguranca/native/inksec.ps1?$(Get-Random)" | iex
