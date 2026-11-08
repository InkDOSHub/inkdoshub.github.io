# InkDOS PDF Clean - bulk-neutralize risky PDF features (Windows).
# Run in PowerShell:  irm "https://hub.inkdos.workers.dev/apps/editar-pdf/native/pdfclean.ps1?$(Get-Random)" | iex
#
# Walks a folder (or external drive) recursively and writes a copy of every PDF
# to a separate output folder, keeping the folder structure (originals untouched).
# Or answer R at the output prompt to overwrite risky PDFs in place (e.g. OneDrive folders).
# Risky features (same list as the PDF security checker): JavaScript/JS, OpenAction, AA,
# Launch, EmbeddedFiles, RichMedia, XFA, SubmitForm, ImportData, GoToR.
# How: qpdf (portable, auto-downloaded) unpacks object streams, the risky names are renamed
# to same-length harmless names (so readers ignore them and offsets stay valid), then qpdf
# rewrites and recompresses the file. Text, images, fonts and bookmarks are kept.
# A CSV report (pdfclean-report.csv) is written to the output folder.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Get-Qpdf {
  $base = Join-Path $env:LOCALAPPDATA 'InkDOS\qpdf'
  $exe = Get-ChildItem $base -Recurse -Filter qpdf.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($exe) { return $exe.FullName }
  Write-Host 'Downloading qpdf (portable, open source)...'
  $rel = Invoke-RestMethod 'https://api.github.com/repos/qpdf/qpdf/releases/latest' -Headers @{ 'User-Agent' = 'inkdos-pdfclean' }
  $asset = $rel.assets | Where-Object { $_.name -match 'msvc64\.zip$' } | Select-Object -First 1
  if (-not $asset) { $asset = $rel.assets | Where-Object { $_.name -match 'mingw64\.zip$' } | Select-Object -First 1 }
  if (-not $asset) { throw 'Could not find a Windows qpdf download.' }
  New-Item -ItemType Directory -Force $base | Out-Null
  $zip = Join-Path $base 'qpdf.zip'
  Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing
  Expand-Archive $zip -DestinationPath $base -Force
  Remove-Item $zip
  $exe = Get-ChildItem $base -Recurse -Filter qpdf.exe | Select-Object -First 1
  if (-not $exe) { throw 'qpdf.exe not found after download.' }
  return $exe.FullName
}

$qpdf = Get-Qpdf
Write-Host "Using $qpdf"

# Optional, for the retry command written to pdfclean-retry.txt:
#   $env:PDFCLEAN_RETRY = a pdfclean-report*.csv (only its FAILED files are processed)
#   $env:PDFCLEAN_OUT   = 'R' (in place) or an output folder
$retryCsv = $env:PDFCLEAN_RETRY; $outPre = $env:PDFCLEAN_OUT
$env:PDFCLEAN_RETRY = $null; $env:PDFCLEAN_OUT = $null
if (-not $retryCsv) {
  $ans = (Read-Host 'Folder or drive to scan (or a pdfclean-report.csv to retry only its failed files)').Trim('"', ' ')
  if ($ans -match '\.csv$') { $retryCsv = $ans } else { $src = $ans }
}
$retryRows = $null
if ($retryCsv) {
  if (-not (Test-Path -LiteralPath $retryCsv -PathType Leaf)) { throw "Report not found: $retryCsv" }
  $retryCsv = (Resolve-Path -LiteralPath $retryCsv).ProviderPath
  $all = @(Import-Csv -LiteralPath $retryCsv)
  $retryRows = @($all | Where-Object { $_.Status -like 'FAILED*' })
  # Older reports have no Root column; they were saved in the scanned folder (in-place mode).
  $src = if ($all.Count -and $all[0].Root) { $all[0].Root } else { Split-Path $retryCsv }
  Write-Host "Retry mode: $($retryRows.Count) failed file(s) from $retryCsv"
  if ($retryRows.Count -eq 0) { Write-Host 'No failed files in that report. Nothing to do.' -ForegroundColor Green; return }
}
if (-not (Test-Path -LiteralPath $src -PathType Container)) { throw "Folder not found: $src" }
$src = (Resolve-Path -LiteralPath $src).ProviderPath.TrimEnd('\') + '\'
$defOut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'PDF-clean'
$dst = if ($outPre) { $outPre } else { (Read-Host "Output folder [Enter = $defOut, R = replace the originals in place]").Trim('"', ' ') }
$inPlace = $dst -eq 'R' -or $dst -eq 'r'
if ($inPlace) {
  Write-Host 'IN-PLACE MODE: risky PDFs will be overwritten with the cleaned version. Clean and failed PDFs are left untouched.' -ForegroundColor Yellow
  if (-not $outPre -and (Read-Host 'Type YES to continue') -ne 'YES') { Write-Host 'Cancelled.'; return }
  $dst = $src
} else {
  if (-not $dst) { $dst = $defOut }
  New-Item -ItemType Directory -Force $dst | Out-Null
  $dst = (Resolve-Path -LiteralPath $dst).ProviderPath.TrimEnd('\') + '\'
  if ($dst.StartsWith($src, [StringComparison]::OrdinalIgnoreCase)) { Write-Host 'Note: output is inside the scanned folder; it will be skipped.' }
}

# Names to neutralize. Each is renamed to a name of the same length (last letter -> 'X'/'Z').
$risky = 'JavaScript','JS','OpenAction','AA','Launch','EmbeddedFiles','RichMedia','XFA','SubmitForm','ImportData','GoToR'
$delim = '(?=[\s/<>\[\]\(\)%{}]|$)'
$latin1 = [Text.Encoding]::GetEncoding(28591)   # byte-for-byte
$tmpDir = Join-Path $env:TEMP "inkdos-pdfclean-$PID"  # per window, so several can run at once
New-Item -ItemType Directory -Force $tmpDir | Out-Null
$tmpA = Join-Path $tmpDir 'a.pdf'; $tmpB = Join-Path $tmpDir 'b.pdf'; $tmpS = Join-Path $tmpDir 's.pdf'
# Long paths (over 260 chars) need the \\?\ prefix for .NET file calls.
function Get-LongPath($p) { if ($p.StartsWith('\\')) { $p } else { '\\?\' + $p } }
# qpdf prints recoverable warnings to stderr (exit code 3). Run it with errors not stopping the script,
# otherwise Windows PowerShell turns any stderr text into a failure.
function Invoke-Qpdf {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $qpdf @args 2>&1 | Out-Null } finally { $ErrorActionPreference = $old }
  return $LASTEXITCODE
}

if ($retryCsv) {
  $files = foreach ($r in $retryRows) {
    $full = Join-Path $src $r.File
    $fi = New-Object IO.FileInfo (Get-LongPath $full)
    if ($fi.Exists) { [pscustomobject]@{ FullName = $full; Length = $fi.Length } } else { Write-Host "Missing now: $($r.File)" }
  }
} else {
  $files = Get-ChildItem -LiteralPath $src -Recurse -File -Filter *.pdf -ErrorAction SilentlyContinue |
    Where-Object { $inPlace -or -not $_.FullName.StartsWith($dst, [StringComparison]::OrdinalIgnoreCase) }
}
$total = @($files).Count
Write-Host "$total PDF(s) found."
$report = New-Object System.Collections.Generic.List[object]
$i = 0; $nClean = 0; $nFixed = 0; $nFail = 0

foreach ($f in $files) {
  $i++
  $rel = $f.FullName.Substring($src.Length)
  Write-Progress -Activity 'Cleaning PDFs' -Status $rel -PercentComplete ([int](100 * $i / [Math]::Max($total,1)))
  $out = Join-Path $dst $rel
  if (-not $inPlace) { [IO.Directory]::CreateDirectory((Get-LongPath (Split-Path $out))) | Out-Null }
  $status = ''; $found = ''; $note = ''
  try {
    # 1) unpack: decrypt (no-password files), no object streams, classic xref, streams left as-is
    [IO.File]::Copy((Get-LongPath $f.FullName), $tmpS, $true)
    $code = Invoke-Qpdf --decrypt --object-streams=disable --stream-data=preserve --no-original-object-ids -- $tmpS $tmpA
    if ($code -ne 0 -and $code -ne 3) { throw "qpdf could not read it (password-protected or badly damaged), exit $code" }
    $text = [IO.File]::ReadAllText($tmpA, $latin1)
    $hits = @()
    foreach ($n in $risky) {
      $rx = '/' + $n + $delim
      $c = [regex]::Matches($text, $rx).Count
      if ($c -gt 0) {
        $hits += "$n($c)"
        $new = '/' + $n.Substring(0, $n.Length - 1) + ($(if ($n.EndsWith('X')) { 'Z' } else { 'X' }))
        $text = [regex]::Replace($text, $rx, $new)
      }
    }
    if ($hits.Count -eq 0) {
      if (-not $inPlace) { [IO.File]::Copy((Get-LongPath $f.FullName), (Get-LongPath $out), $true) }
      $status = 'clean (unchanged)'; $nClean++
    } else {
      [IO.File]::WriteAllText($tmpB, $text, $latin1)
      # 2) repack: rebuild and recompress; also proves the result is a valid PDF
      $tmpC = Join-Path $tmpDir 'c.pdf'
      $code = Invoke-Qpdf --object-streams=generate --compress-streams=y -- $tmpB $tmpC
      if ($code -ne 0 -and $code -ne 3) { throw "rebuild failed, exit $code" }
      [IO.File]::Copy($tmpC, $(if ($inPlace) { Get-LongPath $f.FullName } else { Get-LongPath $out }), $true)
      $found = $hits -join ' '; $status = 'cleaned'; $nFixed++
      Write-Host "CLEANED  $rel  ->  $found" -ForegroundColor Yellow
    }
  } catch {
    $status = 'FAILED (left as is)'; $note = $_.Exception.Message; $nFail++
    if (-not $inPlace -and [IO.File]::Exists((Get-LongPath $out))) { [IO.File]::Delete((Get-LongPath $out)) }
    Write-Host "FAILED   $rel  ->  $note" -ForegroundColor Red
  }
  if ($wasCloud) {
    # Put it back to online-only so the PC doesn't fill up (OneDrive frees it after syncing).
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & attrib.exe +U -P "$($f.FullName)" 2>&1 | Out-Null } finally { $ErrorActionPreference = $old }
  }
  $report.Add([pscustomobject]@{ File = $rel; Status = $status; Found = $found; Note = $note; SizeKB = [int]($f.Length / 1KB); Root = $src })
}
Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
$csv = Join-Path $dst $(if ($retryCsv) { 'pdfclean-report-retry.csv' } else { 'pdfclean-report.csv' })
$report | Export-Csv -LiteralPath $csv -NoTypeInformation -Encoding UTF8
Write-Host ''
Write-Host "Done. $total PDF(s): $nClean already clean, $nFixed cleaned, $nFail failed." -ForegroundColor Green
Write-Host "Output: $dst"
Write-Host "Report: $csv"
if ($nFail -gt 0) {
  Write-Host 'Failed files were NOT copied/changed; check the report (usually password-protected or damaged PDFs).'
  $q = { param($v) "'" + ($v -replace "'", "''") + "'" }
  $mode = if ($inPlace) { 'R' } else { $dst }
  $cmd = '$env:PDFCLEAN_RETRY=' + (& $q $csv) + '; $env:PDFCLEAN_OUT=' + (& $q $mode) + '; irm "https://hub.inkdos.workers.dev/apps/editar-pdf/native/pdfclean.ps1?$(Get-Random)" | iex'
  $txt = Join-Path $dst 'pdfclean-retry.txt'
  [IO.File]::WriteAllText($txt, "Retry only the $nFail failed file(s): paste this line into PowerShell`r`n`r`n$cmd`r`n", [Text.Encoding]::UTF8)
  Write-Host "Retry command saved to: $txt"
}
