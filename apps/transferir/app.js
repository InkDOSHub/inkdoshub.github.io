/* Transferir pelo roteador, no navegador: WebRTC (canal de dados) entre os dois aparelhos.
   O pareamento usa o servidor público do PeerJS; os arquivos vão direto de um aparelho ao outro. */
(function () {
  var t = window.InkIdioma ? InkIdioma.t : function (s, p) {
    return p ? s.replace(/\{(\w+)\}/g, function (m, k) { return k in p ? p[k] : m; }) : s;
  };
  var $ = function (id) { return document.getElementById(id); };
  var PREFIXO = "inkdoshub-transferir-";
  var PEDACO = 65536;            // tamanho de cada mensagem (seguro no Safari)
  var LIMITE = 8 * 1048576;      // fila máxima no canal antes de esperar
  var peer = null, conn = null;

  function mb(b) { return b >= 1073741824 ? (b / 1073741824).toFixed(2) + " GB" : (b / 1048576).toFixed(1) + " MB"; }
  function vel(b) { return (b / 1048576).toFixed(1) + " MB/s"; }
  function estado(s, erro) { $("estado").textContent = s; $("estado").className = "nota" + (erro ? " erro" : ""); }

  function novoCodigo() {
    var a = "abcdefghjkmnpqrstuvwxyz23456789", c = "";
    for (var i = 0; i < 6; i++) c += a[Math.floor(Math.random() * a.length)];
    return c;
  }

  $("bcriar").onclick = function () {
    var codigo = novoCodigo();
    $("inicio").hidden = true; $("espera").hidden = false;
    $("codigo").textContent = codigo;
    var q = qrcode(0, "M");
    q.addData(location.origin + location.pathname + "?c=" + codigo);
    q.make();
    $("qr").innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    estado(t("Connecting to the pairing server…"));
    peer = new Peer(PREFIXO + codigo, { debug: 0 });
    peer.on("open", function () { estado(t("Waiting for the other device…")); });
    peer.on("connection", function (c) { if (conn) { c.close(); return; } ligar(c); });
    peer.on("error", function (e) { estado(t("Error: {msg}", { msg: e.type || e.message }), true); });
  };

  function entrar(codigo) {
    codigo = (codigo || "").trim().toLowerCase();
    if (codigo.length != 6) { estado(t("Type the 6-character code shown on the other device."), true); return; }
    $("inicio").hidden = true;
    estado(t("Connecting…"));
    peer = new Peer({ debug: 0 });
    peer.on("open", function () { ligar(peer.connect(PREFIXO + codigo, { reliable: true, serialization: "raw" })); });
    peer.on("error", function (e) {
      estado(e.type == "peer-unavailable" ? t("Code not found. Check the code and try again.") : t("Error: {msg}", { msg: e.type || e.message }), true);
      $("inicio").hidden = false;
    });
  }
  $("bentrar").onclick = function () { entrar($("ecodigo").value); };
  $("ecodigo").onkeydown = function (e) { if (e.key == "Enter") entrar(this.value); };
  var pedido = new URLSearchParams(location.search).get("c");
  if (pedido) entrar(pedido);

  // ---------- conexão ----------
  var bytes = 0;                  // contador para a velocidade ao vivo (envio + recebimento)
  function ligar(c) {
    conn = c;
    var aberto = function () {
      $("espera").hidden = true; $("sala").hidden = false;
      estado(t("Connected. The files go directly between the two devices."));
      var dc = conn.dataChannel; dc.binaryType = "arraybuffer"; dc.bufferedAmountLowThreshold = 1048576;
    };
    if (conn.open) aberto(); else conn.on("open", aberto);
    conn.on("data", receber);
    conn.on("close", function () { estado(t("The other device disconnected. Reload the page to connect again."), true); $("sala").hidden = true; });
    conn.on("error", function (e) { estado(t("Error: {msg}", { msg: e.message || e }), true); });
  }

  var vAnt = 0, tAnt = performance.now(), vSuave = 0;
  setInterval(function () {
    var ag = performance.now(), v = (bytes - vAnt) / ((ag - tAnt) / 1000);
    vSuave = vSuave ? vSuave * 0.4 + v * 0.6 : v; vAnt = bytes; tAnt = ag;
    $("vel").textContent = vel(vSuave);
  }, 500);

  function progresso(nome, feito, total, dir) {
    $("atual").textContent = (dir ? "⬆ " : "⬇ ") + nome + " · " + mb(feito) + " / " + mb(total);
    $("prog").style.width = (total ? feito / total * 100 : 0) + "%";
  }

  function linha(nome, info, link) {
    var d = document.createElement("div"); d.className = "item";
    var a = document.createElement(link ? "a" : "span");
    a.textContent = (link ? "⬇ " : "✓ ") + nome;
    if (link) { a.href = link; a.download = nome; }
    var s = document.createElement("span"); s.className = "ok"; s.textContent = info;
    d.appendChild(a); d.appendChild(s);
    $("lista").prepend(d);
  }

  // ---------- recebimento ----------
  var rx = null;
  function receber(d) {
    if (typeof d == "string") {
      var m = JSON.parse(d);
      if (diagMensagem(m)) return;
      if (m.t == "ini") rx = { nome: m.nome, tam: m.tam, tipo: m.tipo, partes: [], feito: 0, t0: performance.now() };
      else if (m.t == "fim" && rx) {
        var s = (performance.now() - rx.t0) / 1000;
        var url = URL.createObjectURL(new Blob(rx.partes, { type: rx.tipo || "application/octet-stream" }));
        linha(rx.nome, mb(rx.tam) + " · " + vel(rx.tam / s), url);
        progresso(rx.nome, rx.tam, rx.tam, false);
        rx = null;
      }
      return;
    }
    if (teste) { teste.feito += d.byteLength; bytes += d.byteLength; return; }
    if (!rx) return;
    rx.partes.push(d); rx.feito += d.byteLength; bytes += d.byteLength;
    progresso(rx.nome, rx.feito, rx.tam, false);
  }

  // ---------- diagnóstico ----------
  var TESTE = 24 * 1048576, teste = null, espera = {}, diagRes = {}, diagRodando = false;
  function nota(v) { var m = v / 1048576; return m >= 25 ? t("Excellent") : m >= 10 ? t("Good") : m >= 3 ? t("Fair") : t("Weak"); }
  function mostrarDiag() {
    var r = diagRes, l = [
      [t("Route"), r.rota], [t("Delay (ping)"), r.ping != null ? r.ping.toFixed(0) + " ms" : null],
      [t("Delay variation"), r.jitter != null ? r.jitter.toFixed(0) + " ms" : null],
      [t("This device → other"), r.sobe != null ? vel(r.sobe) : null], [t("Other → this device"), r.desce != null ? vel(r.desce) : null],
      [t("Quality"), r.sobe != null && r.desce != null ? nota(Math.min(r.sobe, r.desce)) : null]
    ];
    $("diag").innerHTML = "";
    l.forEach(function (x) {
      var tr = document.createElement("tr"), a = document.createElement("td"), b = document.createElement("td");
      a.textContent = x[0]; b.textContent = x[1] == null ? "…" : x[1]; tr.appendChild(a); tr.appendChild(b); $("diag").appendChild(tr);
    });
  }
  function aguardar(tipo) { return new Promise(function (ok) { espera[tipo] = ok; }); }
  function diagMensagem(m) {
    if (m.t == "ping") { conn.send(JSON.stringify({ t: "pong", i: m.i })); return true; }
    if (m.t == "teste-ini") { teste = { feito: 0, tam: m.tam, t0: performance.now() }; return true; }
    if (m.t == "teste-fim") {
      var ms = performance.now() - teste.t0; teste = null;
      conn.send(JSON.stringify({ t: "teste-ok", ms: ms })); return true;
    }
    if (m.t == "teste-pedir") { if (!diagRodando) { diagRes = {}; mostrarDiag(); } enviarTeste().then(function (v) { conn.send(JSON.stringify({ t: "teste-res", v: v })); }); return true; }
    if (m.t == "diag-res") { var r = m.r; diagRes = { rota: r.rota, ping: r.ping, jitter: r.jitter, sobe: r.desce, desce: r.sobe }; mostrarDiag(); return true; }
    if (espera[m.t]) { var f = espera[m.t]; delete espera[m.t]; f(m); return true; }
    return false;
  }
  async function enviarTeste() {
    var dc = conn.dataChannel, pedaco = new Uint8Array(PEDACO);
    for (var i = 0; i < PEDACO; i += 65536) crypto.getRandomValues(pedaco.subarray(i, i + 65536));
    var t0 = performance.now();
    conn.send(JSON.stringify({ t: "teste-ini", tam: TESTE }));
    for (var o = 0; o < TESTE; o += PEDACO) { await esperarFila(dc); dc.send(pedaco.buffer.slice(0)); bytes += PEDACO; }
    conn.send(JSON.stringify({ t: "teste-fim" }));
    await aguardar("teste-ok");
    return TESTE / ((performance.now() - t0) / 1000);
  }
  async function rota() {
    try {
      var pc = conn.peerConnection, st = await pc.getStats(), par = null, loc = {}, rem = {};
      st.forEach(function (r) {
        if (r.type == "candidate-pair" && (r.nominated || r.selected) && r.state == "succeeded") par = r;
        if (r.type == "local-candidate") loc[r.id] = r;
        if (r.type == "remote-candidate") rem[r.id] = r;
      });
      if (!par) return t("Unknown");
      var a = loc[par.localCandidateId] || {}, b = rem[par.remoteCandidateId] || {};
      if (a.candidateType == "relay" || b.candidateType == "relay") return t("Through a relay server (slow)");
      if (a.candidateType == "host" && b.candidateType == "host") return t("Direct, on the local network");
      return t("Direct, through the internet");
    } catch (e) { return t("Unknown"); }
  }
  $("bdiag").onclick = async function () {
    if (diagRodando || !conn || !conn.open || enviando) return;
    diagRodando = true; $("bdiag").disabled = true; diagRes = {}; mostrarDiag();
    try {
      diagRes.rota = await rota(); mostrarDiag();
      var ps = [];
      for (var i = 0; i < 10; i++) {
        var t0 = performance.now(); conn.send(JSON.stringify({ t: "ping", i: i })); await aguardar("pong"); ps.push(performance.now() - t0);
      }
      ps.sort(function (a, b) { return a - b; });
      diagRes.ping = ps[5]; diagRes.jitter = ps[8] - ps[1]; mostrarDiag();
      diagRes.sobe = await enviarTeste(); mostrarDiag();
      conn.send(JSON.stringify({ t: "teste-pedir" }));
      diagRes.desce = (await aguardar("teste-res")).v; mostrarDiag();
      conn.send(JSON.stringify({ t: "diag-res", r: diagRes }));
    } catch (e) { estado(t("Error: {msg}", { msg: e.message || e }), true); }
    diagRodando = false; $("bdiag").disabled = false; proximo();
  };

  // ---------- envio ----------
  var fila = [], enviando = false;
  $("arq").onchange = function () { for (var i = 0; i < this.files.length; i++) fila.push(this.files[i]); this.value = ""; proximo(); };

  function esperarFila(dc) {
    return new Promise(function (ok) {
      if (dc.bufferedAmount < LIMITE) return ok();
      dc.onbufferedamountlow = function () { dc.onbufferedamountlow = null; ok(); };
    });
  }

  async function proximo() {
    if (enviando || diagRodando || !fila.length) return;
    enviando = true;
    var f = fila.shift(), dc = conn.dataChannel, t0 = performance.now();
    try {
      conn.send(JSON.stringify({ t: "ini", nome: f.name, tam: f.size, tipo: f.type }));
      for (var o = 0; o < f.size; o += 4194304) {
        var bloco = await f.slice(o, Math.min(o + 4194304, f.size)).arrayBuffer();
        for (var p = 0; p < bloco.byteLength; p += PEDACO) {
          await esperarFila(dc);
          var pedaco = bloco.slice(p, p + PEDACO);
          dc.send(pedaco); bytes += pedaco.byteLength;
        }
        progresso(f.name, Math.min(o + 4194304, f.size), f.size, true);
      }
      conn.send(JSON.stringify({ t: "fim" }));
      await esperarFila(dc);
      linha(f.name, mb(f.size) + " · " + vel(f.size / ((performance.now() - t0) / 1000)));
    } catch (e) {
      estado(t("Error: {msg}", { msg: e.message || e }), true);
    }
    enviando = false;
    proximo();
  }
})();
