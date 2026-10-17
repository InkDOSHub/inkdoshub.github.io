/* Roda dentro do worker do LibreOffice (zetajs/UNO). Recebe pedidos da página (index.html):
   novo documento, abrir arquivo, salvar e exportar PDF. Baseado no exemplo web-office do zetajs (MIT). */
"use strict";

let zetajs, css, context, desktop, xModel, caminhoAtual;

const FABRICAS = { texto: "private:factory/swriter", planilha: "private:factory/scalc", apresentacao: "private:factory/simpress", desenho: "private:factory/sdraw" };
const FILTROS_PDF = { texto: "writer_pdf_Export", planilha: "calc_pdf_Export", apresentacao: "impress_pdf_Export", desenho: "draw_pdf_Export" };

function prop(nome, valor) { return new css.beans.PropertyValue({ Name: nome, Value: valor }); }

function tipoDoModelo() {
  if (!xModel) return "texto";
  const s = (n) => { try { return xModel.supportsService(n); } catch (_) { return false; } };
  if (s("com.sun.star.sheet.SpreadsheetDocument")) return "planilha";
  if (s("com.sun.star.presentation.PresentationDocument")) return "apresentacao";
  if (s("com.sun.star.drawing.DrawingDocument")) return "desenho";
  return "texto";
}

function mostrar(modelo) {
  if (xModel && xModel !== modelo) { try { xModel.close(true); } catch (_) {} }
  xModel = modelo;
  try { xModel.getCurrentController().getFrame().getContainerWindow().FullScreen = true; } catch (_) {}
  zetajs.mainPort.postMessage({ cmd: "pronto", tipo: tipoDoModelo() });
}

function iniciar() {
  context = zetajs.getUnoComponentContext();
  desktop = css.frame.Desktop.create(context);
  zetajs.mainPort.onmessage = function (e) {
    const d = e.data;
    try {
      if (d.cmd === "novo") {
        caminhoAtual = null;
        mostrar(desktop.loadComponentFromURL(FABRICAS[d.tipo] || FABRICAS.texto, "_default", 0, []));
      } else if (d.cmd === "abrir") {
        caminhoAtual = "file:///tmp/office/" + d.nome;
        mostrar(desktop.loadComponentFromURL(caminhoAtual, "_default", 0, []));
      } else if (d.cmd === "salvar") {
        // grava no mesmo formato do arquivo aberto; documento novo vira ODF (writer8/calc8/impress8)
        const destino = "file:///tmp/office/" + d.nome;
        const filtro = d.filtro ? [prop("FilterName", d.filtro)] : [];
        xModel.storeToURL(destino, [prop("Overwrite", true)].concat(filtro));
        zetajs.mainPort.postMessage({ cmd: "salvo", nome: d.nome, id: d.id });
      } else if (d.cmd === "pdf") {
        xModel.storeToURL("file:///tmp/office/" + d.nome, [prop("Overwrite", true), prop("FilterName", FILTROS_PDF[tipoDoModelo()])]);
        zetajs.mainPort.postMessage({ cmd: "salvo", nome: d.nome, id: d.id });
      }
    } catch (erro) {
      zetajs.mainPort.postMessage({ cmd: "erro", id: d.id, texto: String(erro && erro.message || erro) });
    }
  };
  zetajs.mainPort.postMessage({ cmd: "iniciado" });
}

Module.zetajs.then(function (z) {
  zetajs = z;
  css = zetajs.uno.com.sun.star;
  iniciar();
});
