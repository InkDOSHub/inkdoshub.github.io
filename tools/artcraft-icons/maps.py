# InkDOS control -> ArtCraft icon. wc = WordCraft, gc = GridCraft, dc = DeckCraft.
# Keys are CSS selectors. "bar" marks colour controls: the icon's colour bar follows the chosen colour.
MENU = {'[data-frame-action="sun"]': 'appearance', '[data-frame-action="lock"]': 'lock', '[data-frame-action="share"]': 'share'}
MAPS = {
 'documents': {'set': 'wc', 'map': {
  '#undoBtn': 'undo', '#redoBtn': 'redo', '#printBtn': 'print', '#formatPainterBtn': 'painter',
  '[data-cmd="bold"]': 'bold', '[data-cmd="italic"]': 'italic', '[data-cmd="underline"]': 'underline',
  '#d1FormatBtn': 'fontcolor', '#checklistBtn': 'ccCheckBox', '[data-cmd="insertUnorderedList"]': 'bullets',
  '[data-cmd="insertOrderedList"]': 'numbering', '#alphaList': 'multilevel', '[data-cmd="outdent"]': 'outdent',
  '[data-cmd="indent"]': 'indent', '#clearFormattingBtn': 'clear', '#hyperlinkBtn': 'link', '#commentBtn': 'newComment',
  'label[for="imageInput"]': 'picture', '#tableBtn': 'table', '#rowBtn': 'insertBelow', '#colBtn': 'insertRight',
  '#zoomOut': 'zoomOut', '#zoomIn': 'zoomIn', '#zoomMenuBtn': 'chevronDown', '#d1LayoutBtn': 'margins', '#d2P1Btn': 'options',
  '#contextBtn': 'navPane', '#newMenuBtn': 'file', '#openMenuBtn': 'open', '#saveMenuBtn': 'save', '#shareMenuBtn': 'share',
  '#closeContextBtn': 'close', '#fitPage': 'onePage', '#fitWidth': 'pageWidth',
  '#prevHit': 'chevronUp', '#nextHit': 'chevronDown'},
  'pickers': {'styleSelect': 'styles', 'alignmentSelect': 'alignLeft', 'lineSpacing': 'lineSpacing'}},
 'spreadsheets': {'set': 'gc', 'map': {
  '#undoBtn': 'Undo', '#redoBtn': 'Redo', '#printBtn': 'Print', '#formatPainterBtn': 'Brush',
  '#boldBtn': 'Bold', '#italicBtn': 'Italic', '#underlineBtn': 'Underline', '#strikeBtn': 'Strike',
  'label.color-tool:has(#textColorInput)': 'FontColor:bar', 'label.color-tool:has(#fillColorInput)': 'Fill:bar',
  'label.color-tool:has(#borderColorInput)': 'BorderOutside:bar',
  '#mergeBtn': 'Merge', '#currencyBtn': 'Currency', '#percentBtn': 'Percent', '#decreaseDecimalsBtn': 'DecDec',
  '#increaseDecimalsBtn': 'DecInc', '#linkBtn': 'Link', '#commentBtn': 'Comment', '#chartBtn': 'Chart',
  '#addRowBtn': 'wc:insertBelow', '#addColBtn': 'wc:insertRight', '#deleteRowBtn': 'Delete', '#deleteColBtn': 'Delete',
  '#sortAscBtn': 'SortAsc', '#sortDescBtn': 'SortDesc', '#filterBtn': 'Filter', '#clearBtn': 'Eraser',
  '#zoomOut': 'Minus', '#zoomIn': 'Plus', '#zoomMenuBtn': 'Chevron', '#gridlinesBtn': 'Gridlines',
  '#menuNew': 'NewFile', '#menuOpen': 'OpenFolder', '#menuSave': 'Save', '#menuShare': 'Share', '#fitWidth': 'Zoom'},
  'pickers': {'numberFormat': 'Calc', 'borderSides': 'BorderAll', 'borderStyle': 'BorderNone', 'borderWidth': 'BorderThick',
   'alignmentSelect': 'AlignLeft', 'verticalAlignmentSelect': 'AlignMiddle', 'wrapSelect': 'Wrap', 'rotationSelect': 'Orientation',
   'operationSelect': 'Sum'}},
 'presentations': {'set': 'dc', 'map': {
  '#undoBtn': 'undo', '#redoBtn': 'redo', '#pptP1PrintBtn': 'print', '#pptP1FormatPainter': 'format-painter',
  '#addSlideBtn': 'new-slide', '#pptP1Background': 'format-background', '#pptP2ThemeBtn': 'themes',
  '.ppt-p1-color-control.color-text': 'font-color:bar', '.ppt-p1-color-control.color-fill': 'shape-fill:bar',
  '.ppt-p1-color-control.color-border': 'shape-outline:bar', '#pptP1Bullets': 'bullets', '#insertTextBtn': 'text-box',
  '#pptP1ImageBtn': 'picture', '#pptP1LineBtn': 'shapes', '#pptP2TableToolsBtn': 'table', '#pptP2CommentBtn': 'new-comment',
  '#zoomOut': 'zoom-out', '#zoomIn': 'zoom-in', '#zoomMenuBtn': 'chevron-down', '#prevSlideBtn': 'chevron-left',
  '#nextSlideBtn': 'chevron-right', '#duplicateSlideBtn': 'duplicate-slide', '#deleteSlideBtn': 'delete-slide',
  '#moveSlideUpBtn': 'chevron-up', '#moveSlideDownBtn': 'chevron-down', '#slidePanelBtn': 'view-normal',
  '#pptP2NotesBtn': 'notes', '#presentBtn': 'play-from-current', '#presentStartMenuBtn': 'play-from-start',
  '#newMenuBtn': 'new-file', '#openMenuBtn': 'open-folder', '#saveMenuBtn': 'save', '#shareMenuBtn': 'share',
  '#fitPage': 'fit-to-window', '#fitWidth': 'fit-small'},
  'pickers': {'alignSelect': 'align-left', 'fontFamily': 'fonts', 'pptP1Arrange': 'arrange', 'pptP1BorderStyle': 'shape-outline',
   'pptP1BorderWidth': 'wc:thickness', 'pptP1Layout': 'layout', 'pptP1Shape': 'shapes', 'pptP2Transition': 'effect-options'}},
 'pdf': {'set': 'wc', 'map': {
  '#undoBtn': 'undo', '#redoBtn': 'redo', '#selectToolBtn': 'select', '#textToolBtn': 'textBox', '#penToolBtn': 'pen',
  '#highlightToolBtn': 'highlight', '#persistentHighlightBtn': 'highlight', '#underlineToolBtn': 'underline',
  '#persistentNoteBtn': 'addNote', '#commentToolBtn': 'newComment', '#deleteAnnotationBtn': 'deleteComment',
  '#navPanelBtn': 'navPane', '#prevPageBtn': 'chevronLeft', '#nextPageBtn': 'chevronRight', '#zoomOut': 'zoomOut',
  '#zoomIn': 'zoomIn', '#zoomMenuBtn': 'chevronDown', '#pdfRotateViewBtn': 'rotate', '#editModeBtn': 'pencil',
  '#pdfSearchBtn': 'find', '#pdfPrintBtn': 'print', '#saveToolbarBtn': 'save', '#pageToolsBtn': 'multiplePages',
  '#openMenuBtn': 'open', '#saveMenuBtn': 'save', '#shareMenuBtn': 'share', '#fitPage': 'onePage', '#fitWidth': 'pageWidth'}},
 'txt': {'set': 'wc', 'map': {
  '#undoBtn': 'undo', '#redoBtn': 'redo', '#printBtn': 'print', '#wrapBtn': 'wrapText', '#fontDownBtn': 'shrink',
  '#fontUpBtn': 'grow', '#outdentBtn': 'outdent', '#indentBtn': 'indent', '#listBtn': 'bullets', '#findBtn': 'find',
  '#findPrev': 'chevronUp', '#findNext': 'chevronDown', '#textToolsBtn': 'options', '#selectAllBtn': 'select',
  '#copyBtn': 'copy', '#pasteBtn': 'paste', '#newBtn': 'file', '#openBtn': 'open', '#saveBtn': 'save', '#shareBtn': 'share'}},
 'epub': {'set': 'wc', 'map': {
  '#prevBtn': 'chevronLeft', '#nextBtn': 'chevronRight', '#tocBtn': 'toc', '#bookmarkBtn': 'bookmark', '#searchBtn': 'find',
  '#appearanceBtn': 'fonts', '#highlightBtn': 'highlight', '#noteModeBtn': 'addNote', '#deleteAnnotationModeBtn': 'deleteComment',
  '#pagesBtn': 'onePage', '#turnBtn': 'sideToSide', '#scrollBtn': 'vertical', '#openBtn': 'open', '#saveBtn': 'save',
  '#shareBtn': 'share', '#appearanceClose': 'close', '#highlightClose': 'close', '#tocClose': 'close'}},
}
# shared menu entries use each app's own set
MENU_BY_SET = {'wc': {'appearance': 'darkMode', 'lock': 'protect', 'share': 'share'},
               'gc': {'appearance': 'Appearance', 'lock': 'Lock', 'share': 'Share'},
               'dc': {'appearance': 'palette', 'lock': 'lock', 'share': 'share'}}
