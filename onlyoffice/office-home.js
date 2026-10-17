// InkDOS Office Home: the appearance menu of the InkDOS Home, the strings of this page in the InkDOS language,
// and the OnlyOffice editors opened in that language.
(function () {
  'use strict';
  var root = document.documentElement;

  // appearance menu (same behaviour and storage key as the InkDOS Home)
  (function () {
    var KEY = 'inkdos2:appearance', VALID = ['light', 'dark', 'system'];
    var button = document.getElementById('appearanceButton'), menu = document.getElementById('appearanceMenu');
    var media = matchMedia('(prefers-color-scheme: dark)'), mode = root.dataset.appearanceMode || 'system';
    function apply() {
      var value = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
      root.dataset.theme = root.dataset.appearance = root.dataset.appearanceResolved = value;
      root.dataset.appearanceMode = mode;
      root.style.colorScheme = value;
      document.querySelectorAll('[data-home-appearance-mode]').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.homeAppearanceMode === mode)); });
      try { localStorage.setItem('ran-theme', value); } catch (_) {}
    }
    function closeMenu() { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); }
    button.addEventListener('click', function () { var opening = menu.hidden; menu.hidden = !opening; button.setAttribute('aria-expanded', String(opening)); });
    document.querySelectorAll('[data-home-appearance-mode]').forEach(function (choice) {
      choice.addEventListener('click', function () {
        if (VALID.indexOf(choice.dataset.homeAppearanceMode) < 0) return;
        mode = choice.dataset.homeAppearanceMode;
        try { localStorage.setItem(KEY, mode); } catch (_) {}
        apply(); closeMenu();
      });
    });
    document.addEventListener('click', function (event) { if (!event.target.closest('.home-appearance')) closeMenu(); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !menu.hidden) { closeMenu(); button.focus(); } });
    media.addEventListener('change', function () { if (mode === 'system') apply(); });
    apply();
  })();

  // Open on the reader tools (PDF.js viewer; InkDOS-tools, same origin): the file picked here
  // is stored in IndexedDB 'inkdos-tools-handoff' and the tool page takes it (viewers/file-handoff.js, #inkdos-file=<id>)
  // The InkDOS workspaces copied here (./apps/<app>/, the EPUB reader) take it the way the InkDOS Home hands it over:
  // IndexedDB 'inkdos-launch-handoff' and #inkdos-launch=<id> (their runtime/platform/file-launch.js).
  function handoff(file, page) {
    var inkdos = page.indexOf('./apps/') === 0;
    var go = function (id) {
      var url = new URL(page, location.href);
      url.searchParams.set('inkdos-theme', root.dataset.theme === 'dark' ? 'dark' : 'light');
      location.assign(url.pathname + url.search + (id ? (inkdos ? '#inkdos-launch=' : '#inkdos-file=') + id : ''));
    };
    file.arrayBuffer().then(function (data) {
      var req = indexedDB.open(inkdos ? 'inkdos-launch-handoff' : 'inkdos-tools-handoff', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('files'); };
      req.onsuccess = function () {
        var db = req.result, id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        var tx = db.transaction('files', 'readwrite'), store = tx.objectStore('files');
        store.clear();
        store.put({ name: file.name, type: file.type, lastModified: file.lastModified, data: data }, id);
        tx.oncomplete = function () { db.close(); go(id); };
        tx.onabort = tx.onerror = function () { db.close(); go(''); };
      };
      req.onerror = function () { go(''); };
    });
  }
  window.InkDOSOfficeHome = Object.freeze({ handoff: handoff });
  var picker = document.createElement('input');
  picker.type = 'file'; picker.hidden = true; document.body.appendChild(picker);
  var pickFor = null;
  picker.addEventListener('change', function () { var file = picker.files && picker.files[0]; if (file && pickFor) handoff(file, pickFor); });
  // New on a workspace card: hand the workspace an empty file, so its editor opens right away (no start page)
  document.querySelectorAll('[data-launch-new]').forEach(function (button) {
    button.addEventListener('click', function () {
      handoff(new File([''], button.dataset.newName || 'Untitled.txt', { type: 'text/plain' }), button.dataset.launchNew);
    });
  });
  document.querySelectorAll('[data-launch-app]').forEach(function (button) {
    button.addEventListener('click', function () {
      pickFor = button.dataset.launchApp; picker.accept = button.dataset.launchAccept || ''; picker.value = ''; picker.click();
    });
  });

  var T = {
    en: {},
    pt: { documents: 'Edite DOCX localmente; importe RTF; veja DOC, ODT e Pages.', spreadsheets: 'Edite XLSX localmente; veja XLS, ODS e Numbers.',
      presentations: 'Edite PPTX localmente; veja PPT, ODP e Keynote.', open: 'Abrir', new: 'Novo', edit: 'Editar',
      note: 'Documentos, Planilhas e Apresentações baixam cerca de 100 MB na primeira vez. Os arquivos nunca saem deste aparelho.',
      powered: 'Powered by', recent: 'Arquivos recentes', source: 'Código-fonte',
      pdfTools: 'Ferramentas de PDF', terminal: 'Terminal', offline: 'Ferramentas offline', offlineTitle: 'Ferramentas neste aparelho',
      offlineIntro: 'Baixe as ferramentas uma vez e elas abrem sem internet. Os arquivos que você abre nunca saem deste aparelho.',
      close: 'Fechar', downloadAll: 'Baixar tudo', checkUpdates: 'Buscar atualizações',
      pdfCard: 'Leia, anote e exporte cópias de PDF localmente.',
      txtCard: 'Crie e edite arquivos de texto localmente.',
      epubCard: 'Leia livros EPUB com navegação, temas e anotações.' },
    es: { documents: 'Documentos Word (DOCX, DOC, ODT, RTF) con el editor completo.', spreadsheets: 'Hojas de Excel (XLSX, XLS, ODS, CSV) con fórmulas y gráficos.',
      presentations: 'Presentaciones PowerPoint (PPTX, PPT, ODP) con el editor completo.', open: 'Abrir', new: 'Nuevo', edit: 'Editar',
      note: 'Documentos, Hojas de cálculo y Presentaciones descargan unos 100 MB la primera vez. Los archivos nunca salen de este dispositivo.',
      recent: 'Archivos recientes', source: 'Código fuente' },
    fr: { documents: 'Documents Word (DOCX, DOC, ODT, RTF) avec l’éditeur complet.', spreadsheets: 'Classeurs Excel (XLSX, XLS, ODS, CSV) avec formules et graphiques.',
      presentations: 'Présentations PowerPoint (PPTX, PPT, ODP) avec l’éditeur complet.', open: 'Ouvrir', new: 'Nouveau', edit: 'Modifier',
      note: 'Documents, Tableurs et Présentations téléchargent environ 100 Mo la première fois. Les fichiers ne quittent jamais cet appareil.',
      recent: 'Fichiers récents', source: 'Code source' },
    de: { documents: 'Word-Dokumente (DOCX, DOC, ODT, RTF) mit dem vollständigen Editor.', spreadsheets: 'Excel-Arbeitsmappen (XLSX, XLS, ODS, CSV) mit Formeln und Diagrammen.',
      presentations: 'PowerPoint-Präsentationen (PPTX, PPT, ODP) mit dem vollständigen Editor.', open: 'Öffnen', new: 'Neu', edit: 'Bearbeiten',
      note: 'Dokumente, Tabellen und Präsentationen laden beim ersten Mal etwa 100 MB. Dateien verlassen dieses Gerät nie.',
      recent: 'Zuletzt verwendet', source: 'Quellcode' },
    ja: { documents: '完全なエディターで Word 文書（DOCX、DOC、ODT、RTF）を編集。', spreadsheets: '数式とグラフ付きの Excel ブック（XLSX、XLS、ODS、CSV）。',
      presentations: '完全なエディターで PowerPoint（PPTX、PPT、ODP）を編集。', open: '開く', new: '新規', edit: '編集',
      note: '文書・スプレッドシート・プレゼンテーションは初回に約 100 MB をダウンロードします。ファイルがこのデバイスの外に出ることはありません。',
      recent: '最近のファイル', source: 'ソースコード' },
    ru: { documents: 'Документы Word (DOCX, DOC, ODT, RTF) в полном редакторе.', spreadsheets: 'Книги Excel (XLSX, XLS, ODS, CSV) с формулами и диаграммами.',
      presentations: 'Презентации PowerPoint (PPTX, PPT, ODP) в полном редакторе.', open: 'Открыть', new: 'Создать', edit: 'Изменить',
      note: 'Документы, Таблицы и Презентации в первый раз загружают около 100 МБ. Файлы никогда не покидают это устройство.',
      recent: 'Недавние файлы', source: 'Исходный код' },
    zh: { documents: '用完整编辑器处理 Word 文档（DOCX、DOC、ODT、RTF）。', spreadsheets: '带公式和图表的 Excel 工作簿（XLSX、XLS、ODS、CSV）。',
      presentations: '用完整编辑器处理 PowerPoint 演示文稿（PPTX、PPT、ODP）。', open: '打开', new: '新建', edit: '编辑',
      note: '文档、表格和演示文稿首次使用时需下载约 100 MB。文件绝不会离开本设备。',
      recent: '最近的文件', source: '源代码' }
  };
  var EN = {};
  document.querySelectorAll('[data-office-t]').forEach(function (el) { EN[el.dataset.officeT] = el.textContent; });
  // the OnlyOffice editors' UI language for each InkDOS language (site codes of ranuts/document, else the editor's)
  var EDITOR = { pt: 'pt', es: 'es', de: 'de', ja: 'ja', zh: 'zh-CN', fr: 'fr', ru: 'ru' };

  function localize() {
    var code = (root.lang || 'en').toLowerCase().split('-')[0], t = T[code] || {};
    document.querySelectorAll('[data-office-t]').forEach(function (el) { el.textContent = t[el.dataset.officeT] || EN[el.dataset.officeT]; });
    var locale = EDITOR[code];
    document.querySelectorAll('a[href^="/editor"], a[href^="/history"], [data-open-local]').forEach(function (el) {
      var attr = el.hasAttribute('data-open-local') ? 'data-open-local' : 'href';
      var url = new URL(el.getAttribute(attr), location.href);
      if (locale) url.searchParams.set('locale', locale); else url.searchParams.delete('locale');
      el.setAttribute(attr, url.pathname + url.search);
    });
  }
  // the tools keep the InkDOS appearance (?inkdos-theme=, as from the InkDOS Home)
  function toolLinks() {
    document.querySelectorAll('a[data-tool-link]').forEach(function (a) {
      var url = new URL(a.getAttribute('href'), location.href);
      url.searchParams.set('inkdos-theme', root.dataset.theme === 'dark' ? 'dark' : 'light');
      a.setAttribute('href', url.pathname + url.search);
    });
  }
  new MutationObserver(toolLinks).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  toolLinks();
  new MutationObserver(localize).observe(root, { attributes: true, attributeFilter: ['lang'] });
  localize();

  // InkDOS keeps no recent files: remove the editor's local history (snapshots of documents, encrypted, and its key)
  // stored before this was turned off. Once per device.
  try {
    if (localStorage.getItem('inkdos-office:history-removed') !== '1' && window.indexedDB) {
      indexedDB.deleteDatabase('document-history');
      indexedDB.deleteDatabase('document-history-key');
      localStorage.setItem('inkdos-office:history-removed', '1');
    }
  } catch (_) {}

  // The service worker keeps each editor on this device after its first use; ask the browser not to clear that
  // copy (and the recent files) under storage pressure, so the editors keep opening with no network.
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (_) {}
})();
