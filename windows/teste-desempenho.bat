@echo off
rem InkDOS Hub: teste de desempenho no Windows (Edge, WebView2, Brave e Electron).
rem Abre os mesmos apps do Hub em cada motor, mede memoria e CPU e grava um relatorio na Area de Trabalho.
rem O codigo depois da marca PS (mais abaixo) e PowerShell; este .bat so o executa.
title InkDOS Hub - teste de desempenho
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = Get-Content -LiteralPath '%~f0' -Raw -Encoding UTF8; iex ($t.Substring($t.IndexOf('#PS' + '#') + 4))"
echo.
pause
exit /b
#PS#
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms

$site = 'https://inkdoshub.github.io/'
# os mesmos apps em todos os motores: tela inicial + 7 apps abertos juntos
$apps = @(
  'inkdos/apps/pdf/index.html?suite=1',
  'inkdos/apps/documents/index.html?suite=1',
  'apps/foto/',
  'apps/video/',
  'apps/editar-pdf/',
  'onlyoffice/editor.html?new=docx',
  'apps/codigo/'
)
$aquecer1 = 20; $medir1 = 20   # cenario 1: so a tela inicial
$aquecer2 = 60; $medir2 = 30   # cenario 2: tela inicial + 7 apps

$pasta = Join-Path ([Environment]::GetFolderPath('Desktop')) 'InkDOSHub-teste'
$tmp = Join-Path $env:TEMP 'InkDOSHub-teste'
New-Item -ItemType Directory -Force -Path $pasta, $tmp | Out-Null
$nucleos = [Environment]::ProcessorCount
$resultados = @()

function Diga($s) { Write-Host ((Get-Date).ToString('HH:mm:ss') + '  ' + $s) }

# processos do motor em teste: os que tem a pasta de perfil exclusiva do teste e todos os filhos deles
function Processos($exe, $marca) {
  $todos = @(Get-CimInstance Win32_Process -Filter ("Name='" + $exe + "'") -ErrorAction SilentlyContinue)
  if ($marca) {
    $ids = @{}
    foreach ($p in $todos) { if ($p.CommandLine -and $p.CommandLine.Contains($marca)) { $ids[[int]$p.ProcessId] = 1 } }
    do {
      $novos = 0
      foreach ($p in $todos) { if (-not $ids.ContainsKey([int]$p.ProcessId) -and $ids.ContainsKey([int]$p.ParentProcessId)) { $ids[[int]$p.ProcessId] = 1; $novos++ } }
    } while ($novos -gt 0)
    $todos = $todos | Where-Object { $ids.ContainsKey([int]$_.ProcessId) }
  }
  @($todos | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | Where-Object { $_ })
}

# mede por $seg segundos: memoria privada e de trabalho (soma dos processos) e CPU media
function Medir($exe, $marca, $seg, $bombear) {
  $priv = @(); $ws = @(); $cpu = @(); $n = 0
  $antes = @{}
  foreach ($p in (Processos $exe $marca)) { try { $antes[$p.Id] = $p.TotalProcessorTime.TotalSeconds } catch {} }
  $t0 = Get-Date
  for ($i = 0; $i -lt $seg; $i++) {
    $fim = (Get-Date).AddSeconds(1)
    while ((Get-Date) -lt $fim) { if ($bombear) { [System.Windows.Forms.Application]::DoEvents() }; Start-Sleep -Milliseconds 50 }
    $ps = Processos $exe $marca
    $n = [Math]::Max($n, $ps.Count)
    $priv += ($ps | Measure-Object PrivateMemorySize64 -Sum).Sum
    $ws += ($ps | Measure-Object WorkingSet64 -Sum).Sum
  }
  $dt = ((Get-Date) - $t0).TotalSeconds
  $uso = 0
  foreach ($p in (Processos $exe $marca)) {
    try { $a = 0; if ($antes.ContainsKey($p.Id)) { $a = $antes[$p.Id] }; $uso += [Math]::Max(0, $p.TotalProcessorTime.TotalSeconds - $a) } catch {}
  }
  [pscustomobject]@{
    Processos = $n
    PrivadaMB = [Math]::Round((($priv | Measure-Object -Average).Average) / 1MB)
    PicoMB    = [Math]::Round((($priv | Measure-Object -Maximum).Maximum) / 1MB)
    TrabalhoMB = [Math]::Round((($ws | Measure-Object -Average).Average) / 1MB)
    CPU       = [Math]::Round(100 * $uso / ($dt * $nucleos), 1)
  }
}

function Esperar($seg, $bombear) {
  $fim = (Get-Date).AddSeconds($seg)
  while ((Get-Date) -lt $fim) { if ($bombear) { [System.Windows.Forms.Application]::DoEvents() }; Start-Sleep -Milliseconds 50 }
}

function Guardar($motor, $cenario, $m) {
  $script:resultados += [pscustomobject]@{ Motor = $motor; Cenario = $cenario; Processos = $m.Processos; MemoriaPrivadaMB = $m.PrivadaMB; PicoMB = $m.PicoMB; MemoriaTrabalhoMB = $m.TrabalhoMB; CPUmedia = $m.CPU }
  Diga ("   " + $cenario + ": " + $m.PrivadaMB + " MB (pico " + $m.PicoMB + "), CPU " + $m.CPU + " %, " + $m.Processos + " processos")
}

function Fechar($exe, $marca) {
  Processos $exe $marca | ForEach-Object { try { $_.Kill() } catch {} }
  Start-Sleep -Seconds 3
}

# ---------- navegadores (Edge e Brave): perfil novo e vazio, so para o teste ----------
function TestarNavegador($nome, $caminho) {
  $exe = Split-Path $caminho -Leaf
  $perfil = Join-Path $tmp ('perfil-' + $nome)
  Remove-Item -Recurse -Force $perfil -ErrorAction SilentlyContinue
  $base = @('--user-data-dir="' + $perfil + '"', '--no-first-run', '--no-default-browser-check', '--disable-sync')
  Diga ($nome + ': abrindo a tela inicial')
  Start-Process $caminho -ArgumentList ($base + @('--new-window', $site))
  Esperar $aquecer1 $false
  Guardar $nome 'Tela inicial' (Medir $exe $perfil $medir1 $false)
  Diga ($nome + ': abrindo 7 apps')
  foreach ($a in $apps) { Start-Process $caminho -ArgumentList ($base + @('--new-window', ($site + $a))); Start-Sleep -Seconds 2 }
  Esperar $aquecer2 $false
  Guardar $nome 'Tela inicial + 7 apps' (Medir $exe $perfil $medir2 $false)
  Fechar $exe $perfil
}

$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$brave = @("$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe", "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe", "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1

Write-Host ''
Write-Host 'InkDOS Hub: teste de desempenho'
Write-Host 'Nao use o PC durante o teste (uns 10 minutos). As janelas abrem e fecham sozinhas.'
Write-Host ''

try { if ($edge) { TestarNavegador 'Edge' $edge } else { Diga 'Edge nao encontrado; pulando.' } } catch { Diga ('Edge falhou: ' + $_) }

# ---------- WebView2: um app com o motor do Edge embutido, como o .exe do Hub seria ----------
try {
  Diga 'WebView2: baixando o componente oficial (NuGet, Microsoft)'
  $wv = Join-Path $tmp 'webview2'
  if (-not (Test-Path (Join-Path $wv 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'))) {
    Invoke-WebRequest 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2' -OutFile (Join-Path $tmp 'webview2.zip') -UseBasicParsing
    Remove-Item -Recurse -Force $wv -ErrorAction SilentlyContinue
    Expand-Archive (Join-Path $tmp 'webview2.zip') $wv -Force
  }
  Copy-Item (Join-Path $wv 'runtimes\win-x64\native\WebView2Loader.dll') (Join-Path $wv 'lib\net462\') -Force
  Add-Type -Path (Join-Path $wv 'lib\net462\Microsoft.Web.WebView2.Core.dll')
  Add-Type -Path (Join-Path $wv 'lib\net462\Microsoft.Web.WebView2.WinForms.dll')
  $env:PATH = (Join-Path $wv 'lib\net462') + ';' + $env:PATH
  $dados = Join-Path $tmp 'perfil-WebView2'
  Remove-Item -Recurse -Force $dados -ErrorAction SilentlyContinue
  $tarefa = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($null, $dados, $null)
  while (-not $tarefa.IsCompleted) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }
  $ambiente = $tarefa.Result
  $janelas = @()
  function JanelaWebView($url) {
    $f = New-Object System.Windows.Forms.Form
    $f.Width = 1100; $f.Height = 750; $f.Text = 'InkDOS Hub (WebView2)'
    $w = New-Object Microsoft.Web.WebView2.WinForms.WebView2
    $w.Dock = 'Fill'
    $f.Controls.Add($w)
    $f.Show()
    $t = $w.EnsureCoreWebView2Async($ambiente)
    while (-not $t.IsCompleted) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 20 }
    $w.CoreWebView2.Navigate($url)
    $f
  }
  Diga 'WebView2: abrindo a tela inicial'
  $janelas += JanelaWebView $site
  Esperar $aquecer1 $true
  Guardar 'WebView2' 'Tela inicial' (Medir 'msedgewebview2.exe' $dados $medir1 $true)
  Diga 'WebView2: abrindo 7 apps'
  foreach ($a in $apps) { $janelas += JanelaWebView ($site + $a); Esperar 2 $true }
  Esperar $aquecer2 $true
  Guardar 'WebView2' 'Tela inicial + 7 apps' (Medir 'msedgewebview2.exe' $dados $medir2 $true)
  foreach ($f in $janelas) { $f.Close(); $f.Dispose() }
  Esperar 3 $true
  Fechar 'msedgewebview2.exe' $dados
} catch { Diga ('WebView2 falhou: ' + $_) }

try { if ($brave) { TestarNavegador 'Brave' $brave } else { Diga 'Brave nao esta instalado; pulando.' } } catch { Diga ('Brave falhou: ' + $_) }

# ---------- Electron: o motor que iria dentro do .exe do Hub ----------
try {
  $el = Join-Path $tmp 'electron'
  if (-not (Test-Path (Join-Path $el 'electron.exe'))) {
    $rel = Invoke-RestMethod 'https://api.github.com/repos/electron/electron/releases/latest' -Headers @{ 'User-Agent' = 'InkDOSHub-teste' }
    $nomeZip = 'electron-' + $rel.tag_name + '-win32-x64.zip'
    $url = ($rel.assets | Where-Object { $_.name -eq $nomeZip }).browser_download_url
    $shas = ($rel.assets | Where-Object { $_.name -eq 'SHASUMS256.txt' }).browser_download_url
    Diga ('Electron: baixando ' + $rel.tag_name + ' do GitHub oficial (uns 110 MB)')
    $zip = Join-Path $tmp $nomeZip
    Invoke-WebRequest $url -OutFile $zip -UseBasicParsing
    $esperado = ((Invoke-WebRequest $shas -UseBasicParsing).Content -split "`n" | Where-Object { $_ -match [regex]::Escape($nomeZip) } | Select-Object -First 1).Split(' ')[0].ToLower()
    $real = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($esperado -ne $real) { throw 'SHA-256 do Electron nao confere; teste cancelado.' }
    Diga 'Electron: SHA-256 conferido'
    Expand-Archive $zip $el -Force
  }
  $appDir = Join-Path $tmp 'app-electron'
  New-Item -ItemType Directory -Force -Path $appDir | Out-Null
  Set-Content (Join-Path $appDir 'package.json') '{"name":"inkdoshub-teste","main":"main.js"}' -Encoding ASCII
  $lista = ($apps | ForEach-Object { "'" + $site + $_ + "'" }) -join ','
  $main = @"
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('disable-features', 'Translate,MediaRouter,OptimizationHints,AutofillServerCommunication');
app.commandLine.appendSwitch('disable-background-networking');
const apps = [$lista];
function janela(u) { const w = new BrowserWindow({ width: 1100, height: 750, title: 'InkDOS Hub (Electron)', webPreferences: { spellcheck: false } }); w.loadURL(u); }
app.whenReady().then(() => {
  janela('$site');
  setTimeout(() => apps.forEach((u, i) => setTimeout(() => janela(u), i * 2000)), ($aquecer1 + $medir1) * 1000);
});
"@
  Set-Content (Join-Path $appDir 'main.js') $main -Encoding UTF8
  $exeEl = Join-Path $el 'electron.exe'
  Diga 'Electron: abrindo a tela inicial'
  Start-Process $exeEl -ArgumentList ('"' + $appDir + '"')
  Esperar $aquecer1 $false
  Guardar 'Electron' 'Tela inicial' (Medir 'electron.exe' $null $medir1 $false)
  Diga 'Electron: abrindo 7 apps'
  Esperar ($aquecer2 + 14) $false
  Guardar 'Electron' 'Tela inicial + 7 apps' (Medir 'electron.exe' $null $medir2 $false)
  Fechar 'electron.exe' $null
} catch { Diga ('Electron falhou: ' + $_) }

# ---------- relatorio ----------
$pc = Get-CimInstance Win32_Processor | Select-Object -First 1
$ram = [Math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
$so = (Get-CimInstance Win32_OperatingSystem).Caption
$csv = Join-Path $pasta 'relatorio.csv'
$txt = Join-Path $pasta 'relatorio.txt'
$resultados | Export-Csv $csv -NoTypeInformation -Encoding UTF8
$linhas = @(
  'InkDOS Hub - teste de desempenho - ' + (Get-Date).ToString('yyyy-MM-dd HH:mm'),
  'PC: ' + $pc.Name.Trim() + ' | ' + $nucleos + ' nucleos | ' + $ram + ' GB | ' + $so,
  'Apps abertos no cenario 2: ' + ($apps -join ', '),
  '',
  'Memoria privada = media da soma dos processos do motor (o que ele ocupa de fato).',
  'CPU = media no periodo, em % do processador inteiro.',
  ''
)
$linhas += ($resultados | Format-Table -AutoSize | Out-String -Width 200)
$linhas | Set-Content $txt -Encoding UTF8
Write-Host ''
Write-Host ($resultados | Format-Table -AutoSize | Out-String -Width 200)
Diga ('Relatorio: ' + $txt)
Start-Process notepad.exe $txt
Remove-Item -Recurse -Force (Join-Path $tmp 'perfil-*') -ErrorAction SilentlyContinue
