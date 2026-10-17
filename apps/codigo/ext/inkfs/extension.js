// Sistema de arquivos "inkfs" do editor de código do InkTerminal.
// Os arquivos ficam na memória e são gravados no IndexedDB deste navegador,
// então continuam lá na próxima visita. Para trocar arquivos com o iPad use
// "Upload..." e "Download..." no menu do Explorer (botão direito / toque longo).
const vscode = require("vscode");

const DB = "inkterminal-codigo", STORE = "files";
function openDb() {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}

class InkFS {
  constructor(db) {
    this.db = db;
    this.entries = new Map(); // caminho -> { type, data?, ctime, mtime }
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeFile = this._emitter.event;
  }
  async load() {
    await new Promise((ok, fail) => {
      const tx = this.db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return ok();
        this.entries.set(c.key, c.value);
        c.continue();
      };
      req.onerror = () => fail(req.error);
    });
    if (!this.entries.has("/")) {
      const now = Date.now();
      this.entries.set("/", { type: vscode.FileType.Directory, ctime: now, mtime: now });
      this.entries.set("/LEIA-ME.md", {
        type: vscode.FileType.File, ctime: now, mtime: now,
        data: new TextEncoder().encode(
          "# Editor de código do InkTerminal\n\n" +
          "Os arquivos desta pasta ficam guardados neste navegador.\n\n" +
          "- Novo arquivo ou pasta: ícones no topo do Explorer.\n" +
          "- Trazer arquivos do iPad: botão direito (ou toque longo) no Explorer > Upload...\n" +
          "- Levar para o iPad: botão direito no arquivo > Download...\n"),
      });
      this._persist("/"); this._persist("/LEIA-ME.md");
    }
  }
  _persist(path) {
    const tx = this.db.transaction(STORE, "readwrite");
    const e = this.entries.get(path);
    if (e) tx.objectStore(STORE).put(e, path); else tx.objectStore(STORE).delete(path);
  }
  _get(uri) {
    const e = this.entries.get(uri.path || "/");
    if (!e) throw vscode.FileSystemError.FileNotFound(uri);
    return e;
  }
  _parent(path) { const i = path.lastIndexOf("/"); return i <= 0 ? "/" : path.slice(0, i); }
  _touch(path) {
    const e = this.entries.get(path);
    if (e) { e.mtime = Date.now(); this._persist(path); }
  }
  watch() { return new vscode.Disposable(() => {}); }
  stat(uri) {
    const e = this._get(uri);
    return { type: e.type, ctime: e.ctime, mtime: e.mtime, size: e.data ? e.data.byteLength : 0 };
  }
  readDirectory(uri) {
    const dir = uri.path === "/" ? "" : uri.path;
    if (this._get(uri).type !== vscode.FileType.Directory) throw vscode.FileSystemError.FileNotADirectory(uri);
    const out = [];
    for (const [p, e] of this.entries) {
      if (p !== "/" && this._parent(p) === (dir || "/")) out.push([p.slice(dir.length + 1), e.type]);
    }
    return out;
  }
  createDirectory(uri) {
    if (this.entries.has(uri.path)) throw vscode.FileSystemError.FileExists(uri);
    const parent = this._parent(uri.path);
    if (!this.entries.has(parent)) throw vscode.FileSystemError.FileNotFound(uri);
    const now = Date.now();
    this.entries.set(uri.path, { type: vscode.FileType.Directory, ctime: now, mtime: now });
    this._persist(uri.path); this._touch(parent);
    this._emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
  }
  readFile(uri) {
    const e = this._get(uri);
    if (e.type !== vscode.FileType.File) throw vscode.FileSystemError.FileIsADirectory(uri);
    return e.data;
  }
  writeFile(uri, content, opt) {
    const old = this.entries.get(uri.path);
    if (old && old.type === vscode.FileType.Directory) throw vscode.FileSystemError.FileIsADirectory(uri);
    if (!old && !opt.create) throw vscode.FileSystemError.FileNotFound(uri);
    if (old && opt.create && !opt.overwrite) throw vscode.FileSystemError.FileExists(uri);
    const parent = this._parent(uri.path);
    if (!this.entries.has(parent)) throw vscode.FileSystemError.FileNotFound(uri);
    const now = Date.now();
    this.entries.set(uri.path, { type: vscode.FileType.File, ctime: old ? old.ctime : now, mtime: now, data: new Uint8Array(content) });
    this._persist(uri.path);
    if (!old) this._touch(parent);
    this._emitter.fire([{ type: old ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created, uri }]);
  }
  delete(uri, opt) {
    const path = uri.path;
    this._get(uri);
    for (const p of [...this.entries.keys()]) {
      if (p === path || (opt.recursive && p.startsWith(path + "/"))) { this.entries.delete(p); this._persist(p); }
    }
    this._touch(this._parent(path));
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }
  rename(oldUri, newUri, opt) {
    if (!opt.overwrite && this.entries.has(newUri.path)) throw vscode.FileSystemError.FileExists(newUri);
    this._get(oldUri);
    const from = oldUri.path, to = newUri.path;
    for (const p of [...this.entries.keys()]) {
      if (p === from || p.startsWith(from + "/")) {
        const np = to + p.slice(from.length);
        this.entries.set(np, this.entries.get(p)); this.entries.delete(p);
        this._persist(p); this._persist(np);
      }
    }
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri: oldUri }, { type: vscode.FileChangeType.Created, uri: newUri }]);
  }
}

exports.activate = async function (context) {
  const fs = new InkFS(await openDb());
  await fs.load();
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider("inkfs", fs, { isCaseSensitive: true }));
  abrirRecebidos();
};

// Arquivos mandados pela tela inicial do InkTerminal (inicio/lancador.js): já estão na pasta, em
// /Recebidos; o pedido diz quais abrir.
function abrirRecebidos() {
  const r = indexedDB.open("inkterminal-codigo-abrir", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("abrir");
  r.onsuccess = () => {
    const db = r.result, tx = db.transaction("abrir", "readwrite"), st = tx.objectStore("abrir"), get = st.get("pedido");
    get.onsuccess = () => {
      const v = get.result;
      st.delete("pedido");
      if (!v || !Array.isArray(v.caminhos) || Date.now() - (v.at || 0) > 600000) return;
      v.caminhos.forEach((caminho, i) => {
        vscode.commands.executeCommand("vscode.open", vscode.Uri.from({ scheme: "inkfs", path: caminho }), { preview: false, preserveFocus: i > 0 });
      });
    };
    tx.oncomplete = () => db.close();
  };
}
