# Builds InkDOS Hub for Windows from the official Electron, trimmed:
# - the newest stable Electron (GitHub electron/electron), checked against the SHA-256 they publish;
# - only the Chromium en-US locale (the Hub's 7 languages come from the site), no sample app and no SwiftShader/Vulkan;
# - main.js, preload.js, ia.js and the icon in resources\app; the .exe with InkDOS Hub name, icon and version.
# Usage (Windows, with Node): .\windows\hub\montar.ps1 -Saida saida   ->  saida\InkDOS Hub\InkDOS Hub.exe
param([string]$Saida = 'saida', [string]$Versao = '')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$aqui = $PSScriptRoot
New-Item -ItemType Directory -Force -Path $Saida | Out-Null
$Saida = (Resolve-Path $Saida).Path

$cab = @{ 'User-Agent' = 'InkDOSHub-build' }
if ($env:GH_TOKEN) { $cab['Authorization'] = 'Bearer ' + $env:GH_TOKEN }
$rels = Invoke-RestMethod 'https://api.github.com/repos/electron/electron/releases?per_page=30' -Headers $cab
$rel = $null
foreach ($r in $rels) {
  if ($r.prerelease -or $r.draft) { continue }
  $nomeZip = 'electron-' + $r.tag_name + '-win32-x64.zip'
  if (($r.assets | Where-Object { $_.name -eq $nomeZip }) -and ($r.assets | Where-Object { $_.name -eq 'SHASUMS256.txt' })) { $rel = $r; break }
}
if (-not $rel) { throw 'no stable Electron release with a Windows package' }
$base = 'https://github.com/electron/electron/releases/download/' + $rel.tag_name + '/'
Write-Host ('Electron ' + $rel.tag_name)
$zip = Join-Path $Saida $nomeZip
$shas = Join-Path $Saida 'SHASUMS256.txt'
Invoke-WebRequest ($base + $nomeZip) -OutFile $zip -UseBasicParsing
Invoke-WebRequest ($base + 'SHASUMS256.txt') -OutFile $shas -UseBasicParsing
$esperado = ((Get-Content $shas | Where-Object { $_ -match ('\*?' + [regex]::Escape($nomeZip) + '$') } | Select-Object -First 1) -split '\s+')[0].ToLower()
$real = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if (-not $esperado -or $esperado -ne $real) { throw 'Electron SHA-256 mismatch' }
Write-Host 'SHA-256 do Electron conferido'

$app = Join-Path $Saida 'InkDOS Hub'
Remove-Item -Recurse -Force $app -ErrorAction SilentlyContinue
Expand-Archive $zip $app -Force
Remove-Item $zip, $shas

# enxugar
Get-ChildItem (Join-Path $app 'locales') -Filter *.pak | Where-Object { $_.Name -ne 'en-US.pak' } | Remove-Item
foreach ($f in @('resources\default_app.asar', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll')) {
  Remove-Item (Join-Path $app $f) -ErrorAction SilentlyContinue
}
Rename-Item (Join-Path $app 'electron.exe') 'InkDOS Hub.exe'

# o app
$res = Join-Path $app 'resources\app'
New-Item -ItemType Directory -Force -Path $res | Out-Null
foreach ($f in @('main.js', 'preload.js', 'ia.js', 'icone.ico')) { Copy-Item (Join-Path $aqui $f) $res }
$pacote = Get-Content (Join-Path $aqui 'package.json') -Raw | ConvertFrom-Json
if ($Versao) { $pacote.version = $Versao }
$versao = $pacote.version
[IO.File]::WriteAllText((Join-Path $res 'package.json'), ($pacote | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
Copy-Item (Join-Path $aqui '..\..\LICENSE') (Join-Path $app 'LICENSE.InkDOSHub.txt')
# sound from a single program (Recorder): application-loopback 1.2.7 (MIT), exes checked by SHA-256
$aud = Join-Path $app 'audio'
New-Item -ItemType Directory -Force -Path $aud | Out-Null
$tgz = Join-Path $Saida 'al.tgz'
Invoke-WebRequest 'https://registry.npmjs.org/application-loopback/-/application-loopback-1.2.7.tgz' -OutFile $tgz
if ((Get-FileHash $tgz -Algorithm SHA256).Hash -ne 'F34570E3E7E5C0BFDBDC7CDD91B17F0F7DB092BB7DF77AE1D04947C576875807') { throw 'application-loopback: SHA-256 mismatch' }
tar -xzf $tgz -C $Saida
foreach ($f in @('ApplicationLoopback.exe', 'ProcessList.exe')) { Copy-Item (Join-Path $Saida ('package\bin\win32-x64\' + $f)) $aud }
Copy-Item (Join-Path $Saida 'package\LICENSE') (Join-Path $aud 'LICENSE.application-loopback.txt')
Remove-Item -Recurse -Force $tgz, (Join-Path $Saida 'package')

# file type icons (each type with the icon of the app that opens it)
Copy-Item -Recurse (Join-Path $aqui 'tipos') (Join-Path $app 'tipos')

# name, icon and version in the .exe (rcedit, from the Electron project)
$ferr = Join-Path $Saida 'ferramentas'
New-Item -ItemType Directory -Force -Path $ferr | Out-Null
Push-Location $ferr
npm install --silent --no-audit --no-fund rcedit@4 | Out-Null
$js = "require('rcedit')(process.argv[1], { icon: process.argv[2], 'file-version': process.argv[3], 'product-version': process.argv[3], 'version-string': { ProductName: 'InkDOS Hub', FileDescription: 'InkDOS Hub', CompanyName: 'InkDOS Hub', LegalCopyright: 'MIT License', OriginalFilename: 'InkDOS Hub.exe', InternalName: 'InkDOS Hub' } }).catch(e => { console.error(e); process.exit(1); })"
node -e $js (Join-Path $app 'InkDOS Hub.exe') (Join-Path $aqui 'icone.ico') $versao
if ($LASTEXITCODE -ne 0) { throw 'rcedit falhou' }
Pop-Location
Remove-Item -Recurse -Force $ferr

$mb = [Math]::Round(((Get-ChildItem $app -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host ('Done: ' + $app + ' (' + $mb + ' MB, Electron ' + $rel.tag_name + ', version ' + $versao + ')')
"HUB_VERSAO=$versao" | Out-File -Append -Encoding utf8 $env:GITHUB_ENV -ErrorAction SilentlyContinue
"ELECTRON_VERSAO=$($rel.tag_name)" | Out-File -Append -Encoding utf8 $env:GITHUB_ENV -ErrorAction SilentlyContinue
