@echo off
rem InkDOS Hub: teste com arquivos reais (simples, medio e complexo) em cada motor (Edge, WebView2, Brave e Electron).
rem Baixa os arquivos da release "arquivos-teste" para Downloads\InkDOSHub-arquivos-teste, abre cada um no app dele
rem e mede o tempo para abrir, a memoria, a CPU e o tempo para fechar. Relatorio na Area de Trabalho.
rem O codigo depois da marca PS (mais abaixo) e PowerShell; este .bat so o executa.
title InkDOS Hub - teste com arquivos
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = Get-Content -LiteralPath '%~f0' -Raw -Encoding UTF8; iex ($t.Substring($t.IndexOf('#PS' + '#') + 4))"
echo.
pause
exit /b
#PS#
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Windows.Forms

$site = 'https://inkdoshub.github.io/'
$release = 'https://github.com/InkDOSHub/inkdoshub.github.io/releases/download/arquivos-teste/'
# app de cada tipo de arquivo (o mesmo endereco da versao web)
$apps = [ordered]@{
  pdf  = 'inkdos/apps/pdf/index.html?suite=1'
  docx = 'inkdos/apps/documents/index.html?suite=1'
  xlsx = 'inkdos/apps/spreadsheets/index.html?suite=1'
  pptx = 'inkdos/apps/presentations/index.html?suite=1'
  txt  = 'inkdos/apps/txt/index.html?suite=1'
  epub = 'inkdos/apps/epub/index.html?suite=1'
  jpg  = 'apps/foto/'
  mp4  = 'apps/video/'
  mp3  = 'apps/musica/'
}
$nomeApp = @{ pdf = 'PDF'; docx = 'Documentos'; xlsx = 'Planilhas'; pptx = 'Apresentacoes'; txt = 'Texto'; epub = 'EPUB'; jpg = 'Foto'; mp4 = 'Video'; mp3 = 'Musica' }
$mime = @{ jpg = 'image/jpeg'; mp4 = 'video/mp4'; mp3 = 'audio/mpeg'; pdf = 'application/pdf' }
$ordemNivel = @{ simples = 1; medio = 2; complexo = 3 }

$downloads = $null
try { $downloads = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path } catch {}
if (-not $downloads) { $downloads = Join-Path $env:USERPROFILE 'Downloads' }
$baixar = Join-Path $downloads 'InkDOSHub-arquivos-teste'
$pasta = Join-Path ([Environment]::GetFolderPath('Desktop')) 'InkDOSHub-teste'
$tmp = Join-Path $env:TEMP 'InkDOSHub-teste'
New-Item -ItemType Directory -Force -Path $baixar, $pasta, $tmp | Out-Null
$nucleos = [Environment]::ProcessorCount
$resultados = @()
$primeira = @()

function Diga($s) { Write-Host ((Get-Date).ToString('HH:mm:ss') + '  ' + $s) }

function Esperar($seg) {
  $fim = (Get-Date).AddSeconds($seg)
  while ((Get-Date) -lt $fim) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 30 }
}

function Baixar($url, $destino) { Invoke-WebRequest $url -OutFile $destino -UseBasicParsing }

# ---------- 1. arquivos de teste em Downloads (so baixa o que falta ou mudou; confere o SHA-256) ----------
Write-Host ''
Write-Host 'InkDOS Hub: teste com arquivos reais'
Write-Host ('Arquivos em: ' + $baixar)
Write-Host ''
$listaTxt = Join-Path $baixar 'lista.txt'
Baixar ($release + 'lista.txt') $listaTxt
$arquivos = @()
foreach ($l in (Get-Content $listaTxt)) {
  $c = $l.Trim() -split '\s+'
  if ($c.Count -lt 3) { continue }
  $nivel = $c[0]; $sha = $c[1].ToLower(); $nome = $c[2]
  $ext = [IO.Path]::GetExtension($nome).TrimStart('.').ToLower()
  $dir = Join-Path $baixar $nivel
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $destino = Join-Path $dir $nome
  if (-not (Test-Path $destino) -or (Get-FileHash $destino -Algorithm SHA256).Hash.ToLower() -ne $sha) {
    Diga ('baixando ' + $nivel + '\' + $nome)
    Baixar ($release + $nome) $destino
    if ((Get-FileHash $destino -Algorithm SHA256).Hash.ToLower() -ne $sha) { throw ('SHA-256 nao confere: ' + $nome) }
  }
  if ($apps.Contains($ext)) {
    $arquivos += [pscustomobject]@{ Nivel = $nivel; Nome = $nome; Ext = $ext; Caminho = $destino; MB = [Math]::Round((Get-Item $destino).Length / 1MB, 1) }
  }
}
$arquivos = @($arquivos | Sort-Object @{ e = { [array]::IndexOf(@($apps.Keys), $_.Ext) } }, @{ e = { $ordemNivel[$_.Nivel] } })
Diga ('' + $arquivos.Count + ' arquivos prontos e conferidos')

Write-Host ''
Write-Host 'Motores: Enter = todos (Edge, WebView2, Brave, Electron). Ou digite so os que quer, ex.: webview2 electron'
$escolha = (Read-Host 'Motores').ToLower()
function Quero($m) { (-not $escolha.Trim()) -or $escolha.Contains($m.ToLower()) }
Write-Host 'Nao use o PC durante o teste (uns 10 minutos por motor). As janelas abrem e fecham sozinhas.'
Write-Host ''

# ---------- processos e memoria ----------
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
function Memoria($ps) { $s = ($ps | Measure-Object PrivateMemorySize64 -Sum).Sum; if (-not $s) { 0 } else { $s } }
function TemposCpu($ps) { $d = @{}; foreach ($p in $ps) { try { $d[$p.Id] = $p.TotalProcessorTime.TotalSeconds } catch {} }; $d }
function CpuEntre($antes, $ps, $seg) {
  $uso = 0
  foreach ($p in $ps) { try { $a = 0; if ($antes.ContainsKey($p.Id)) { $a = $antes[$p.Id] }; $uso += [Math]::Max(0, $p.TotalProcessorTime.TotalSeconds - $a) } catch {} }
  if ($seg -le 0) { return 0 }
  [Math]::Round(100 * $uso / ($seg * $nucleos), 1)
}
function Fechar($exe, $marca) { Processos $exe $marca | ForEach-Object { try { $_.Kill() } catch {} }; Start-Sleep -Seconds 3 }

# ---------- DevTools (CDP): o mesmo protocolo nos 4 motores, para entregar o arquivo ao app ----------
function Aguardar($tarefa, $seg) {
  $fim = (Get-Date).AddSeconds($seg)
  while (-not $tarefa.IsCompleted) {
    if ((Get-Date) -gt $fim) { throw 'tempo esgotado' }
    [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 10
  }
  if ($tarefa.IsFaulted) { throw $tarefa.Exception.InnerException }
  $tarefa
}
function Conectar($url) {
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  Aguardar ($ws.ConnectAsync([Uri]$url, [Threading.CancellationToken]::None)) 30 | Out-Null
  $ws
}
$script:cdpId = 0
function Cdp($ws, $metodo, $params, $seg = 120) {
  $script:cdpId++; $id = $script:cdpId
  if (-not $params) { $params = @{} }
  $json = @{ id = $id; method = $metodo; params = $params } | ConvertTo-Json -Depth 10 -Compress
  $b = [Text.Encoding]::UTF8.GetBytes($json)
  Aguardar ($ws.SendAsync([ArraySegment[byte]]::new($b), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None)) 30 | Out-Null
  $fim = (Get-Date).AddSeconds($seg)
  $buf = New-Object byte[] 65536
  while ($true) {
    $ms = New-Object IO.MemoryStream
    do {
      $resto = [Math]::Max(1, ($fim - (Get-Date)).TotalSeconds)
      $r = (Aguardar ($ws.ReceiveAsync([ArraySegment[byte]]::new($buf), [Threading.CancellationToken]::None)) $resto).Result
      $ms.Write($buf, 0, $r.Count)
    } while (-not $r.EndOfMessage)
    $msg = [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
    if ($msg.id -eq $id) {
      if ($msg.error) { throw ($metodo + ': ' + $msg.error.message) }
      return $msg.result
    }
  }
}
function Js($ws, $expr, $seg = 120) {
  $r = Cdp $ws 'Runtime.evaluate' @{ expression = $expr; awaitPromise = $true; returnByValue = $true } $seg
  if ($r.exceptionDetails) { throw ('JS: ' + $r.exceptionDetails.text + ' ' + $r.exceptionDetails.exception.description) }
  $r.result.value
}
# o campo de arquivo do app que aceita este tipo
function Achar($ext) {
  $m = ''; if ($mime.ContainsKey($ext)) { $m = $mime[$ext] }
  "(function(x,m){for(const i of document.querySelectorAll('input[type=file]')){const a=(i.accept||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);if(!a.length||a.some(t=>t==='.'+x||t===m||(m&&t.endsWith('/*')&&m.startsWith(t.slice(0,-1)))))return i}return null})('$ext','$m')"
}
# espera a pagina sossegar: 1,5 s sem mudar a tela e sem tarefa longa (maximo 60 s)
$sossegar = "new Promise(r=>{let u=performance.now();const t0=u;const mo=new MutationObserver(()=>{u=performance.now()});mo.observe(document,{subtree:true,childList:true,characterData:true});let po=null;try{po=new PerformanceObserver(l=>{for(const e of l.getEntries())u=Math.max(u,e.startTime+e.duration)});po.observe({entryTypes:['longtask']})}catch(e){}const iv=setInterval(()=>{const n=performance.now();if(n-u>1500||n-t0>60000){clearInterval(iv);mo.disconnect();if(po)po.disconnect();r(true)}},100)})"
# marca o instante em que o arquivo e entregue e passa a anotar a ultima atividade da pagina
$marcar = "(()=>{window.__inkT0=performance.now();window.__inkUlt=window.__inkT0;new MutationObserver(()=>{window.__inkUlt=performance.now()}).observe(document,{subtree:true,childList:true,characterData:true});try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__inkUlt=Math.max(window.__inkUlt,e.startTime+e.duration)}).observe({entryTypes:['longtask']})}catch(e){}return true})()"
$estado = '[performance.now()-window.__inkUlt, window.__inkUlt-window.__inkT0, performance.now()-window.__inkT0]'

# ---------- janelas: abrir e fechar um app em cada motor ----------
function Alvo($m, $url, $seg = 30) {
  $base = $url.Split('?')[0]
  $fim = (Get-Date).AddSeconds($seg)
  while ((Get-Date) -lt $fim) {
    try {
      $t = @(Invoke-RestMethod ($m.Cdp + '/json/list') -UseBasicParsing) | Where-Object { $_.type -eq 'page' -and $_.url -and $_.url.StartsWith($base) } | Select-Object -First 1
      if ($t) { return $t }
    } catch {}
    Esperar 0.3
  }
  throw 'a janela do app nao apareceu'
}
function AbrirJanela($m, $url) {
  if ($m.Tipo -eq 'navegador') {
    try { $t = Invoke-RestMethod -Method Put ($m.Cdp + '/json/new?' + $url) -UseBasicParsing } catch { $t = Invoke-RestMethod ($m.Cdp + '/json/new?' + $url) -UseBasicParsing }
    return [pscustomobject]@{ Id = $t.id; Ws = $t.webSocketDebuggerUrl; Form = $null }
  }
  if ($m.Tipo -eq 'webview2') {
    $f = JanelaWebView $url
    $t = Alvo $m $url
    return [pscustomobject]@{ Id = $t.id; Ws = $t.webSocketDebuggerUrl; Form = $f }
  }
  $wid = (Invoke-WebRequest ('http://127.0.0.1:9225/abrir?u=' + [Uri]::EscapeDataString($url)) -UseBasicParsing).Content
  $t = Alvo $m $url
  [pscustomobject]@{ Id = "$wid".Trim(); Ws = $t.webSocketDebuggerUrl; Form = $null }
}
function FecharJanela($m, $j) {
  try {
    if ($m.Tipo -eq 'navegador') { Invoke-WebRequest ($m.Cdp + '/json/close/' + $j.Id) -UseBasicParsing | Out-Null }
    elseif ($m.Tipo -eq 'webview2') { $j.Form.Close(); $j.Form.Dispose() }
    else { Invoke-WebRequest ('http://127.0.0.1:9225/fechar?id=' + $j.Id) -UseBasicParsing | Out-Null }
  } catch {}
}

# ---------- o teste de um arquivo ----------
function TestarArquivo($m, $a) {
  $url = $site + $apps[$a.Ext]
  $achar = Achar $a.Ext
  $obs = ''; $tApp = $null; $tArq = $null; $memMB = $null; $picoMB = $null; $cpu = $null
  $psAntes = Processos $m.Exe $m.Marca
  $nAntes = $psAntes.Count; $memAntes = Memoria $psAntes
  $t0 = Get-Date
  $j = $null; $ws = $null
  try {
    $j = AbrirJanela $m $url
    $ws = Conectar $j.Ws
    $pronto = Js $ws ("new Promise(r=>{const t0=Date.now();(function f(){if(document.readyState==='complete'&&" + $achar + ")r(true);else if(Date.now()-t0>60000)r(false);else setTimeout(f,200)})()})") 70
    if (-not $pronto) { throw 'o app nao ficou pronto em 60 s' }
    Js $ws $sossegar 70 | Out-Null
    $tApp = [Math]::Round(((Get-Date) - $t0).TotalSeconds - 1.5, 1)
    Esperar 2
    $ps = Processos $m.Exe $m.Marca
    $pico = Memoria $ps; $cpu0 = TemposCpu $ps
    Js $ws $marcar | Out-Null
    Cdp $ws 'DOM.getDocument' @{ depth = 0 } | Out-Null
    $o = Cdp $ws 'Runtime.evaluate' @{ expression = $achar; returnByValue = $false }
    if (-not $o.result.objectId) { throw 'o app nao tem campo para este arquivo' }
    $tA = Get-Date
    Cdp $ws 'DOM.setFileInputFiles' @{ files = @($a.Caminho); objectId = $o.result.objectId } | Out-Null
    do {
      Esperar 0.25
      $s = Js $ws $estado 30
      $ps = Processos $m.Exe $m.Marca
      $mem = Memoria $ps; if ($mem -gt $pico) { $pico = $mem }
    } while ($s[0] -lt 2000 -and $s[2] -lt 120000)
    $tArq = [Math]::Round($s[1] / 1000, 2)
    if ($s[2] -ge 120000) { $obs = 'nao sossegou em 120 s' }
    $cpu = CpuEntre $cpu0 $ps ((Get-Date) - $tA).TotalSeconds
    $memMB = [Math]::Round(($mem - $memAntes) / 1MB)
    $picoMB = [Math]::Round(($pico - $memAntes) / 1MB)
  } catch { $obs = 'falhou: ' + $_.Exception.Message }
  finally { if ($ws) { try { $ws.Dispose() } catch {} }; if ($j) { FecharJanela $m $j } }
  # fechar: tempo ate os processos do app sumirem (volta ao numero de antes; maximo 15 s)
  $tf = Get-Date
  do { Esperar 0.25; $n = (Processos $m.Exe $m.Marca).Count } while ($n -gt $nAntes -and ((Get-Date) - $tf).TotalSeconds -lt 15)
  $tFechar = [Math]::Round(((Get-Date) - $tf).TotalSeconds, 1)
  $r = [pscustomobject]@{ Motor = $m.Nome; App = $nomeApp[$a.Ext]; Nivel = $a.Nivel; Arquivo = $a.Nome; MB = $a.MB; AbrirAppS = $tApp; AbrirArquivoS = $tArq; MemoriaMB = $memMB; PicoMB = $picoMB; CPU = $cpu; FecharS = $tFechar; Obs = $obs }
  $script:resultados += $r
  Diga ('   ' + $r.App + ' ' + $r.Nivel + ': arquivo em ' + $r.AbrirArquivoS + ' s, +' + $r.MemoriaMB + ' MB (pico +' + $r.PicoMB + '), CPU ' + $r.CPU + ' %, fechou em ' + $r.FecharS + ' s ' + $r.Obs)
}

function TestarTudo($m) {
  # 1a abertura de cada app: o motor ainda baixa o app do site (perfil novo). Fica anotada a parte e nao entra na media.
  Diga ($m.Nome + ': primeira abertura de cada app (baixando do site)')
  foreach ($e in $apps.Keys) {
    $t0 = Get-Date; $j = $null; $ws = $null; $tp = $null
    try {
      $j = AbrirJanela $m ($site + $apps[$e]); $ws = Conectar $j.Ws
      Js $ws ("new Promise(r=>{const t0=Date.now();(function f(){if(document.readyState==='complete'&&" + (Achar $e) + ")r(true);else if(Date.now()-t0>60000)r(false);else setTimeout(f,200)})()})") 70 | Out-Null
      Js $ws $sossegar 70 | Out-Null
      $tp = [Math]::Round(((Get-Date) - $t0).TotalSeconds - 1.5, 1)
    } catch {} finally { if ($ws) { try { $ws.Dispose() } catch {} }; if ($j) { FecharJanela $m $j } }
    $script:primeira += [pscustomobject]@{ Motor = $m.Nome; App = $nomeApp[$e]; PrimeiraAberturaS = $tp }
    Esperar 2
  }
  Diga ($m.Nome + ': ' + $arquivos.Count + ' arquivos (apps ja em cache)')
  foreach ($a in $arquivos) { TestarArquivo $m $a; Esperar 1 }
}

function EsperarCdp($cdp, $seg = 60) {
  $fim = (Get-Date).AddSeconds($seg)
  while ((Get-Date) -lt $fim) { try { Invoke-RestMethod ($cdp + '/json/version') -UseBasicParsing | Out-Null; return } catch { Esperar 0.5 } }
  throw 'o motor nao respondeu'
}

# ---------- Edge e Brave: perfil novo e vazio, so para o teste ----------
function TestarNavegador($nome, $caminho) {
  $exe = Split-Path $caminho -Leaf
  $perfil = Join-Path $tmp ('perfil-' + $nome)
  Remove-Item -Recurse -Force $perfil -ErrorAction SilentlyContinue
  Start-Process $caminho -ArgumentList @('--user-data-dir="' + $perfil + '"', '--no-first-run', '--no-default-browser-check', '--disable-sync', '--remote-debugging-port=9222', '--new-window', 'about:blank')
  $m = [pscustomobject]@{ Nome = $nome; Tipo = 'navegador'; Exe = $exe; Marca = $perfil; Cdp = 'http://127.0.0.1:9222' }
  EsperarCdp $m.Cdp
  Esperar 5
  TestarTudo $m
  Fechar $exe $perfil
}

$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$brave = @("$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe", "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe", "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1

if (Quero 'edge') { try { if ($edge) { TestarNavegador 'Edge' $edge } else { Diga 'Edge nao encontrado; pulando.' } } catch { Diga ('Edge falhou: ' + $_) } }

# ---------- WebView2: o motor do Edge embutido num app, como o .exe do Hub seria ----------
if (Quero 'webview2') {
  try {
    $wv = Join-Path $tmp 'webview2'
    if (-not (Test-Path (Join-Path $wv 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'))) {
      Diga 'WebView2: baixando o componente oficial (NuGet, Microsoft)'
      Baixar 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2' (Join-Path $tmp 'webview2.zip')
      Remove-Item -Recurse -Force $wv -ErrorAction SilentlyContinue
      Expand-Archive (Join-Path $tmp 'webview2.zip') $wv -Force
    }
    Copy-Item (Join-Path $wv 'runtimes\win-x64\native\WebView2Loader.dll') (Join-Path $wv 'lib\net462\') -Force
    Add-Type -Path (Join-Path $wv 'lib\net462\Microsoft.Web.WebView2.Core.dll')
    Add-Type -Path (Join-Path $wv 'lib\net462\Microsoft.Web.WebView2.WinForms.dll')
    $env:PATH = (Join-Path $wv 'lib\net462') + ';' + $env:PATH
    $dados = Join-Path $tmp 'perfil-WebView2'
    Remove-Item -Recurse -Force $dados -ErrorAction SilentlyContinue
    $opcoes = New-Object Microsoft.Web.WebView2.Core.CoreWebView2EnvironmentOptions
    $opcoes.AdditionalBrowserArguments = '--remote-debugging-port=9223'
    $ambiente = (Aguardar ([Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($null, $dados, $opcoes)) 60).Result
    function JanelaWebView($url) {
      $f = New-Object System.Windows.Forms.Form
      $f.Width = 1100; $f.Height = 750; $f.Text = 'InkDOS Hub (WebView2)'
      $w = New-Object Microsoft.Web.WebView2.WinForms.WebView2
      $w.Dock = 'Fill'
      $f.Controls.Add($w)
      $f.Show()
      Aguardar ($w.EnsureCoreWebView2Async($ambiente)) 60 | Out-Null
      $w.CoreWebView2.Navigate($url)
      $f
    }
    # uma janela vazia fica aberta o tempo todo, como a tela do Hub
    $fundo = JanelaWebView 'about:blank'
    $m = [pscustomobject]@{ Nome = 'WebView2'; Tipo = 'webview2'; Exe = 'msedgewebview2.exe'; Marca = $dados; Cdp = 'http://127.0.0.1:9223' }
    EsperarCdp $m.Cdp
    TestarTudo $m
    $fundo.Close(); $fundo.Dispose()
    Esperar 3
    Fechar 'msedgewebview2.exe' $dados
  } catch { Diga ('WebView2 falhou: ' + $_) }
}

if (Quero 'brave') { try { if ($brave) { TestarNavegador 'Brave' $brave } else { Diga 'Brave nao esta instalado; pulando.' } } catch { Diga ('Brave falhou: ' + $_) } }

# ---------- Electron: o motor que iria dentro do .exe do Hub ----------
if (Quero 'electron') {
  try {
    $el = Join-Path $tmp 'electron'
    if (-not (Test-Path (Join-Path $el 'electron.exe'))) {
      # a versao estavel mais nova que ja tem o pacote do Windows publicado
      $rels = Invoke-RestMethod 'https://api.github.com/repos/electron/electron/releases?per_page=20' -Headers @{ 'User-Agent' = 'InkDOSHub-teste' }
      $url = $null
      foreach ($r in $rels) {
        if ($r.prerelease -or $r.draft) { continue }
        $nomeZip = 'electron-' + $r.tag_name + '-win32-x64.zip'
        $z = $r.assets | Where-Object { $_.name -eq $nomeZip }
        $s = $r.assets | Where-Object { $_.name -eq 'SHASUMS256.txt' }
        if ($z -and $s) { $url = $z.browser_download_url; $shas = $s.browser_download_url; $versao = $r.tag_name; break }
      }
      if (-not $url) { throw 'nenhuma versao do Electron encontrada' }
      Diga ('Electron: baixando ' + $versao + ' do GitHub oficial (uns 110 MB)')
      $zip = Join-Path $tmp $nomeZip
      Baixar $url $zip
      $shaTxt = Join-Path $tmp 'electron-SHASUMS256.txt'
      Baixar $shas $shaTxt
      $esperado = ((Get-Content $shaTxt | Where-Object { $_ -match [regex]::Escape($nomeZip) } | Select-Object -First 1) -split '\s+')[0].ToLower()
      $real = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
      if ($esperado -ne $real) { throw 'SHA-256 do Electron nao confere; teste cancelado.' }
      Diga 'Electron: SHA-256 conferido'
      Remove-Item -Recurse -Force $el -ErrorAction SilentlyContinue
      Expand-Archive $zip $el -Force
    }
    $appDir = Join-Path $tmp 'app-electron-arquivos'
    New-Item -ItemType Directory -Force -Path $appDir | Out-Null
    Set-Content (Join-Path $appDir 'package.json') '{"name":"inkdoshub-teste-arquivos","main":"main.js"}' -Encoding ASCII
    $main = @'
const { app, BrowserWindow } = require('electron');
const http = require('http');
app.commandLine.appendSwitch('remote-debugging-port', '9224');
app.commandLine.appendSwitch('disable-features', 'Translate,MediaRouter,OptimizationHints,AutofillServerCommunication');
app.commandLine.appendSwitch('disable-background-networking');
app.on('window-all-closed', () => {});
app.whenReady().then(() => {
  const fundo = new BrowserWindow({ width: 600, height: 400, title: 'InkDOS Hub (Electron)' });
  fundo.loadURL('about:blank');
  http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x');
    s.setHeader('Content-Type', 'text/plain');
    if (u.pathname === '/abrir') {
      const w = new BrowserWindow({ width: 1100, height: 750, title: 'InkDOS Hub (Electron)', webPreferences: { spellcheck: false } });
      w.loadURL(u.searchParams.get('u'));
      s.end(String(w.id));
    } else if (u.pathname === '/fechar') {
      const w = BrowserWindow.fromId(Number(u.searchParams.get('id')));
      if (w) w.destroy();
      s.end('ok');
    } else s.end('?');
  }).listen(9225, '127.0.0.1');
});
'@
    Set-Content (Join-Path $appDir 'main.js') $main -Encoding UTF8
    Diga 'Electron: abrindo'
    Start-Process (Join-Path $el 'electron.exe') -ArgumentList ('"' + $appDir + '"')
    $m = [pscustomobject]@{ Nome = 'Electron'; Tipo = 'electron'; Exe = 'electron.exe'; Marca = $null; Cdp = 'http://127.0.0.1:9224' }
    EsperarCdp $m.Cdp
    Esperar 5
    TestarTudo $m
    Fechar 'electron.exe' $null
  } catch { Diga ('Electron falhou: ' + $_) }
}

# ---------- relatorio ----------
$pc = Get-CimInstance Win32_Processor | Select-Object -First 1
$ram = [Math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
$so = (Get-CimInstance Win32_OperatingSystem).Caption
$csv = Join-Path $pasta 'relatorio-arquivos.csv'
$txt = Join-Path $pasta 'relatorio-arquivos.txt'
$resultados | Export-Csv $csv -NoTypeInformation -Encoding UTF8
$resumo = $resultados | Where-Object { $_.AbrirArquivoS -ne $null } | Group-Object Motor, Nivel | ForEach-Object {
  [pscustomobject]@{
    Motor = $_.Group[0].Motor; Nivel = $_.Group[0].Nivel; Arquivos = $_.Count
    AbrirArquivoS = [Math]::Round(($_.Group | Measure-Object AbrirArquivoS -Average).Average, 2)
    MemoriaMB = [Math]::Round(($_.Group | Measure-Object MemoriaMB -Average).Average)
    PicoMB = [Math]::Round(($_.Group | Measure-Object PicoMB -Average).Average)
    CPU = [Math]::Round(($_.Group | Measure-Object CPU -Average).Average, 1)
  }
}
$linhas = @(
  'InkDOS Hub - teste com arquivos - ' + (Get-Date).ToString('yyyy-MM-dd HH:mm'),
  'PC: ' + $pc.Name.Trim() + ' | ' + $nucleos + ' nucleos | ' + $ram + ' GB | ' + $so,
  'Arquivos: ' + $baixar,
  '',
  'AbrirAppS = tempo para o app ficar pronto (ja em cache). AbrirArquivoS = da entrega do arquivo ate a tela parar de mudar.',
  'MemoriaMB e PicoMB = memoria privada do motor a mais do que antes de abrir o app. CPU = media enquanto abria o arquivo.',
  'FecharS = tempo para os processos do app sumirem depois de fechar a janela.',
  '',
  'RESUMO (media por motor e nivel)'
)
$linhas += ($resumo | Format-Table -AutoSize | Out-String -Width 200)
$linhas += 'PRIMEIRA ABERTURA DE CADA APP (o motor ainda baixa o app do site; nao entra nas medias)'
$linhas += ($primeira | Format-Table -AutoSize | Out-String -Width 200)
$linhas += 'DETALHE'
$linhas += ($resultados | Format-Table Motor, App, Nivel, MB, AbrirAppS, AbrirArquivoS, MemoriaMB, PicoMB, CPU, FecharS, Obs -AutoSize | Out-String -Width 250)
$linhas | Set-Content $txt -Encoding UTF8
Write-Host ''
Write-Host ($resumo | Format-Table -AutoSize | Out-String -Width 200)
Diga ('Relatorio: ' + $txt)
Start-Process notepad.exe $txt
Remove-Item -Recurse -Force (Join-Path $tmp 'perfil-*') -ErrorAction SilentlyContinue
