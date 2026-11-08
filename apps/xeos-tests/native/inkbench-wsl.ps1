# Runs the Linux native benchmark inside WSL from PowerShell, with one command:
#   irm https://hub.inkdos.workers.dev/apps/xeos-tests/native/inkbench-wsl.ps1 | iex
# Installs the tools it needs in the WSL distro (as root, no password prompt) and saves the
# .json and .log on the Windows Desktop, ready for "Load PDF to compare".
$ErrorActionPreference = "Continue"
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { Write-Host "WSL is not installed. Run 'wsl --install' as administrator, restart, then run this again."; return }
$distros = (wsl.exe -l -q) -replace "`0", "" | Where-Object { $_.Trim() }
if (-not $distros) { Write-Host "WSL has no Linux distro. Run 'wsl --install -d Ubuntu', open Ubuntu once to finish setup, then run this again."; return }
Write-Host "Using WSL distro: $((wsl.exe -l -v) -replace "`0", '' | Select-String '\*')"
$desk = [Environment]::GetFolderPath("Desktop")
$wdesk = (wsl.exe -u root -e wslpath -a "$desk").Trim()
$stress = if ($env:STRESS -eq "0") { "0" } else { "1" }
Write-Host "Installing tools in WSL (gcc, curl, bc, xz) if missing..."
wsl.exe -u root -e sh -c "command -v apt-get >/dev/null && (dpkg -s gcc curl bc xz-utils libgomp1 >/dev/null 2>&1 || (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gcc libc6-dev curl bc xz-utils >/dev/null)) || true"
Write-Host "Running the benchmark (about 7 minutes with the stress test)..."
wsl.exe -u root -e bash -c "curl -fsSL https://hub.inkdos.workers.dev/apps/xeos-tests/native/inkbench.sh -o /tmp/inkbench.sh && STRESS=$stress OUT_DIR='$wdesk' bash /tmp/inkbench.sh"
Write-Host ""
Write-Host "Done. The .json and .log are on your Desktop: $desk"
