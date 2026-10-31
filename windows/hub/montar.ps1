# Monta o InkDOS Hub para Windows a partir do Electron oficial, enxuto:
# - a versão estável mais nova do Electron (GitHub electron/electron), conferida pelo SHA-256 publicado por eles;
# - só o idioma en-US do Chromium (os 7 idiomas do Hub vêm do site), sem o app de exemplo e sem o SwiftShader/Vulkan;
# - main.js, preload.js e o ícone em resources\app; o .exe com nome, ícone e versão do InkDOS Hub.
# Uso (Windows, com Node): .\windows\hub\montar.ps1 -Saida saida   ->  saida\InkDOS Hub\InkDOS Hub.exe
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
if (-not $rel) { throw 'nenhuma versão estável do Electron com pacote do Windows' }
$base = 'https://github.com/electron/electron/releases/download/' + $rel.tag_name + '/'
Write-Host ('Electron ' + $rel.tag_name)
$zip = Join-Path $Saida $nomeZip
$shas = Join-Path $Saida 'SHASUMS256.txt'
Invoke-WebRequest ($base + $nomeZip) -OutFile $zip -UseBasicParsing
Invoke-WebRequest ($base + 'SHASUMS256.txt') -OutFile $shas -UseBasicParsing
$esperado = ((Get-Content $shas | Where-Object { $_ -match ('\*?' + [regex]::Escape($nomeZip) + '$') } | Select-Object -First 1) -split '\s+')[0].ToLower()
$real = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if (-not $esperado -or $esperado -ne $real) { throw 'SHA-256 do Electron não confere' }
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
foreach ($f in @('main.js', 'preload.js', 'icone.ico')) { Copy-Item (Join-Path $aqui $f) $res }
$pacote = Get-Content (Join-Path $aqui 'package.json') -Raw | ConvertFrom-Json
if ($Versao) { $pacote.version = $Versao }
$versao = $pacote.version
[IO.File]::WriteAllText((Join-Path $res 'package.json'), ($pacote | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
Copy-Item (Join-Path $aqui '..\..\LICENSE') (Join-Path $app 'LICENSE.InkDOSHub.txt')
# som de um programa só (Gravador): application-loopback 1.2.7 (MIT), exes conferidos pelo SHA-256
$aud = Join-Path $app 'audio'
New-Item -ItemType Directory -Force -Path $aud | Out-Null
$tgz = Join-Path $Saida 'al.tgz'
Invoke-WebRequest 'https://registry.npmjs.org/application-loopback/-/application-loopback-1.2.7.tgz' -OutFile $tgz
if ((Get-FileHash $tgz -Algorithm SHA256).Hash -ne 'F34570E3E7E5C0BFDBDC7CDD91B17F0F7DB092BB7DF77AE1D04947C576875807') { throw 'application-loopback: SHA-256 não confere' }
tar -xzf $tgz -C $Saida
foreach ($f in @('ApplicationLoopback.exe', 'ProcessList.exe')) { Copy-Item (Join-Path $Saida ('package\bin\win32-x64\' + $f)) $aud }
Copy-Item (Join-Path $Saida 'package\LICENSE') (Join-Path $aud 'LICENSE.application-loopback.txt')
Remove-Item -Recurse -Force $tgz, (Join-Path $Saida 'package')

# ícones dos tipos de arquivo (cada tipo com o ícone do app que o abre)
Copy-Item -Recurse (Join-Path $aqui 'tipos') (Join-Path $app 'tipos')

# nome, ícone e versão no .exe (rcedit, do projeto Electron)
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
Write-Host ('Pronto: ' + $app + ' (' + $mb + ' MB, Electron ' + $rel.tag_name + ', versão ' + $versao + ')')
"HUB_VERSAO=$versao" | Out-File -Append -Encoding utf8 $env:GITHUB_ENV -ErrorAction SilentlyContinue
"ELECTRON_VERSAO=$($rel.tag_name)" | Out-File -Append -Encoding utf8 $env:GITHUB_ENV -ErrorAction SilentlyContinue
