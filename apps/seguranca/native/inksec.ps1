# InkDOS Security engine - Office clean, archive scan and risky files scan (Windows).
# Not run directly: officeclean.ps1, archivescan.ps1 and riskyfiles.ps1 (same folder) set
# $env:INKSEC_MODE = office | archive | loose and load this file. One file type per run keeps scans small.
#
# Sibling of apps/editar-pdf/native/pdfclean.ps1. Walks a folder (or drive) recursively. Only files of the
# chosen type are opened, so videos and other big files in OneDrive/iCloud are not downloaded.
# office) Office (docx/docm/xlsx/xlsm/pptx/pptm and templates): removes VBA macros (vbaProject.bin),
#    points external links (remote templates, linked images/objects, Excel external links) to
#    about:blank (normal hyperlinks are kept) and empties embedded OLE objects (the preview
#    picture stays). These files are zip+XML, so Office does not need to be installed.
#    Excel 4.0 macro sheets, ActiveX and DDE are only reported.
#    Legacy .doc/.xls/.ppt: only reported when they contain VBA macros (not changed).
# archive) Archives (.zip, plus .rar/.7z when 7-Zip is installed): lists what is inside and reports
#    executables, scripts, shortcuts, disk images and double extensions (like .pdf.exe). Not changed.
# loose) Loose .exe/.lnk/.js/.vbs/.bat/.hta/... files and double extensions: reported only.
# Office output: a copy of the Office files in a separate folder (originals untouched), or R = clean
# risky Office files in place. Each mode writes a CSV report (archive/loose: Desktop\InkDOS-security).
# Several windows can run at once (each uses its own temp folder).

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
$mode = if ($env:INKSEC_MODE) { $env:INKSEC_MODE } else { 'office' }; $env:INKSEC_MODE = $null
$tag = @{ office = 'officeclean'; archive = 'archivescan'; loose = 'riskyfiles' }[$mode]
if (-not $tag) { throw "Unknown mode: $mode" }
Write-Host "InkDOS Security: $tag" -ForegroundColor Cyan

# Optional, for the retry command written next to the report:
#   $env:INKSEC_RETRY = a report CSV (only its FAILED files are processed)
#   $env:INKSEC_OUT   = 'R' (in place) or an output folder (office mode)
$retryCsv = $env:INKSEC_RETRY; $outPre = $env:INKSEC_OUT
$env:INKSEC_RETRY = $null; $env:INKSEC_OUT = $null
if (-not $retryCsv) {
  $ans = (Read-Host 'Folder or drive to scan (or a $tag report .csv to retry only its failed files)').Trim('"', ' ')
  if ($ans -match '\.csv$') { $retryCsv = $ans } else { $src = $ans }
}
$retryRows = $null
if ($retryCsv) {
  if (-not (Test-Path -LiteralPath $retryCsv -PathType Leaf)) { throw "Report not found: $retryCsv" }
  $retryCsv = (Resolve-Path -LiteralPath $retryCsv).ProviderPath
  $all = @(Import-Csv -LiteralPath $retryCsv)
  $retryRows = @($all | Where-Object { $_.Status -like 'FAILED*' })
  $src = if ($all.Count -and $all[0].Root) { $all[0].Root } else { Split-Path $retryCsv }
  Write-Host "Retry mode: $($retryRows.Count) failed file(s) from $retryCsv"
  if ($retryRows.Count -eq 0) { Write-Host 'No failed files in that report. Nothing to do.' -ForegroundColor Green; return }
}
if (-not (Test-Path -LiteralPath $src -PathType Container)) { throw "Folder not found: $src" }
$src = (Resolve-Path -LiteralPath $src).ProviderPath.TrimEnd('\') + '\'
$defOut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Office-clean'
if ($mode -ne 'office') { $outPre = Join-Path ([Environment]::GetFolderPath('Desktop')) 'InkDOS-security' }
$dst = if ($outPre) { $outPre } else { (Read-Host "Output folder [Enter = $defOut, R = replace the originals in place]").Trim('"', ' ') }
$inPlace = $dst -eq 'R' -or $dst -eq 'r'
if ($inPlace) {
  Write-Host 'IN-PLACE MODE: risky Office files will be overwritten with the cleaned version. Everything else is only reported.' -ForegroundColor Yellow
  if (-not $outPre -and (Read-Host 'Type YES to continue') -ne 'YES') { Write-Host 'Cancelled.'; return }
  $dst = $src
} else {
  if (-not $dst) { $dst = $defOut }
  New-Item -ItemType Directory -Force $dst | Out-Null
  $dst = (Resolve-Path -LiteralPath $dst).ProviderPath.TrimEnd('\') + '\'
  if ($mode -eq 'office' -and $dst.StartsWith($src, [StringComparison]::OrdinalIgnoreCase)) { Write-Host 'Note: output is inside the scanned folder; it will be skipped.' }
}

$ooxmlExt = 'docx','docm','dotx','dotm','xlsx','xlsm','xltx','xltm','xlam','pptx','pptm','potx','potm','ppsx','ppsm','ppam'
$legacyExt = 'doc','dot','xls','xlt','ppt','pps','pot'
$archExt = 'zip','rar','7z'
$riskExt = 'exe','scr','com','pif','bat','cmd','vbs','vbe','js','jse','wsf','wsh','hta','lnk','ps1','psm1','msi','msp','reg','jar','cpl','scf','chm','iso','img','vhd','vhdx','appx','msix','application'
$docRx = '\.(pdf|docx?|xlsx?|pptx?|txt|rtf|csv|jpe?g|png|gif|bmp|mp3|mp4|avi|mov|zip|rar|7z)[\s\.]*\.[^.]+$'
$cloudMask = 0x441000   # Offline | RecallOnOpen | RecallOnDataAccess = OneDrive/iCloud online-only
$bigCloud = 500MB       # online-only archives bigger than this are skipped (would be downloaded)

$tmpDir = Join-Path $env:TEMP "inkdos-officeclean-$PID"  # per window, so several can run at once
New-Item -ItemType Directory -Force $tmpDir | Out-Null
$tmpA = Join-Path $tmpDir 'a.zip'
function Get-LongPath($p) { if ($p.StartsWith('\\')) { $p } else { '\\?\' + $p } }
function Get-Ext($n) { $i = $n.LastIndexOf('.'); if ($i -lt 0) { '' } else { $n.Substring($i + 1).ToLowerInvariant() } }

$sevenZip = @("$env:ProgramFiles\7-Zip\7z.exe", "${env:ProgramFiles(x86)}\7-Zip\7z.exe") | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $sevenZip) { $c = Get-Command 7z.exe -ErrorAction SilentlyContinue; if ($c) { $sevenZip = $c.Source } }
if ($sevenZip) { Write-Host "Using $sevenZip for .rar/.7z" } else { Write-Host '7-Zip not found: .rar/.7z will be listed as skipped (.zip still checked).' }

# Why a file name is risky ('' = not risky).
function Get-Risk($name) {
  $leaf = ($name -split '[\\/]')[-1]
  if ($leaf.IndexOf([char]0x202E) -ge 0) { return 'hidden right-to-left character in name' }
  $e = Get-Ext $leaf
  if ($riskExt -contains $e) { if ($leaf -match $docRx) { return "double extension (.$e)" } else { return "executable/script (.$e)" } }
  if ('docm','xlsm','pptm','dotm','xltm','potm','ppsm' -contains $e) { return "macro-enabled Office (.$e)" }
  return ''
}

function Read-Entry($e) { $r = New-Object IO.StreamReader($e.Open(), $true); try { $r.ReadToEnd() } finally { $r.Dispose() } }
function Write-Entry($e, $text) {
  $s = $e.Open()
  try { $s.SetLength(0); $b = (New-Object Text.UTF8Encoding($false)).GetBytes($text); $s.Write($b, 0, $b.Length) } finally { $s.Dispose() }
}

# Opens a zip; if it is not a valid zip, closes the file again (otherwise it stays locked
# and every later file fails with "access denied / in use").
function Open-Zip($stream, $zmode) {
  try { return New-Object IO.Compression.ZipArchive($stream, $zmode) } catch { $stream.Dispose(); throw }
}

# Cleans the Office zip at $path in place. Returns @{ Changed; Found }.
function Clear-Ooxml($path) {
  $found = New-Object Collections.Generic.List[string]
  $cnt = @{ vba = 0; ext = 0; ole = 0 }
  $zip = Open-Zip ([IO.File]::Open($path, 'Open', 'ReadWrite')) ([IO.Compression.ZipArchiveMode]::Update)
  try {
    $entries = @($zip.Entries)
    $removed = @()
    foreach ($e in $entries) {
      $n = $e.FullName
      if ($n -match '(^|/)vbaProject\.bin$' -or $n -match '(^|/)vbaData\.xml$' -or $n -match '(^|/)_rels/vbaProject\.bin\.rels$') {
        if ($n -match 'vbaProject\.bin$') { $cnt.vba++ }
        $removed += '/' + $n; $e.Delete()
      } elseif ($n -match '/embeddings/[^/]+\.(bin|docm|xlsm|pptm|xlsb)$' -and $e.Length -gt 0) {
        $s = $e.Open(); try { $s.SetLength(0) } finally { $s.Dispose() }; $cnt.ole++
      }
    }
    $xlm = @($entries | Where-Object { $_.FullName -match '/macrosheets/' -and $_.FullName -notmatch '_rels/' }).Count
    $ax = @($entries | Where-Object { $_.FullName -match '/activeX/[^/]+\.bin$' }).Count
    $eval = [Text.RegularExpressions.MatchEvaluator]{
      param($m)
      $t = $m.Value
      $type = if ($t -match '\bType="([^"]*)"') { $matches[1] } else { '' }
      $target = if ($t -match '\bTarget="([^"]*)"') { $matches[1] } else { '' }
      if ($type -match 'vbaProject$' -or $target -match 'vbaProject\.bin$') { return '' }
      if ($t -match 'TargetMode="External"' -and $type -notmatch '/hyperlink$' -and $target -ne 'about:blank') {
        $cnt.ext++; return ($t -replace '\bTarget="[^"]*"', 'Target="about:blank"')
      }
      return $t
    }
    $dde = $false
    foreach ($e in @($zip.Entries)) {
      $n = $e.FullName
      if ($n -match '\.rels$') {
        $old = Read-Entry $e
        $new = [regex]::Replace($old, '<Relationship\b[^>]*?(/>|>\s*</Relationship>)', $eval)
        if ($new -ne $old) { Write-Entry $e $new }
      } elseif ($n -eq '[Content_Types].xml' -and $removed.Count) {
        $old = Read-Entry $e; $new = $old
        foreach ($p in $removed) { $new = $new -replace ('<Override\b[^>]*PartName="' + [regex]::Escape($p) + '"[^>]*/>'), '' }
        if ($new -ne $old) { Write-Entry $e $new }
      } elseif ($n -match '^word/(document|header\d*|footer\d*)\.xml$' -or $n -match '^xl/externalLinks/[^/]+\.xml$') {
        $x = Read-Entry $e
        if ($x -match 'DDEAUTO|>\s*DDE\s|<ddeLink') { $dde = $true }
      }
    }
  } finally { $zip.Dispose() }
  if ($cnt.vba) { $found.Add("macros($($cnt.vba))") }
  if ($cnt.ext) { $found.Add("external-links($($cnt.ext))") }
  if ($cnt.ole) { $found.Add("OLE-objects($($cnt.ole))") }
  $note = @()
  if ($xlm) { $note += "Excel 4.0 macro sheet(s): $xlm (not removed)" }
  if ($ax) { $note += "ActiveX control(s): $ax (not removed)" }
  if ($dde) { $note += 'DDE field/link (not removed)' }
  # Check the result is still a readable Office package.
  $z = Open-Zip ([IO.File]::OpenRead($path)) ([IO.Compression.ZipArchiveMode]::Read)
  try {
    if (-not ($z.Entries | Where-Object { $_.FullName -eq '[Content_Types].xml' })) { throw 'not an Office file (no [Content_Types].xml)' }
    foreach ($e in $z.Entries) { if ($e.FullName -match '\.rels$') { [void][xml](Read-Entry $e) } }
  } finally { $z.Dispose() }
  return @{ Changed = ($found.Count -gt 0); Found = ($found -join ' '); Note = ($note -join '; ') }
}

# Legacy binary Office: VBA storage names are UTF-16 in the file's directory.
function Test-LegacyMacros($full) {
  $b = [IO.File]::ReadAllBytes((Get-LongPath $full))
  $s = [Text.Encoding]::Unicode.GetString($b)
  return $s.Contains('_VBA_PROJECT')
}

function Get-ArchiveNames($full, $ext) {
  if ($ext -eq 'zip') {
    try {
      $z = Open-Zip ([IO.File]::OpenRead((Get-LongPath $full))) ([IO.Compression.ZipArchiveMode]::Read)
      try { return ,@($z.Entries | ForEach-Object { $_.FullName }) } finally { $z.Dispose() }
    } catch { if (-not $sevenZip) { throw "could not read zip: $($_.Exception.Message)" } }
  }
  if (-not $sevenZip) { return $null }
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    # A wrong dummy password makes encrypted archives fail instead of waiting for input.
    $out = & $sevenZip l -slt -ba '-pinkdos-no-password' -- "$full" 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $old }
  if ($code -ne 0) { throw "7-Zip could not list it (password-protected or damaged), exit $code" }
  return ,@($out | Where-Object { $_ -like 'Path = *' } | ForEach-Object { $_.Substring(7) })
}

if ($retryCsv) {
  $files = foreach ($r in $retryRows) {
    $full = Join-Path $src $r.File
    $fi = New-Object IO.FileInfo (Get-LongPath $full)
    if ($fi.Exists) { [pscustomobject]@{ FullName = $full; Name = $fi.Name; Length = $fi.Length } } else { Write-Host "Missing now: $($r.File)" }
  }
} else {
  Write-Host 'Listing files (nothing is downloaded yet)...'
  $files = Get-ChildItem -LiteralPath $src -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object { -not $_.Name.StartsWith('._') } |   # macOS "._" metadata files, not real documents
    Where-Object { ($inPlace -or -not $_.FullName.StartsWith($dst, [StringComparison]::OrdinalIgnoreCase)) -and
      ($mode -eq 'loose' -or ($(if ($mode -eq 'office') { $ooxmlExt + $legacyExt } else { $archExt }) -contains (Get-Ext $_.Name))) }
}
$files = @($files)
$total = $files.Count
Write-Host "$total file(s) found."
$report = New-Object System.Collections.Generic.List[object]
$i = 0; $nOffice = 0; $nFixed = 0; $nFlag = 0; $nFail = 0

foreach ($f in $files) {
  $i++
  $rel = $f.FullName.Substring($src.Length)
  $ext = Get-Ext $f.Name
  $risk = Get-Risk $f.Name
  $kind = if ($ooxmlExt -contains $ext) { 'office' } elseif ($legacyExt -contains $ext) { 'legacy office' } elseif ($archExt -contains $ext) { 'archive' } else { '' }
  if ($mode -eq 'loose' -or -not $kind) {
    if ($risk) {
      $report.Add([pscustomobject]@{ File = $rel; Kind = 'loose file'; Status = 'FLAGGED'; Found = $risk; Note = 'not changed'; SizeKB = [int]($f.Length / 1KB); Root = $src })
      $nFlag++; Write-Host "FLAGGED  $rel  ->  $risk" -ForegroundColor Magenta
    }
    continue
  }
  if (($mode -eq 'archive') -ne ($kind -eq 'archive')) { continue }
  if ($f.Name.StartsWith('~$')) { continue }   # Office lock file
  if ($i % 20 -eq 0 -or $kind -ne 'office') { Write-Progress -Activity 'Checking Office files and archives' -Status $rel -PercentComplete ([int](100 * $i / [Math]::Max($total,1))) }
  $wasCloud = $false
  try { $wasCloud = (([int][IO.File]::GetAttributes((Get-LongPath $f.FullName))) -band $cloudMask) -ne 0 } catch {}
  $status = ''; $found = ''; $note = ''
  try {
    if ($kind -eq 'office') {
      $nOffice++
      $out = Join-Path $dst $rel
      [IO.File]::Copy((Get-LongPath $f.FullName), $tmpA, $true)
      $res = Clear-Ooxml $tmpA
      $note = $res.Note
      if ($res.Changed) {
        if (-not $inPlace) { [IO.Directory]::CreateDirectory((Get-LongPath (Split-Path $out))) | Out-Null }
        [IO.File]::Copy($tmpA, $(if ($inPlace) { Get-LongPath $f.FullName } else { Get-LongPath $out }), $true)
        $found = $res.Found; $status = 'CLEANED'; $nFixed++
        Write-Host "CLEANED  $rel  ->  $found" -ForegroundColor Yellow
      } else {
        if (-not $inPlace) { [IO.Directory]::CreateDirectory((Get-LongPath (Split-Path $out))) | Out-Null; [IO.File]::Copy((Get-LongPath $f.FullName), (Get-LongPath $out), $true) }
        $status = 'clean (unchanged)'
      }
      if ($note) { $nFlag++; Write-Host "NOTE     $rel  ->  $note" -ForegroundColor Magenta }
    } elseif ($kind -eq 'legacy office') {
      if ($f.Length -gt 200MB) { $status = 'skipped'; $note = 'over 200 MB' }
      elseif (Test-LegacyMacros $f.FullName) {
        $status = 'FLAGGED'; $found = 'macros (old format, not changed)'; $nFlag++
        Write-Host "FLAGGED  $rel  ->  $found" -ForegroundColor Magenta
      } else { $status = 'no macros found' }
    } else {
      if ($wasCloud -and $f.Length -gt $bigCloud) { $status = 'skipped'; $note = 'online-only and over 500 MB (not downloaded)' }
      else {
        $names = Get-ArchiveNames $f.FullName $ext
        if ($null -eq $names) { $status = 'skipped'; $note = 'needs 7-Zip' }
        else {
          $bad = @($names | ForEach-Object { $r = Get-Risk $_; if ($r) { "$_ [$r]" } })
          if ($bad.Count) {
            $status = 'FLAGGED'; $found = "$($bad.Count) risky item(s)"; $note = ($bad | Select-Object -First 15) -join '; '
            if ($bad.Count -gt 15) { $note += '; ...' }
            $nFlag++; Write-Host "FLAGGED  $rel  ->  $found" -ForegroundColor Magenta
          } else { $status = "ok ($($names.Count) item(s))" }
        }
      }
    }
  } catch {
    $status = 'FAILED (left as is)'; $note = $_.Exception.Message; $nFail++
    Write-Host "FAILED   $rel  ->  $note" -ForegroundColor Red
  }
  if ($wasCloud) {
    # Put it back to online-only so the PC doesn't fill up (OneDrive/iCloud frees it after syncing).
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & attrib.exe +U -P "$($f.FullName)" 2>&1 | Out-Null } finally { $ErrorActionPreference = $old }
  }
  $report.Add([pscustomobject]@{ File = $rel; Kind = $kind; Status = $status; Found = $found; Note = $note; SizeKB = [int]($f.Length / 1KB); Root = $src })
}
Write-Progress -Activity 'Checking Office files and archives' -Completed
Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
$stamp = if ($mode -eq 'office') { '' } else { '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + "-$PID" }  # report-only runs never overwrite each other
$csv = Join-Path $dst ("$tag-report" + $(if ($retryCsv) { '-retry' } else { '' }) + "$stamp.csv")
$report | Export-Csv -LiteralPath $csv -NoTypeInformation -Encoding UTF8
Write-Host ''
if ($mode -eq 'office') { Write-Host "Done. $nOffice Office file(s): $nFixed cleaned. $nFlag item(s) flagged for you to check. $nFail failed." -ForegroundColor Green }
else { Write-Host "Done. $total file(s) looked at: $nFlag flagged for you to check. $nFail failed. Nothing was changed." -ForegroundColor Green }
Write-Host "Output: $dst"
Write-Host "Report: $csv  (open in Excel; filter Status by CLEANED / FLAGGED / FAILED)"
if ($nFail -gt 0) {
  Write-Host 'Failed files were NOT changed (usually open in another program, password-protected or damaged).'
  $q = { param($v) "'" + ($v -replace "'", "''") + "'" }
  $outMode = if ($inPlace) { 'R' } else { $dst }
  $cmd = '$env:INKSEC_RETRY=' + (& $q $csv) + '; $env:INKSEC_OUT=' + (& $q $outMode) + "; irm `"https://hub.inkdos.workers.dev/apps/seguranca/native/$tag.ps1?`$(Get-Random)`" | iex"
  $txt = Join-Path $dst ("$tag-retry$stamp.txt")
  [IO.File]::WriteAllText($txt, "Retry only the $nFail failed file(s): paste this line into PowerShell`r`n`r`n$cmd`r`n", [Text.Encoding]::UTF8)
  Write-Host "Retry command saved to: $txt"
}
