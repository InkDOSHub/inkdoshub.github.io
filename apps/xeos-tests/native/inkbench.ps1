# InkDOS Hub native benchmark for Windows. Same result format as the browser benchmark,
# so the JSON can be loaded in https://hub.inkdos.workers.dev/apps/xeos-tests/?bench ("Load PDF to compare").
# Uses well-known open/standard tools: 7-Zip benchmark (CPU), Microsoft DiskSpd (disk),
# WinSAT (memory and GPU, only when run as administrator), Cloudflare speed test (network).
# Run in PowerShell:  irm https://hub.inkdos.workers.dev/apps/xeos-tests/native/inkbench.ps1 | iex
# Set $env:STRESS = "0" before running to skip the 5-minute stress test.
$ErrorActionPreference = "Continue"; $ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$VER = 1
$W = Join-Path $env:TEMP ("inkbench-" + [guid]::NewGuid().ToString("N").Substring(0, 6)); New-Item -ItemType Directory $W | Out-Null
$OutDir = [Environment]::GetFolderPath("Desktop"); if (-not $OutDir) { $OutDir = $HOME }
$LOG = New-Object System.Collections.Generic.List[string]; $T0 = Get-Date
function Log($m) { $l = "[{0,7:N2}s] {1}" -f ((Get-Date) - $T0).TotalSeconds, $m; $LOG.Add($l); Write-Host $l }
$MET = [ordered]@{}
function Met($id, $v, $note) {
  if ($v -is [string] -and $v -match '^[\d.]+$') { $v = [double]$v }
  if ($null -ne $v -and $v -is [double]) { $v = [math]::Round($v, 2) }
  $MET[$id] = [ordered]@{ v = $v; note = "$note" }; Log "  $id = $v ($note)"
}
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Log "InkDOS native benchmark v$VER (Windows) - admin=$admin - work dir $W"

# ---------- identification ----------
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$ramMods = Get-CimInstance Win32_PhysicalMemory
$ramSpeed = ($ramMods | Measure-Object -Property ConfiguredClockSpeed -Maximum).Maximum
$ram = "{0:N1} GB - {1} module(s) - {2} MT/s" -f ($cs.TotalPhysicalMemory / 1GB), @($ramMods).Count, $ramSpeed
$gpu = (Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }) -join "; "
$disk = (Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object { "{0} {1:N0} GB {2} {3}" -f $_.FriendlyName, ($_.Size / 1GB), $_.MediaType, $_.BusType }) -join "; "
$threads = [int]$cpu.NumberOfLogicalProcessors
$info = [ordered]@{
  browser = "native app"; engine = "native (7-Zip, DiskSpd, WinSAT)"; os = $os.Caption; osVersion = "build " + $os.BuildNumber; device = "PC"
  chip = $cpu.Name.Trim(); arch = $env:PROCESSOR_ARCHITECTURE; cpuThreads = "$($cpu.NumberOfCores) cores / $threads threads, max $($cpu.MaxClockSpeed) MHz"
  memory = $ram; gpu = $gpu; storageQuota = $disk; model = "$($cs.Manufacturer) $($cs.Model)"
}
$info.GetEnumerator() | ForEach-Object { Log ("  {0}: {1}" -f $_.Key, $_.Value) }

# ---------- CPU: 7-Zip ----------
$Z = Join-Path $W "7zr.exe"
try { Invoke-WebRequest "https://www.7-zip.org/a/7zr.exe" -OutFile $Z -UseBasicParsing } catch { Log "7-Zip download failed: $_"; $Z = $null }
function ZRate($a) { $o = & $Z b @a 2>&1 | Out-String; $LOG.Add($o); $m = [regex]::Matches($o, '(?m)^Tot:.*?(\d+)\s*$'); if ($m.Count) { [double]$m[$m.Count - 1].Groups[1].Value } else { $null } }
if ($Z) {
  Log "== 7-Zip benchmark"
  Met "cpu1.7zip" (ZRate @("-mmt1")) "7-Zip 7zr, 1 thread, total rating"
  Met "cpuN.7zip" (ZRate @()) "7-Zip 7zr, all $threads threads, total rating"
}

# ---------- disk: DiskSpd (Microsoft), sequential 1 MB, no cache ----------
try {
  Log "== Disk (DiskSpd, 1 GB file, 1 MB blocks, 10 s each, caching off)"
  Invoke-WebRequest "https://github.com/microsoft/diskspd/releases/latest/download/DiskSpd.zip" -OutFile "$W\ds.zip" -UseBasicParsing
  Expand-Archive "$W\ds.zip" "$W\ds" -Force
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "ARM64" } else { "amd64" }
  $ds = Get-ChildItem "$W\ds" -Recurse -Filter diskspd.exe | Where-Object { $_.FullName -match $arch } | Select-Object -First 1
  $f = Join-Path $W "ds.dat"
  function DS($w) { $o = & $ds.FullName -c1G -b1M -d10 -o8 -t1 -Sh -w$w $f 2>&1 | Out-String; $LOG.Add($o); $m = [regex]::Match($o, '(?m)^total:\s*\d+\s*\|\s*\d+\s*\|\s*([\d.]+)'); if ($m.Success) { [double]$m.Groups[1].Value * 1.048576 } else { $null } }
  Met "disk.seqWrite" (DS 100) "DiskSpd sequential write, 1 MB, QD8"
  Met "disk.seqRead" (DS 0) "DiskSpd sequential read, 1 MB, QD8"
  Remove-Item $f -ErrorAction SilentlyContinue
} catch { Log "DiskSpd failed: $_" }

# ---------- memory and GPU: WinSAT (built into Windows, needs administrator) ----------
if ($admin) {
  Log "== WinSAT memory"
  $o = winsat mem 2>&1 | Out-String; $LOG.Add($o)
  $m = [regex]::Match($o, 'Memory Performance\s+([\d.]+) MB/s'); if ($m.Success) { Met "mem.winsat" ([double]$m.Groups[1].Value / 1000) "WinSAT memory bandwidth" }
  Log "== WinSAT Direct3D"
  $o = winsat d3d 2>&1 | Out-String; $LOG.Add($o)
  $m = [regex]::Matches($o, '(?m)^>.*?([\d.]+) F/s'); if ($m.Count) { $s = ($m | ForEach-Object { [double]$_.Groups[1].Value } | Measure-Object -Average).Average; Met "gfx.winsat" $s "WinSAT Direct3D, average of $($m.Count) scenes" }
} else { Log "Not administrator: WinSAT memory and GPU skipped (run PowerShell as administrator to include them)" }

# ---------- network ----------
try {
  Log "== Network (speed.cloudflare.com)"
  $lat = 1..6 | ForEach-Object { (Measure-Command { Invoke-WebRequest "https://speed.cloudflare.com/__down?bytes=0" -UseBasicParsing | Out-Null }).TotalMilliseconds } | Sort-Object
  Met "net.latency" $lat[2] "HTTPS request, median of 6"
  $t = Measure-Command { Invoke-WebRequest "https://speed.cloudflare.com/__down?bytes=50000000" -OutFile "$W\dl.bin" -UseBasicParsing }
  Met "net.download" (50e6 * 8 / $t.TotalSeconds / 1e6) "50 MB from speed.cloudflare.com in $([math]::Round($t.TotalSeconds,1)) s"
  Remove-Item "$W\dl.bin" -ErrorAction SilentlyContinue
} catch { Log "Network test failed: $_" }

# ---------- stress: 5 min of 7-Zip on all threads, sampled every 10 s ----------
$ser = @(); $temps = @()
function Temp { try { $z = Get-CimInstance -Namespace root/wmi MSAcpi_ThermalZoneTemperature -ErrorAction Stop | Measure-Object -Property CurrentTemperature -Maximum; [math]::Round($z.Maximum / 10 - 273.15) } catch { $null } }
if ($env:STRESS -ne "0" -and $Z) {
  Log "== Stress 5 min (7-Zip, all threads)"
  $s0 = Get-Date; $next = 10; $acc = 0; $n = 0
  while (((Get-Date) - $s0).TotalSeconds -lt 300) {
    $r = ZRate @("1"); if ($r) { $acc += $r; $n++ }
    $el = ((Get-Date) - $s0).TotalSeconds
    if ($el -ge $next -and $n) { $v = [math]::Round($acc / $n); $tc = Temp; $ser += $v; $temps += $tc; Log ("  t={0:N0}s 7-Zip {1} MIPS - CPU {2} C" -f $el, $v, $(if ($tc) { $tc } else { "?" })); $acc = 0; $n = 0; while ($next -le $el) { $next += 10 } }
  }
  if ($ser.Count -ge 4) { $keep = (($ser[-1] + $ser[-2] + $ser[-3]) / 3) / (($ser[0] + $ser[1]) / 2) * 100; Met "stress.cpu" $keep "7-Zip MIPS start $($ser[0]) - end $($ser[-1])" }
}

# ---------- result ----------
$res = [ordered]@{
  kind = "inkbench"; version = "native-$VER"; date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  label = "Native - Windows - " + $cpu.Name.Trim(); info = $info; metrics = $MET; series = [ordered]@{ step = 10; cpu = $ser; temp = $temps }
}
$name = "inkbench-native-windows-{0}-{1}" -f $env:COMPUTERNAME, (Get-Date -Format "yyyyMMdd-HHmm")
$out = Join-Path $OutDir "$name.json"
[IO.File]::WriteAllText($out, ($res | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
[IO.File]::WriteAllLines((Join-Path $OutDir "$name.log"), $LOG)
Log "Saved $out"
Write-Host ""
Write-Host "Result: $out"
Write-Host "Log:    $(Join-Path $OutDir "$name.log")"
Write-Host "Open https://hub.inkdos.workers.dev/apps/xeos-tests/?bench > Load PDF to compare > pick the .json"
