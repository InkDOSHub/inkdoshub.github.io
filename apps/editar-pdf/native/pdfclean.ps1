# InkDOS PDF Clean - bulk-neutralize risky PDF features (Windows).
# Run in PowerShell:  irm https://hub.inkdos.workers.dev/apps/editar-pdf/native/pdfclean.ps1 | iex
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

$src = (Read-Host 'Folder or drive to scan (e.g. D:\ or C:\Users\you\Books)').Trim('"', ' ')
if (-not (Test-Path -LiteralPath $src -PathType Container)) { throw "Folder not found: $src" }
$src = (Resolve-Path -LiteralPath $src).ProviderPath.TrimEnd('\') + '\'
$defOut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'PDF-clean'
$dst = (Read-Host "Output folder [Enter = $defOut, R = replace the originals in place]").Trim('"', ' ')
$inPlace = $dst -eq 'R' -or $dst -eq 'r'
if ($inPlace) {
  Write-Host 'IN-PLACE MODE: risky PDFs will be overwritten with the cleaned version. Clean and failed PDFs are left untouched.' -ForegroundColor Yellow
  if ((Read-Host 'Type YES to continue') -ne 'YES') { Write-Host 'Cancelled.'; return }
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
$tmpDir = Join-Path $env:TEMP 'inkdos-pdfclean'
New-Item -ItemType Directory -Force $tmpDir | Out-Null
$tmpA = Join-Path $tmpDir 'a.pdf'; $tmpB = Join-Path $tmpDir 'b.pdf'; $tmpS = Join-Path $tmpDir 's.pdf'
# Long paths (over 260 chars) need the \\?\ prefix for .NET file calls.
function LP($p) { if ($p.StartsWith('\\')) { $p } else { '\\?\' + $p } }
# qpdf prints recoverable warnings to stderr (exit code 3). Run it with errors not stopping the script,
# otherwise Windows PowerShell turns any stderr text into a failure.
function Invoke-Qpdf {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $qpdf @args 2>&1 | Out-Null } finally { $ErrorActionPreference = $old }
  return $LASTEXITCODE
}

$files = Get-ChildItem -LiteralPath $src -Recurse -File -Filter *.pdf -ErrorAction SilentlyContinue |
  Where-Object { $inPlace -or -not $_.FullName.StartsWith($dst, [StringComparison]::OrdinalIgnoreCase) }
$total = @($files).Count
Write-Host "$total PDF(s) found."
$report = New-Object System.Collections.Generic.List[object]
$i = 0; $nClean = 0; $nFixed = 0; $nFail = 0

foreach ($f in $files) {
  $i++
  $rel = $f.FullName.Substring($src.Length)
  Write-Progress -Activity 'Cleaning PDFs' -Status $rel -PercentComplete ([int](100 * $i / [Math]::Max($total,1)))
  $out = Join-Path $dst $rel
  if (-not $inPlace) { [IO.Directory]::CreateDirectory((LP (Split-Path $out))) | Out-Null }
  $status = ''; $found = ''; $note = ''
  try {
    # 1) unpack: decrypt (no-password files), no object streams, classic xref, streams left as-is
    [IO.File]::Copy((LP $f.FullName), $tmpS, $true)
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
      if (-not $inPlace) { [IO.File]::Copy((LP $f.FullName), (LP $out), $true) }
      $status = 'clean (unchanged)'; $nClean++
    } else {
      [IO.File]::WriteAllText($tmpB, $text, $latin1)
      # 2) repack: rebuild and recompress; also proves the result is a valid PDF
      $tmpC = Join-Path $tmpDir 'c.pdf'
      $code = Invoke-Qpdf --object-streams=generate --compress-streams=y -- $tmpB $tmpC
      if ($code -ne 0 -and $code -ne 3) { throw "rebuild failed, exit $code" }
      [IO.File]::Copy($tmpC, $(if ($inPlace) { LP $f.FullName } else { LP $out }), $true)
      $found = $hits -join ' '; $status = 'cleaned'; $nFixed++
      Write-Host "CLEANED  $rel  ->  $found" -ForegroundColor Yellow
    }
  } catch {
    $status = 'FAILED (left as is)'; $note = $_.Exception.Message; $nFail++
    if (-not $inPlace -and [IO.File]::Exists((LP $out))) { [IO.File]::Delete((LP $out)) }
    Write-Host "FAILED   $rel  ->  $note" -ForegroundColor Red
  }
  $report.Add([pscustomobject]@{ File = $rel; Status = $status; Found = $found; Note = $note; SizeKB = [int]($f.Length / 1KB) })
}
Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
$csv = Join-Path $dst 'pdfclean-report.csv'
$report | Export-Csv -LiteralPath $csv -NoTypeInformation -Encoding UTF8
Write-Host ''
Write-Host "Done. $total PDF(s): $nClean already clean, $nFixed cleaned, $nFail failed." -ForegroundColor Green
Write-Host "Output: $dst"
Write-Host "Report: $csv"
if ($nFail -gt 0) { Write-Host 'Failed files were NOT copied; check the report (usually password-protected or damaged PDFs).' }
