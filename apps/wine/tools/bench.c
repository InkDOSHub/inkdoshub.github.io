/* InkDOS Hub CPU test for Windows (32-bit): same guest loop as apps/xeos-tests/emu.js
   (random-number loop, counted as 10 instructions per turn), so results compare with the browser test. */
typedef long long i64; typedef unsigned int u32;
typedef struct { u32 lo; int hi; } LI;
__declspec(dllimport) int __stdcall QueryPerformanceCounter(i64 *);
__declspec(dllimport) int __stdcall QueryPerformanceFrequency(i64 *);
__declspec(dllimport) void *__stdcall GetStdHandle(u32);
__declspec(dllimport) int __stdcall WriteFile(void *, const void *, u32, u32 *, void *);
__declspec(dllimport) void __stdcall ExitProcess(u32);
__declspec(dllimport) int __stdcall MessageBoxA(void *, const char *, const char *, u32);
int _fltused = 0;
static volatile u32 sink;
static u32 loop(u32 n) { u32 r0 = 1, r2 = 0; while (n--) { r0 = r0 * 1103515245u + 12345u; r2 = (r2 ^ (r0 >> 7)) + (r0 & 255); } return r2; }
static char *num(char *p, u32 v) { char t[12]; int i = 0; do { t[i++] = '0' + v % 10; v /= 10; } while (v); while (i) *p++ = t[--i]; return p; }
static char *str(char *p, const char *s) { while (*s) *p++ = *s++; return p; }
void __stdcall start(void) {
  i64 f, a, b; u32 n = 1000000; double s;
  QueryPerformanceFrequency(&f);
  for (;;) { QueryPerformanceCounter(&a); sink = loop(n); QueryPerformanceCounter(&b); s = (double)(b - a) / (double)f; if (s > 1.0 || n > 400000000u) break; n *= 2; }
  u32 mips = (u32)((double)n * 10.0 / s / 1e6);
  char buf[200], *p = buf;
  p = str(p, "InkDOS Hub CPU test (x86, inside the emulator): "); p = num(p, mips); p = str(p, " MIPS ("); p = num(p, n); p = str(p, " turns in "); p = num(p, (u32)(s * 1000)); p = str(p, " ms)\n"); *p = 0;
  u32 w; WriteFile(GetStdHandle((u32)-11), buf, (u32)(p - buf), &w, 0);
  MessageBoxA(0, buf, "CPU test", 0);
  ExitProcess(0);
}
