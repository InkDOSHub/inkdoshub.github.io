// AI Chat attachments: turns a file into text for the model, on the device.
// PDF with pdf.js, Word/PowerPoint/Excel/OpenDocument with JSZip (both already in the Hub, InkDOS apps), the rest as text.
const PDFJS = new URL("../../inkdos/apps/pdf/vendor/pdfjs/pdf.min.mjs", import.meta.url).href;
const PDFJS_WORKER = new URL("../../inkdos/apps/pdf/vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
const JSZIP = new URL("../../inkdos/apps/documents/vendor/jszip.min.js", import.meta.url).href;

let zipPronto = null;
function jszip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!zipPronto) zipPronto = new Promise((ok, falha) => {
    const s = document.createElement("script");
    s.src = JSZIP; s.onload = () => ok(window.JSZip); s.onerror = () => falha(new Error("JSZip did not load"));
    document.head.appendChild(s);
  });
  return zipPronto;
}
const xml = (t) => new DOMParser().parseFromString(t, "application/xml");
const textos = (doc, tag) => Array.from(doc.getElementsByTagName(tag)).map((n) => n.textContent);

async function pdf(arq) {
  const lib = await import(PDFJS);
  lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const d = await lib.getDocument({ data: new Uint8Array(await arq.arrayBuffer()), isEvalSupported: false }).promise;
  const partes = [];
  for (let i = 1; i <= d.numPages; i++) {
    const c = await (await d.getPage(i)).getTextContent();
    partes.push("[page " + i + "]\n" + c.items.map((x) => x.str + (x.hasEOL ? "\n" : " ")).join(""));
  }
  return partes.join("\n\n");
}
async function office(arq, ext) {
  const z = await (await jszip()).loadAsync(await arq.arrayBuffer());
  const ler = (n) => (z.file(n) ? z.file(n).async("string") : Promise.resolve(""));
  const ordem = (re) => Object.keys(z.files).filter((n) => re.test(n)).sort((a, b) => +a.match(/(\d+)\.xml$/)[1] - +b.match(/(\d+)\.xml$/)[1]);
  if (ext === "docx") return Array.from(xml(await ler("word/document.xml")).getElementsByTagName("w:p")).map((p) => textos(p, "w:t").join("")).join("\n");
  if (ext === "pptx") {
    const out = [];
    for (const n of ordem(/^ppt\/slides\/slide\d+\.xml$/)) out.push("[slide " + n.match(/(\d+)\.xml$/)[1] + "]\n" + textos(xml(await ler(n)), "a:t").join(" "));
    return out.join("\n\n");
  }
  if (ext === "xlsx") {
    const comp = textos(xml(await ler("xl/sharedStrings.xml")), "si");
    const folhas = Array.from(xml(await ler("xl/workbook.xml")).getElementsByTagName("sheet")).map((s) => s.getAttribute("name"));
    const out = [];
    for (const [k, n] of ordem(/^xl\/worksheets\/sheet\d+\.xml$/).entries()) {
      const linhas = Array.from(xml(await ler(n)).getElementsByTagName("row")).map((r) => Array.from(r.getElementsByTagName("c")).map((c) => {
        const v = c.getElementsByTagName("v")[0], t = c.getAttribute("t");
        if (t === "s" && v) return comp[+v.textContent] || "";
        if (t === "inlineStr") return textos(c, "t").join("");
        return v ? v.textContent : "";
      }).join("\t"));
      out.push("[sheet " + (folhas[k] || k + 1) + "]\n" + linhas.join("\n"));
    }
    return out.join("\n\n");
  }
  // OpenDocument (odt, ods, odp): paragraphs and cells of content.xml
  const d = xml(await ler("content.xml"));
  return Array.from(d.getElementsByTagName("*")).filter((n) => /^text:(p|h)$/.test(n.tagName)).map((n) => n.textContent).join("\n");
}

export const ehImagem = (arq) => /^image\//.test(arq.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(arq.name);

export async function extrair(arq) {
  const ext = (arq.name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return pdf(arq);
  if (/^(docx|pptx|xlsx|odt|ods|odp)$/.test(ext)) return office(arq, ext);
  const t = await arq.text();
  if (/^html?$/.test(ext)) return new DOMParser().parseFromString(t, "text/html").body.innerText;
  if (/\u0000/.test(t.slice(0, 4000))) throw new Error(arq.name + ": this kind of file cannot be read as text");
  return t;
}
