/* Wasm Build: compiles an open-source project to WebAssembly with Emscripten on GitHub Actions,
   in the user's own account. The page talks to the GitHub API with the user's token (kept in
   localStorage), keeps one repository with one workflow there, starts a run with the project's
   link and build commands, follows it and brings the files back (through the Hub's worker,
   because GitHub's artifact and log downloads are redirects without CORS). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var API = "https://api.github.com/";
  var PONTE = "https://inkdoshub-github-io.vfydr2m9wk.workers.dev/net/github/";
  var REPO = "inkdoshub-wasm-build";
  var WF = ".github/workflows/build.yml";
  var token = "", dono = "", parar = false, arquivos = [];

  var WORKFLOW = [
    "# Made by InkDOS Hub (Wasm Build). Started from the Hub; builds a project with Emscripten.",
    "name: Wasm build",
    "run-name: \"Wasm build ${{ inputs.id }}\"",
    "on:",
    "  workflow_dispatch:",
    "    inputs:",
    "      id: {required: true}",
    "      source: {description: Git link, required: true}",
    "      ref: {description: Branch or tag, required: false, default: \"\"}",
    "      commands: {description: Build commands, required: true}",
    "      outputs: {description: Files to keep, required: false, default: \"**/*.wasm\"}",
    "      emsdk: {description: Emscripten version, required: false, default: latest}",
    "permissions: {contents: read}",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 350",
    "    container: emscripten/emsdk:${{ inputs.emsdk }}",
    "    steps:",
    "      - name: Get the source",
    "        env: {SRC: \"${{ inputs.source }}\", REF: \"${{ inputs.ref }}\"}",
    "        run: git clone --depth 1 --recursive ${REF:+--branch \"$REF\"} \"$SRC\" src",
    "      - name: Build",
    "        working-directory: src",
    "        env: {CMDS: \"${{ inputs.commands }}\"}",
    "        run: printf '%s\\n' \"$CMDS\" > /tmp/build.sh && bash -ex /tmp/build.sh",
    "      - name: Collect the files",
    "        working-directory: src",
    "        shell: bash",
    "        env: {PAT: \"${{ inputs.outputs }}\"}",
    "        run: |",
    "          shopt -s globstar nullglob",
    "          mkdir -p /tmp/out",
    "          for f in $PAT; do",
    "            [ -f \"$f\" ] || continue",
    "            mkdir -p \"/tmp/out/$(dirname \"$f\")\"; cp \"$f\" \"/tmp/out/$f\"",
    "            b=\"${f%.*}\"",
    "            for x in \"$b.js\" \"$b.mjs\" \"$b.html\" \"$b.data\" \"$b.worker.js\" \"$b.wasm\"; do [ -f \"$x\" ] && cp \"$x\" \"/tmp/out/$x\"; done",
    "          done",
    "          ls -laR /tmp/out | head -200",
    "          [ -n \"$(ls -A /tmp/out)\" ] || { echo \"No file matched: $PAT\"; exit 1; }",
    "      - uses: actions/upload-artifact@v4",
    "        with: {name: wasm-build, path: /tmp/out, retention-days: 7}",
    ""
  ].join("\n");

  var EXEMPLOS = {
    cmake: "emcmake cmake -B build -DCMAKE_BUILD_TYPE=Release\ncmake --build build -j4",
    make: "emmake make -j4",
    configure: "emconfigure ./configure --disable-shared\nemmake make -j4",
    meson: "pip install meson ninja\nprintf '[binaries]\\nc = \\'emcc\\'\\ncpp = \\'em++\\'\\nar = \\'emar\\'\\n[host_machine]\\nsystem = \\'emscripten\\'\\ncpu_family = \\'wasm32\\'\\ncpu = \\'wasm32\\'\\nendian = \\'little\\'\\n' > /tmp/em.ini\nmeson setup build --cross-file /tmp/em.ini\nninja -C build",
    cc: "emcc -O2 main.c -o main.js"
  };

  function msg(s) { $("msg").textContent = s || ""; }
  function ler(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function gravar(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  var espera = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function tam(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
  function b64(s) { return btoa(unescape(encodeURIComponent(s))); }
  function deB64(s) { return decodeURIComponent(escape(atob(s.replace(/\n/g, "")))); }

  async function gh(metodo, caminho, corpo) {
    var r = await fetch(API + caminho, {
      method: metodo,
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    var d = null;
    try { d = r.status === 204 ? null : await r.json(); } catch (e) {}
    if (!r.ok) { var e = new Error((d && d.message) || ("GitHub " + r.status)); e.status = r.status; throw e; }
    return d;
  }
  async function ponte(caminho) {
    var r = await fetch(PONTE + caminho, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) throw new Error("GitHub " + r.status);
    return r;
  }

  // --- account ---
  async function conectar(t) {
    token = t.trim();
    msg("");
    try {
      var u = await gh("GET", "user");
      dono = u.login;
      gravar("wasm-token", token);
      $("sem-conta").hidden = true; $("com-conta").hidden = false;
      $("quem").textContent = "Connected as " + dono;
      $("ver-repo").href = "https://github.com/" + dono + "/" + REPO;
      var ultima = ler("wasm-ultima"), resultado = ler("wasm-resultado");
      if (ultima) seguir(+ultima);
      else if (resultado) { $("ver-run").href = "https://github.com/" + dono + "/" + REPO + "/actions/runs/" + resultado; trazer(+resultado).catch(function () { gravar("wasm-resultado", ""); $("andamento").hidden = true; }); }
    } catch (e) {
      token = ""; gravar("wasm-token", "");
      $("sem-conta").hidden = false; $("com-conta").hidden = true;
      msg(e.status === 401 ? "This token was not accepted by GitHub." : e.message);
    }
  }
  $("conectar").onclick = function () { if ($("token").value.trim()) conectar($("token").value); };
  $("sair").onclick = function () {
    token = ""; dono = ""; parar = true;
    gravar("wasm-token", ""); gravar("wasm-ultima", ""); gravar("wasm-resultado", "");
    $("token").value = ""; $("sem-conta").hidden = false; $("com-conta").hidden = true; $("andamento").hidden = true;
  };

  // --- project form (remembered) ---
  ["fonte", "ref", "comandos", "saidas", "emsdk"].forEach(function (id) {
    var v = ler("wasm-" + id); if (v) $(id).value = v;
    $(id).addEventListener("change", function () { gravar("wasm-" + id, $(id).value); });
  });
  $("exemplo").onchange = function () {
    var v = EXEMPLOS[$("exemplo").value]; if (!v) return;
    $("comandos").value = v; gravar("wasm-comandos", v);
    if ($("exemplo").value === "cc") { $("saidas").value = "*.wasm"; gravar("wasm-saidas", "*.wasm"); }
    $("exemplo").value = "";
  };

  // --- repository with the workflow ---
  async function prepararRepo() {
    try { await gh("GET", "repos/" + dono + "/" + REPO); }
    catch (e) {
      if (e.status !== 404) throw e;
      await gh("POST", "user/repos", { name: REPO, description: "WebAssembly builds started from InkDOS Hub (Wasm Build).", auto_init: true, private: false });
      await espera(2000);
    }
    var atual = null;
    try { atual = await gh("GET", "repos/" + dono + "/" + REPO + "/contents/" + WF); } catch (e) { if (e.status !== 404) throw e; }
    if (atual && deB64(atual.content) === WORKFLOW) return false;
    await gh("PUT", "repos/" + dono + "/" + REPO + "/contents/" + WF, { message: "Wasm build workflow (InkDOS Hub)", content: b64(WORKFLOW), sha: atual ? atual.sha : undefined });
    return true;
  }

  // --- progress view ---
  function andamento(titulo, texto) {
    $("andamento").hidden = false;
    $("and-titulo").textContent = titulo;
    $("and-texto").textContent = texto || "";
  }
  function passos(lista) {
    var ul = $("passos"); ul.textContent = "";
    lista.forEach(function (p) {
      var li = document.createElement("li"); li.textContent = p.name;
      li.className = p.status === "completed" ? (p.conclusion === "success" || p.conclusion === "skipped" ? "ok" : "erro") : p.status === "in_progress" ? "vai" : "";
      ul.appendChild(li);
    });
  }
  function relogio(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + " min " + (s % 60) + " s"; }

  $("compilar").onclick = async function () {
    msg("");
    if (!token) { msg("Connect your GitHub account first."); return; }
    var fonte = $("fonte").value.trim(), cmds = $("comandos").value.trim();
    // a GitHub page link (release, tag, branch or file) becomes the repository plus that branch or tag
    var m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/(?:releases\/tag|tree|blob|commits?)\/([^\/?#]+)/.exec(fonte);
    if (m) { fonte = "https://github.com/" + m[1]; if (!$("ref").value.trim()) $("ref").value = decodeURIComponent(m[2]); $("fonte").value = fonte; }
    if (!/^https?:\/\/\S+$/.test(fonte)) { msg("Paste the project's git link (https://...)."); return; }
    if (!cmds) { msg("Write the build commands (or choose an example)."); return; }
    ["fonte", "ref", "comandos", "saidas", "emsdk"].forEach(function (id) { gravar("wasm-" + id, $(id).value); });
    $("compilar").disabled = true; parar = true;
    $("resultado").hidden = true; $("log").hidden = true; $("passos").textContent = "";
    $("ver-run").href = "https://github.com/" + dono + "/" + REPO + "/actions";
    try {
      andamento("Preparing", "Setting up the build repository in your account…");
      var novo = await prepararRepo();
      var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      var entradas = { id: id, source: fonte, ref: $("ref").value.trim(), commands: cmds, outputs: $("saidas").value.trim() || "**/*.wasm", emsdk: $("emsdk").value.trim() || "latest" };
      andamento("Starting", "Asking GitHub to start the build…");
      for (var i = 0; ; i++) {
        try { await gh("POST", "repos/" + dono + "/" + REPO + "/actions/workflows/build.yml/dispatches", { ref: "main", inputs: entradas }); break; }
        catch (e) { if (i > (novo ? 8 : 2) || (e.status !== 404 && e.status !== 422)) throw e; await espera(3000); }
      }
      var run = null;
      for (i = 0; i < 30 && !run; i++) {
        await espera(3000);
        var l = await gh("GET", "repos/" + dono + "/" + REPO + "/actions/runs?event=workflow_dispatch&per_page=10");
        run = (l.workflow_runs || []).filter(function (r) { return r.display_title === "Wasm build " + id; })[0];
      }
      if (!run) throw new Error("GitHub did not start the build. Open the repository's Actions tab to check.");
      gravar("wasm-ultima", String(run.id));
      seguir(run.id);
    } catch (e) {
      andamento("Not started", "");
      msg(e.status === 403 || e.status === 404 ? "GitHub refused (" + e.message + "). The token needs the \"repo\" and \"workflow\" permissions." : e.message);
      $("compilar").disabled = false;
    }
  };

  // --- following a run ---
  async function seguir(runId) {
    parar = false;
    var meu = {}; seguir.atual = meu;
    $("compilar").disabled = true;
    $("ver-run").href = "https://github.com/" + dono + "/" + REPO + "/actions/runs/" + runId;
    try {
      for (;;) {
        if (parar || seguir.atual !== meu) return;
        var run = await gh("GET", "repos/" + dono + "/" + REPO + "/actions/runs/" + runId);
        var jobs = await gh("GET", "repos/" + dono + "/" + REPO + "/actions/runs/" + runId + "/jobs");
        var job = (jobs.jobs || [])[0];
        if (job) passos(job.steps || []);
        var desde = (Date.now() - new Date(run.run_started_at || run.created_at).getTime()) / 1000;
        if (run.status !== "completed") {
          andamento(run.status === "queued" ? "Waiting for a GitHub computer" : "Building", relogio(desde) + " · the page can be closed; the build goes on and shows here when you come back");
          await espera(10000);
          continue;
        }
        gravar("wasm-ultima", "");
        $("compilar").disabled = false;
        if (run.conclusion === "success") return trazer(runId);
        andamento("Build failed", "The end of the build log is below.");
        if (job) {
          try {
            var txt = await (await ponte("repos/" + dono + "/" + REPO + "/actions/jobs/" + job.id + "/logs")).text();
            var linhas = txt.split("\n").map(function (s) { return s.replace(/^\S+Z /, ""); });
            $("log").textContent = linhas.slice(-80).join("\n");
            $("log").hidden = false;
          } catch (e) { msg("Could not read the log: " + e.message); }
        }
        return;
      }
    } catch (e) {
      msg(e.message);
      $("compilar").disabled = false;
    }
  }

  // --- Run panel: the program runs in a worker, with a terminal-like output and an input line ---
  var trab = null, prog = null, sab = null, ctl = null, buf = null;
  function escrever(t, erro) {
    var o = $("saida"), sp = document.createElement("span");
    if (erro) sp.className = "e";
    sp.textContent = t; o.appendChild(sp); o.scrollTop = o.scrollHeight;
  }
  function abrirRodar(f) {
    prog = f;
    $("rodar").hidden = false; $("rodar-nome").textContent = f.nome.split("/").pop().replace(/\.js$/, "");
    $("saida").textContent = "";
    $("rodar-nota").textContent = self.crossOriginIsolated ? "" : "Typing into the program needs the Hub's isolated address (" + PONTE.replace("/net/github/", "/apps/wasm/") + "); here the program only shows its output.";
    $("rodar").scrollIntoView({ behavior: "smooth" });
    iniciar();
  }
  function parar() { if (trab) { trab.terminate(); trab = null; escrever("\n[stopped]\n", true); } }
  function iniciar() {
    if (trab) { trab.terminate(); trab = null; }
    $("saida").textContent = "";
    var urls = {};
    arquivos.forEach(function (g) { urls[g.nome.split("/").pop()] = g.url; });
    var args = ($("args").value.match(/"[^"]*"|\S+/g) || []).map(function (a) { return a.replace(/^"|"$/g, ""); });
    sab = self.crossOriginIsolated ? new SharedArrayBuffer(8 + 65536) : null;
    ctl = sab ? new Int32Array(sab, 0, 2) : null; buf = sab ? new Uint8Array(sab, 8) : null;
    trab = new Worker("run-worker.js?v=3");
    trab.onmessage = function (e) {
      var m = e.data;
      if (m.t === "o") escrever(m.s);
      else if (m.t === "e") escrever(m.s, true);
      else if (m.t === "i") $("entrada").focus();
      else if (m.t === "x") { escrever("\n[exited with code " + m.c + "]\n", m.c !== 0); trab.terminate(); trab = null; }
    };
    trab.onerror = function (e) { escrever((e.message || "error") + "\n", true); };
    trab.postMessage({ js: prog.url, nome: prog.nome.split("/").pop(), urls: urls, args: args, sab: sab });
  }
  function enviar(bytes) {
    if (!trab || !ctl) return;
    if (bytes) { buf.set(bytes.subarray(0, buf.length)); Atomics.store(ctl, 1, Math.min(bytes.length, buf.length)); }
    else Atomics.store(ctl, 1, -1);
    Atomics.store(ctl, 0, 1); Atomics.notify(ctl, 0);
  }
  $("form-entrada").onsubmit = function (e) {
    e.preventDefault();
    var t = $("entrada").value; $("entrada").value = "";
    escrever(t + "\n");
    enviar(new TextEncoder().encode(t + "\n"));
  };
  $("entrada").addEventListener("keydown", function (e) { if (e.ctrlKey && e.key === "d") { e.preventDefault(); enviar(null); } });
  $("eof").onclick = function () { enviar(null); };
  $("iniciar").onclick = function () { if (prog) iniciar(); };
  $("parar").onclick = parar;
  $("fechar-rodar").onclick = function () { if (trab) { trab.terminate(); trab = null; } $("rodar").hidden = true; };

  async function trazer(runId) {
    gravar("wasm-resultado", String(runId));
    andamento("Bringing the files back", "");
    var a = await gh("GET", "repos/" + dono + "/" + REPO + "/actions/runs/" + runId + "/artifacts");
    var art = (a.artifacts || [])[0];
    if (!art) { andamento("Build finished", "It made no files to bring back."); return; }
    var blob = await (await ponte("repos/" + dono + "/" + REPO + "/actions/artifacts/" + art.id + "/zip")).blob();
    var zip = await JSZip.loadAsync(blob);
    arquivos.forEach(function (f) { URL.revokeObjectURL(f.url); });
    arquivos = [];
    var nomes = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir; }).sort();
    for (var i = 0; i < nomes.length; i++) {
      var dados = await zip.files[nomes[i]].async("blob");
      var tipo = /\.wasm$/.test(nomes[i]) ? "application/wasm" : /\.m?js$/.test(nomes[i]) ? "text/javascript" : /\.html$/.test(nomes[i]) ? "text/html" : "application/octet-stream";
      arquivos.push({ nome: nomes[i], url: URL.createObjectURL(new Blob([dados], { type: tipo })), tamanho: dados.size });
    }
    var lista = $("arquivos"); lista.textContent = "";
    arquivos.forEach(function (f) {
      var d = document.createElement("div"); d.className = "it";
      var l = document.createElement("a"); l.href = f.url; l.download = f.nome.split("/").pop(); l.textContent = f.nome;
      var s = document.createElement("span"); s.textContent = tam(f.tamanho);
      d.appendChild(l); d.appendChild(s);
      var base = f.nome.replace(/\.js$/, "");
      if (/\.js$/.test(f.nome) && !/\.worker\.js$/.test(f.nome) && arquivos.some(function (g) { return g.nome === base + ".wasm"; })) {
        var b = document.createElement("button"); b.type = "button"; b.className = "ink-btn acao"; b.textContent = "Run";
        b.onclick = function () { abrirRodar(f); };
        d.appendChild(b);
      }
      lista.appendChild(d);
    });
    $("baixar-tudo").onclick = function () {
      var l = document.createElement("a"); l.href = URL.createObjectURL(blob); l.download = "wasm-build.zip"; document.body.appendChild(l); l.click(); l.remove();
    };
    $("resultado").hidden = false;
    andamento("Build finished", nomes.length + " file(s). Tap a name to save it.");
  }

  var salvo = ler("wasm-token");
  if (salvo) conectar(salvo);
})();
