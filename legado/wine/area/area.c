/* Área de trabalho do InkDOS Hub dentro do Wine.

   Uma janela do tamanho da tela, atrás de todas as outras, com o fundo azul e um ícone para cada
   atalho dos programas instalados (Área de trabalho e menu Iniciar, do usuário e de todos), mais
   alguns atalhos fixos. Um toque abre o programa. A lista é refeita a cada 4 s, então um programa
   recém-instalado aparece sozinho.

   Conversa com a página pelo disco D: (a pasta D:\.inkdoshub):
   - "pronto": gravado quando a janela aparece; a página tira o aviso de carregamento;
   - "abrir.txt": a página grava ali um caminho por linha (um instalador recebido, por exemplo);
     a cada segundo a área de trabalho abre cada um e apaga o arquivo;
   - "atalhos\*.lnk": atalhos que a página cria para programas sem instalador.
   Também aceita um programa ou pasta na linha de comando: area.exe "D:\Recebidos\setup.exe".

   Compilar: tools/wine-area.sh (i686-w64-mingw32-gcc). */
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define _WIN32_IE 0x0600
#include <windows.h>
#include <commctrl.h>
#include <shellapi.h>
#include <shlobj.h>
#include <wchar.h>

#define FUNDO RGB(22, 50, 84) /* azul-escuro: o texto branco dos ícones fica legível */
#define MAX_ITENS 400

typedef struct { WCHAR nome[MAX_PATH]; WCHAR alvo[MAX_PATH]; WCHAR args[MAX_PATH]; } Item;

static Item itens[MAX_ITENS];
static int nItens = 0;
static WCHAR assinatura[65536];
static HWND janela, lista;
static HIMAGELIST icones;
static HFONT fonte;
static DWORD ultimoToque = 0;
static int ultimoItem = -1;

static int ignorar(const WCHAR *nome) {
  static const WCHAR *ruins[] = { L"uninst", L"desinst", L"remov", L"readme", L"leia-me", L"leiame", L"help",
    L"ajuda", L"website", L"web site", L"homepage", L"manual", L"license", L"licen", L"changelog", L"what's new", 0 };
  WCHAR m[MAX_PATH];
  lstrcpynW(m, nome, MAX_PATH);
  CharLowerW(m);
  for (int i = 0; ruins[i]; i++) if (wcsstr(m, ruins[i])) return 1;
  return 0;
}

static void adicionar(const WCHAR *nome, const WCHAR *alvo, const WCHAR *args) {
  if (nItens >= MAX_ITENS) return;
  for (int i = 0; i < nItens; i++) if (!lstrcmpiW(itens[i].nome, nome)) return; /* mesmo nome: um só */
  lstrcpynW(itens[nItens].nome, nome, MAX_PATH);
  lstrcpynW(itens[nItens].alvo, alvo, MAX_PATH);
  lstrcpynW(itens[nItens].args, args ? args : L"", MAX_PATH);
  nItens++;
}

static void varrer(const WCHAR *pasta, int nivel) {
  WCHAR busca[MAX_PATH];
  WIN32_FIND_DATAW d;
  if (nivel > 3) return;
  wsprintfW(busca, L"%s\\*", pasta);
  HANDLE h = FindFirstFileW(busca, &d);
  if (h == INVALID_HANDLE_VALUE) return;
  do {
    if (d.cFileName[0] == L'.') continue;
    WCHAR cam[MAX_PATH];
    wsprintfW(cam, L"%s\\%s", pasta, d.cFileName);
    if (d.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) { varrer(cam, nivel + 1); continue; }
    int n = lstrlenW(d.cFileName);
    if (n > 4 && !lstrcmpiW(d.cFileName + n - 4, L".lnk")) {
      WCHAR nome[MAX_PATH];
      lstrcpynW(nome, d.cFileName, n - 3);
      if (!ignorar(nome)) adicionar(nome, cam, L"");
    }
  } while (FindNextFileW(h, &d));
  FindClose(h);
}

static int comparar(const void *a, const void *b) { return lstrcmpiW(((const Item *)a)->nome, ((const Item *)b)->nome); }

static void montarLista(int forcar) {
  static const int pastas[] = { CSIDL_DESKTOPDIRECTORY, CSIDL_COMMON_DESKTOPDIRECTORY, CSIDL_PROGRAMS, CSIDL_COMMON_PROGRAMS };
  nItens = 0;
  for (int i = 0; i < 4; i++) {
    WCHAR p[MAX_PATH];
    if (SHGetSpecialFolderPathW(NULL, p, pastas[i], FALSE)) varrer(p, 0);
  }
  varrer(L"D:\\.inkdoshub\\atalhos", 0);
  qsort(itens, nItens, sizeof(Item), comparar);
  int fixos = nItens;
  adicionar(L"Drive D: (your files)", L"explorer.exe", L"D:\\");
  adicionar(L"Drive C:", L"explorer.exe", L"C:\\");
  WCHAR sis[MAX_PATH], cam[MAX_PATH];
  GetSystemDirectoryW(sis, MAX_PATH);
  wsprintfW(cam, L"%s\\notepad.exe", sis); adicionar(L"Notepad", cam, L"");
  wsprintfW(cam, L"%s\\wineconsole.exe", sis); adicionar(L"Command prompt", cam, L"cmd");
  (void)fixos;

  /* só redesenha se algo mudou */
  WCHAR nova[65536];
  nova[0] = 0;
  int usado = 0;
  for (int i = 0; i < nItens && usado < 65000; i++) {
    int n = lstrlenW(itens[i].alvo);
    if (usado + n + 2 >= 65000) break;
    lstrcpyW(nova + usado, itens[i].alvo); usado += n;
    nova[usado++] = L'|'; nova[usado] = 0;
  }
  if (!forcar && !lstrcmpW(nova, assinatura)) return;
  lstrcpyW(assinatura, nova);

  SendMessageW(lista, WM_SETREDRAW, FALSE, 0);
  ListView_DeleteAllItems(lista);
  ImageList_RemoveAll(icones);
  for (int i = 0; i < nItens; i++) {
    SHFILEINFOW sfi;
    int img = -1;
    ZeroMemory(&sfi, sizeof(sfi));
    if (SHGetFileInfoW(itens[i].args[0] && !lstrcmpiW(itens[i].alvo, L"explorer.exe") ? itens[i].args : itens[i].alvo,
                       0, &sfi, sizeof(sfi), SHGFI_ICON | SHGFI_LARGEICON) && sfi.hIcon) {
      img = ImageList_AddIcon(icones, sfi.hIcon);
      DestroyIcon(sfi.hIcon);
    }
    LVITEMW it;
    ZeroMemory(&it, sizeof(it));
    it.mask = LVIF_TEXT | LVIF_IMAGE | LVIF_PARAM;
    it.iItem = i;
    it.pszText = itens[i].nome;
    it.iImage = img;
    it.lParam = i;
    ListView_InsertItem(lista, &it);
  }
  SendMessageW(lista, WM_SETREDRAW, TRUE, 0);
  InvalidateRect(lista, NULL, TRUE);
}

static void abrir(const WCHAR *alvo, const WCHAR *args) {
  int n = lstrlenW(alvo);
  if (n > 4 && !lstrcmpiW(alvo + n - 4, L".msi")) {
    WCHAR a[MAX_PATH + 8];
    wsprintfW(a, L"/i \"%s\"", alvo);
    ShellExecuteW(NULL, L"open", L"msiexec.exe", a, NULL, SW_SHOWNORMAL);
    return;
  }
  DWORD at = GetFileAttributesW(alvo);
  if (at != INVALID_FILE_ATTRIBUTES && (at & FILE_ATTRIBUTE_DIRECTORY)) {
    ShellExecuteW(NULL, L"open", L"explorer.exe", alvo, NULL, SW_SHOWNORMAL);
    return;
  }
  /* pasta de trabalho: a do próprio programa, como os instaladores esperam */
  WCHAR pasta[MAX_PATH];
  lstrcpynW(pasta, alvo, MAX_PATH);
  WCHAR *barra = wcsrchr(pasta, L'\\');
  if (barra) *barra = 0; else pasta[0] = 0;
  ShellExecuteW(NULL, L"open", alvo, args && args[0] ? args : NULL, pasta[0] ? pasta : NULL, SW_SHOWNORMAL);
}

/* Pedidos da página: D:\.inkdoshub\abrir.txt, um caminho por linha, em UTF-8. */
static void lerPedidos(void) {
  HANDLE f = CreateFileW(L"D:\\.inkdoshub\\abrir.txt", GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
  if (f == INVALID_HANDLE_VALUE) return;
  char buf[8192]; DWORD lido = 0;
  ReadFile(f, buf, sizeof(buf) - 1, &lido, NULL);
  CloseHandle(f);
  DeleteFileW(L"D:\\.inkdoshub\\abrir.txt");
  buf[lido] = 0;
  WCHAR texto[8192];
  int n = MultiByteToWideChar(CP_UTF8, 0, buf, -1, texto, 8192);
  if (n <= 0) return;
  WCHAR *linha = texto;
  while (*linha) {
    WCHAR *fim = linha;
    while (*fim && *fim != L'\r' && *fim != L'\n') fim++;
    WCHAR c = *fim;
    *fim = 0;
    if (linha[0]) abrir(linha, L"");
    if (!c) break;
    linha = fim + 1;
  }
}

static void ajustar(void) {
  RECT r;
  if (!SystemParametersInfoW(SPI_GETWORKAREA, 0, &r, 0)) SetRect(&r, 0, 0, GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN));
  /* a barra de tarefas do Wine nem sempre tira o espaço dela da área útil */
  if (r.bottom >= GetSystemMetrics(SM_CYSCREEN)) r.bottom -= 30;
  SetWindowPos(janela, HWND_BOTTOM, r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_NOACTIVATE);
  MoveWindow(lista, 0, 0, r.right - r.left, r.bottom - r.top, TRUE);
}

static LRESULT CALLBACK proc(HWND h, UINT m, WPARAM w, LPARAM l) {
  switch (m) {
  case WM_WINDOWPOSCHANGING: ((WINDOWPOS *)l)->hwndInsertAfter = HWND_BOTTOM; ((WINDOWPOS *)l)->flags &= ~SWP_NOZORDER; break;
  case WM_ACTIVATE: if (LOWORD(w) != WA_INACTIVE) SetWindowPos(h, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE); break;
  case WM_DISPLAYCHANGE: case WM_SETTINGCHANGE: ajustar(); break;
  case WM_TIMER: if (w == 1) montarLista(0); else lerPedidos(); return 0;
  case WM_NOTIFY: {
    NMHDR *nh = (NMHDR *)l;
    if (nh->hwndFrom == lista && (nh->code == NM_CLICK || nh->code == NM_DBLCLK)) {
      NMITEMACTIVATE *ia = (NMITEMACTIVATE *)l;
      if (ia->iItem < 0) return 0;
      LVITEMW it; ZeroMemory(&it, sizeof(it));
      it.mask = LVIF_PARAM; it.iItem = ia->iItem;
      ListView_GetItem(lista, &it);
      /* um toque abre; o segundo toque de um toque duplo não abre de novo */
      DWORD agora = GetTickCount();
      if (ultimoItem == (int)it.lParam && agora - ultimoToque < 1500) return 0;
      ultimoItem = (int)it.lParam; ultimoToque = agora;
      if (it.lParam >= 0 && it.lParam < nItens) abrir(itens[it.lParam].alvo, itens[it.lParam].args);
    }
    return 0;
  }
  case WM_ERASEBKGND: { RECT r; GetClientRect(h, &r); HBRUSH b = CreateSolidBrush(FUNDO); FillRect((HDC)w, &r, b); DeleteObject(b); return 1; }
  case WM_CLOSE: return 0; /* a área de trabalho não fecha */
  case WM_DESTROY: PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(h, m, w, l);
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE ant, LPWSTR linha, int mostrar) {
  INITCOMMONCONTROLSEX icc = { sizeof(icc), ICC_LISTVIEW_CLASSES };
  InitCommonControlsEx(&icc);
  CoInitialize(NULL);

  WNDCLASSW wc; ZeroMemory(&wc, sizeof(wc));
  wc.lpfnWndProc = proc; wc.hInstance = inst; wc.lpszClassName = L"InkDOSHubArea";
  wc.hCursor = LoadCursorW(NULL, (LPCWSTR)IDC_ARROW);
  RegisterClassW(&wc);
  janela = CreateWindowExW(WS_EX_TOOLWINDOW, L"InkDOSHubArea", L"Desktop", WS_POPUP | WS_CLIPCHILDREN,
                           0, 0, 800, 600, NULL, NULL, inst, NULL);
  lista = CreateWindowExW(0, WC_LISTVIEWW, L"", WS_CHILD | WS_VISIBLE | LVS_ICON | LVS_AUTOARRANGE | LVS_SINGLESEL,
                          0, 0, 800, 600, janela, NULL, inst, NULL);
  icones = ImageList_Create(32, 32, ILC_COLOR32 | ILC_MASK, 16, 16);
  ListView_SetImageList(lista, icones, LVSIL_NORMAL);
  ListView_SetBkColor(lista, FUNDO);
  ListView_SetTextBkColor(lista, FUNDO);
  ListView_SetTextColor(lista, RGB(255, 255, 255));
  /* nomes maiores e em negrito: a imagem do Wine é reduzida para caber na tela do iPad */
  fonte = CreateFontW(-17, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
                      CLIP_DEFAULT_PRECIS, ANTIALIASED_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Tahoma");
  if (fonte) SendMessageW(lista, WM_SETFONT, (WPARAM)fonte, FALSE);
  ListView_SetIconSpacing(lista, 120, 100);
  ajustar();
  montarLista(1);
  ShowWindow(janela, SW_SHOWNOACTIVATE);
  UpdateWindow(janela);
  SetTimer(janela, 1, 4000, NULL);
  SetTimer(janela, 2, 1000, NULL);

  /* avisa a página que a área de trabalho apareceu */
  CreateDirectoryW(L"D:\\.inkdoshub", NULL);
  HANDLE f = CreateFileW(L"D:\\.inkdoshub\\pronto", GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
  if (f != INVALID_HANDLE_VALUE) CloseHandle(f);
  lerPedidos();
  /* programa pedido na abertura (instalador recebido da tela inicial) */
  int argc = 0;
  LPWSTR *argv = linha && linha[0] ? CommandLineToArgvW(linha, &argc) : NULL;
  if (argv && argc > 0) {
    WCHAR resto[MAX_PATH]; resto[0] = 0;
    for (int i = 1; i < argc; i++) {
      if (lstrlenW(resto) + lstrlenW(argv[i]) + 4 >= MAX_PATH) break;
      if (resto[0]) lstrcatW(resto, L" ");
      lstrcatW(resto, L"\""); lstrcatW(resto, argv[i]); lstrcatW(resto, L"\"");
    }
    abrir(argv[0], resto);
  }
  if (argv) LocalFree(argv);

  MSG msg;
  while (GetMessageW(&msg, NULL, 0, 0) > 0) { TranslateMessage(&msg); DispatchMessageW(&msg); }
  return 0;
}
