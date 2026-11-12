/* InkSoC stage 1 test: a normal 64-bit console program (no C runtime yet:
   msvcrt comes with the Wine-in-wasm stage). */
#include <windows.h>
#include "core.h"
#include "expected.h"

__declspec(dllimport) long long __cdecl dll_mix(long long a, long long b);
__declspec(dllimport) const char *__cdecl dll_name(int i);
__declspec(dllimport) int dll_counter;

static HANDLE out;
static int fails;

/* ---- tiny printf (exercises varargs, division, strings) ---- */
static int fmt_u(char *b, unsigned long long v, int base) {
    char t[24]; int n = 0, k = 0;
    do { int d = (int)(v % base); t[n++] = (char)(d < 10 ? '0' + d : 'a' + d - 10); v /= base; } while (v);
    while (n) b[k++] = t[--n];
    return k;
}
static void out_str(const char *s, int n) { DWORD w; WriteFile(out, s, n, &w, 0); }
static void pr(const char *f, ...) {
    char b[512]; int k = 0;
    va_list ap; va_start(ap, f);
    for (; *f && k < 480; f++) {
        if (*f != '%') { b[k++] = *f; continue; }
        f++;
        int ll = 0; while (*f == 'l') { ll++; f++; }
        if (*f == 'd') { long long v = ll ? va_arg(ap, long long) : va_arg(ap, int); if (v < 0) { b[k++] = '-'; v = -v; } k += fmt_u(b + k, (unsigned long long)v, 10); }
        else if (*f == 'u') { unsigned long long v = ll ? va_arg(ap, unsigned long long) : va_arg(ap, unsigned); k += fmt_u(b + k, v, 10); }
        else if (*f == 'x') { unsigned long long v = ll ? va_arg(ap, unsigned long long) : va_arg(ap, unsigned); k += fmt_u(b + k, v, 16); }
        else if (*f == 's') { const char *s = va_arg(ap, const char *); while (*s && k < 480) b[k++] = *s++; }
        else if (*f == 'f') { double v = va_arg(ap, double); if (v < 0) { b[k++] = '-'; v = -v; } unsigned long long ip = (unsigned long long)v;
            k += fmt_u(b + k, ip, 10); b[k++] = '.'; unsigned long long fr = (unsigned long long)((v - ip) * 1000 + 0.5); b[k++] = '0' + fr / 100 % 10; b[k++] = '0' + fr / 10 % 10; b[k++] = '0' + fr % 10; }
        else b[k++] = *f;
    }
    va_end(ap);
    out_str(b, k);
}
static void check(const char *name, u64 got, u64 exp, DWORD ms) {
    int ok = got == exp; if (!ok) fails++;
    pr("[%s] %s  %llx  (%u ms)\n", ok ? "ok" : "FAIL", name, got, ms);
}

void start(void) {
    out = GetStdHandle(STD_OUTPUT_HANDLE);
    pr("InkSoC stage 1 test (x86-64)\n");

    /* system */
    SYSTEM_INFO si; GetSystemInfo(&si);
    MEMORYSTATUSEX ms; ms.dwLength = sizeof ms; GlobalMemoryStatusEx(&ms);
    pr("[sys] page %u, cpus %u, memory %llu MB total, %llu MB free\n", si.dwPageSize, si.dwNumberOfProcessors, ms.ullTotalPhys >> 20, ms.ullAvailPhys >> 20);
    pr("[sys] pid %u, module %llx, cmdline \"%s\"\n", GetCurrentProcessId(), (u64)GetModuleHandleA(0), GetCommandLineA());
    LARGE_INTEGER f0, c0, c1; QueryPerformanceFrequency(&f0); QueryPerformanceCounter(&c0);

    /* errors */
    SetLastError(1234); if (GetLastError() != 1234) { fails++; pr("[FAIL] last error\n"); }

    /* TEB/PEB through gs:, and TLS slots */
    u64 teb = __readgsqword(0x30), peb = __readgsqword(0x60);
    DWORD slot = TlsAlloc(); TlsSetValue(slot, (void *)0x1234ABCD);
    SetLastError(77);
    int tok = teb && *(u64 *)(peb + 0x10) == (u64)GetModuleHandleA(0) && *(DWORD *)(teb + 0x68) == 77
        && TlsGetValue(slot) == (void *)0x1234ABCD && *(u64 *)(teb + 0x1480 + 8 * slot) == 0x1234ABCD;
    if (!tok) fails++;
    pr("[%s] TEB %llx, PEB %llx, TLS slot %u\n", tok ? "ok" : "FAIL", teb, peb, slot);

    /* DLL: implicit import (code + data), explicit LoadLibrary/GetProcAddress */
    long long m = dll_mix(7, 9);
    HMODULE h = LoadLibraryA("testdll.dll");
    const char *(*nm)(int) = (const char *(*)(int))GetProcAddress(h, "dll_name");
    int dok = m == 7 * 1000003 + (9 ^ 0x5555) + 43 && dll_counter == 43 && nm && nm(2)[0] == 't' && nm(2)[1] == 'w';
    if (!dok) fails++;
    pr("[%s] DLL at %llx: mix %lld, counter %d, name(2) %s\n", dok ? "ok" : "FAIL", (u64)h, m, dll_counter, nm ? nm(2) : "?");

    /* heap: many small blocks */
    HANDLE heap = GetProcessHeap();
    void **list = 0; u64 hsum = 0;
    for (int i = 0; i < 20000; i++) {
        void **b = HeapAlloc(heap, HEAP_ZERO_MEMORY, 16 + (i % 200));
        b[0] = list; b[1] = (void *)(u64)i; list = b;
    }
    for (int i = 0; list; i++) { void **n = list[0]; hsum += (u64)list[1]; if (i % 2) HeapFree(heap, 0, list); list = n; }
    int hok = hsum == 20000ULL * 19999 / 2; if (!hok) fails++;
    pr("[%s] heap: 20000 blocks, sum %llu\n", hok ? "ok" : "FAIL", hsum);

    /* workloads checked against the host build */
    DWORD t;
    t = GetTickCount(); u64 a = work_int(); check("integers", a, EXP_INT, GetTickCount() - t);
    t = GetTickCount(); a = work_sort(); check("sort (indirect calls)", a, EXP_SORT, GetTickCount() - t);
    t = GetTickCount(); a = work_float(); check("floating point (SSE2)", a, EXP_FLOAT, GetTickCount() - t);
    unsigned char *buf = VirtualAlloc(0, 4 << 20, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    t = GetTickCount(); a = work_mem(buf, 4 << 20); check("memory copy/fill (vectorized)", a, EXP_MEM, GetTickCount() - t);
    VirtualFree(buf, 0, MEM_RELEASE);
    pr("[fp] pi ~ %f, sqrt(2) ~ %f\n", 3.14159265358979, __builtin_sqrt(2.0));

    QueryPerformanceCounter(&c1);
    pr("[time] %llu ms by QueryPerformanceCounter\n", (u64)((c1.QuadPart - c0.QuadPart) * 1000 / f0.QuadPart));
    pr(fails ? "RESULT: FAIL (%d)\n" : "RESULT: OK\n", fails);
    ExitProcess(fails);
}
