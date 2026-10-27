// Tira o som (AAC) de um vídeo MP4/MOV sem converter nada: lê só os pedaços de áudio do arquivo
// e monta um .m4a com eles. Rápido e leve; o vídeo nunca é carregado inteiro na memória.
// inkExtrairM4a(arquivo, aoAvancar(parte 0..1)) -> Promise<Blob audio/mp4>; rejeita se o formato não servir
// (aí a página usa o ffmpeg).
(function () {
  var CAIXAS = { moov: 1, trak: 1, mdia: 1, minf: 1, stbl: 1, edts: 1 };
  function u32(d, i) { return ((d[i] << 24) >>> 0) + (d[i + 1] << 16) + (d[i + 2] << 8) + d[i + 3]; }
  function tipo(d, i) { return String.fromCharCode(d[i], d[i + 1], d[i + 2], d[i + 3]); }
  function ler(arq, a, b) { return arq.slice(a, b).arrayBuffer().then(function (x) { return new Uint8Array(x); }); }

  // caixas de um trecho já lido; as de contêiner viram árvore
  function partir(d) {
    var r = [], i = 0;
    while (i + 8 <= d.length) {
      var t = u32(d, i), ty = tipo(d, i + 4), h = 8;
      if (t === 1) { t = u32(d, i + 8) * 4294967296 + u32(d, i + 12); h = 16; }
      if (t === 0) t = d.length - i;
      if (t < h || i + t > d.length) throw new Error("caixa quebrada");
      var corpo = d.subarray(i + h, i + t);
      r.push(CAIXAS[ty] ? { tipo: ty, filhos: partir(corpo) } : { tipo: ty, dados: corpo });
      i += t;
    }
    return r;
  }
  function achar(lista, ty) { for (var i = 0; i < lista.length; i++) if (lista[i].tipo === ty) return lista[i]; }
  function caixa(ty, corpo) {
    var b = new Uint8Array(8 + corpo.length), v = new DataView(b.buffer);
    v.setUint32(0, b.length); for (var i = 0; i < 4; i++) b[4 + i] = ty.charCodeAt(i);
    b.set(corpo, 8); return b;
  }
  function juntar(partes) {
    var n = 0; partes.forEach(function (p) { n += p.length; });
    var r = new Uint8Array(n), i = 0; partes.forEach(function (p) { r.set(p, i); i += p.length; });
    return r;
  }
  function montar(c) { return caixa(c.tipo, c.filhos ? juntar(c.filhos.map(montar)) : c.dados); }

  window.inkExtrairM4a = function (arq, aoAvancar) {
    // 1. acha o moov no nível de cima (pode estar no fim do arquivo)
    function procurar(pos) {
      if (pos + 8 > arq.size) return Promise.reject(new Error("sem moov"));
      return ler(arq, pos, pos + 16).then(function (h) {
        var t = u32(h, 0), ty = tipo(h, 4), cab = 8;
        if (t === 1) { t = u32(h, 8) * 4294967296 + u32(h, 12); cab = 16; }
        if (t === 0) t = arq.size - pos;
        if (t < 8) return Promise.reject(new Error("caixa quebrada"));
        if (ty === "moov") return ler(arq, pos + cab, pos + t);
        return procurar(pos + t);
      });
    }
    return procurar(0).then(function (corpo) {
      var moov = { tipo: "moov", filhos: partir(corpo) };
      var mvhd = achar(moov.filhos, "mvhd"), trak = null;
      moov.filhos.forEach(function (c) {
        if (trak || c.tipo !== "trak") return;
        var mdia = achar(c.filhos, "mdia"), hdlr = mdia && achar(mdia.filhos, "hdlr");
        if (hdlr && tipo(hdlr.dados, 8) === "soun") trak = c;
      });
      if (!mvhd || !trak) throw new Error("sem som");
      var stbl = achar(achar(achar(trak.filhos, "mdia").filhos, "minf").filhos, "stbl");
      var stsd = achar(stbl.filhos, "stsd"), stsz = achar(stbl.filhos, "stsz"), stsc = achar(stbl.filhos, "stsc");
      var stco = achar(stbl.filhos, "stco"), co64 = achar(stbl.filhos, "co64");
      if (!stsd || tipo(stsd.dados, 12) !== "mp4a" || !stsz || !stsc || !(stco || co64)) throw new Error("formato");

      // 2. onde está cada pedaço (chunk) de áudio e quantos bytes tem
      var z = stsz.dados, fixo = u32(z, 4), nAmostras = u32(z, 8);
      function tam(k) { return fixo || u32(z, 12 + 4 * k); }
      var o = (stco || co64).dados, nPed = u32(o, 4), ofs = [];
      for (var i = 0; i < nPed; i++) ofs.push(co64 ? u32(o, 8 + 8 * i) * 4294967296 + u32(o, 12 + 8 * i) : u32(o, 8 + 4 * i));
      var s = stsc.dados, nE = u32(s, 4), pedacos = [], amostra = 0;
      for (var e = 0; e < nE; e++) {
        var ini = u32(s, 8 + 12 * e) - 1, fim = e + 1 < nE ? u32(s, 8 + 12 * (e + 1)) - 1 : nPed, por = u32(s, 12 + 12 * e);
        for (var p = ini; p < fim && p < nPed; p++) {
          var bytes = 0;
          for (var k = 0; k < por && amostra < nAmostras; k++) bytes += tam(amostra++);
          pedacos.push([ofs[p], bytes]);
        }
      }
      if (!pedacos.length) throw new Error("sem som");

      // 3. novo moov: só o mvhd e a faixa de som, com um stco que aponta para o novo mdat
      var novo = new Uint8Array(8 + 4 * pedacos.length);
      new DataView(novo.buffer).setUint32(4, pedacos.length);
      stbl.filhos = stbl.filhos.filter(function (c) { return c.tipo !== "co64" && c.tipo !== "stco"; });
      stbl.filhos.push({ tipo: "stco", dados: novo });
      moov.filhos = [mvhd, trak];
      var ftyp = caixa("ftyp", new Uint8Array([77, 52, 65, 32, 0, 0, 0, 0, 77, 52, 65, 32, 109, 112, 52, 50, 105, 115, 111, 109]));
      var total = 0; pedacos.forEach(function (q) { total += q[1]; });
      var tamMoov = montar(moov).length, base = ftyp.length + tamMoov + 8, dv = new DataView(novo.buffer);
      pedacos.forEach(function (q, j) { dv.setUint32(8 + 4 * j, base); base += q[1]; });
      var cabMdat = new Uint8Array(8); new DataView(cabMdat.buffer).setUint32(0, total + 8); cabMdat.set([109, 100, 97, 116], 4);

      // 4. copia os pedaços de áudio, em lotes, para mostrar o andamento
      var partes = [ftyp, montar(moov), cabMdat], feito = 0, LOTE = 400;
      function lote(j) {
        if (j >= pedacos.length) return new Blob(partes, { type: "audio/mp4" });
        var fatias = pedacos.slice(j, j + LOTE).map(function (q) { feito += q[1]; return arq.slice(q[0], q[0] + q[1]); });
        return new Blob(fatias).arrayBuffer().then(function (b) {
          partes.push(new Uint8Array(b));
          if (aoAvancar) aoAvancar(feito / total);
          return lote(j + LOTE);
        });
      }
      return lote(0);
    });
  };
})();
