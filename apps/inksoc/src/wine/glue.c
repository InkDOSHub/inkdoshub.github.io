/* InkSoC glue for Wine's msvcrt compiled to wasm.
 *
 * Built like the Wine sources: as x86-64 Windows code (so every struct and
 * va_list matches what the program sees), then retargeted to wasm64. Every
 * load and store then goes through the engine's page table, so a pointer
 * from the program can be used as is, even when its page is in swap.
 *
 * This file provides what the slice of msvcrt needs from the rest of Wine
 * (a fixed "C" locale, per-thread data, a few kernel32 calls) and the entry
 * point the engine calls (ink_call).
 */

#include <stdarg.h>
#include "msvcrt.h"
#include "winnls.h"
#include "wine/debug.h"

/* From the engine (see wine_* exports in the Rust engine) */
void ink_output(INT64 stream, const char *buf, int len);
double ink_log10(double x);

/* ---- fixed "C" locale ---- */
static struct lconv c_lconv = { (char *)".", (char *)"", (char *)"", (char *)"", (char *)"", (char *)"", (char *)"",
                                (char *)"", (char *)"", (char *)"", 127, 127, 127, 127, 127, 127, 127, 127 };
static threadlocinfo c_locinfo;
static threadmbcinfo c_mbcinfo;
static thread_data_t thread_data;
static unsigned char lower_map[256], upper_map[256];
BOOL initial_locale = TRUE;

pthreadlocinfo CDECL get_locinfo(void)
{
    if (!c_locinfo.lconv)
    {
        c_locinfo.refcount = 1;
        c_locinfo.lconv = &c_lconv;
        c_locinfo.mb_cur_max = 1;
        c_locinfo.pctype = MSVCRT__ctype + 1;
        c_locinfo.ctype1 = MSVCRT__ctype + 1;
        c_locinfo.lc_clike = 1;
        for (int i = 0; i < 256; i++)
        {
            lower_map[i] = i >= 'A' && i <= 'Z' ? i + 32 : i;
            upper_map[i] = i >= 'a' && i <= 'z' ? i - 32 : i;
        }
        c_locinfo.pclmap = lower_map;
        c_locinfo.pcumap = upper_map;
    }
    return &c_locinfo;
}

thread_data_t *CDECL msvcrt_get_thread_data(void) { return &thread_data; }
int *CDECL _errno(void) { return &thread_data.thread_errno; }
void CDECL _invalid_parameter(const wchar_t *expr, const wchar_t *func, const wchar_t *file, unsigned int line, uintptr_t arg) {}
unsigned int CDECL _get_output_format(void) { return 0; }

_locale_t CDECL get_current_locale_noalloc(_locale_t locale)
{
    locale->locinfo = get_locinfo();
    locale->mbcinfo = &c_mbcinfo;
    return locale;
}
void CDECL free_locale_noalloc(_locale_t locale) {}

int CDECL _mbtowc_l(wchar_t *dst, const char *str, size_t n, _locale_t locale)
{
    if (!str || !n) return 0;
    if (dst) *dst = (unsigned char)*str;
    return *str ? 1 : 0;
}

/* ---- the few Windows calls this slice reaches (only for non-C locales or wide text) ---- */
INT WINAPI CompareStringA(LCID l, DWORD f, LPCSTR a, INT na, LPCSTR b, INT nb) { return 2; }
INT WINAPI CompareStringW(LCID l, DWORD f, LPCWSTR a, INT na, LPCWSTR b, INT nb) { return 2; }
INT WINAPI LCMapStringA(LCID l, DWORD f, LPCSTR s, INT ns, LPSTR d, INT nd) { return 0; }
INT WINAPI LCMapStringW(LCID l, DWORD f, LPCWSTR s, INT ns, LPWSTR d, INT nd) { return 0; }
int CDECL __crtLCMapStringA(LCID l, DWORD f, const char *s, int ns, char *d, int nd, unsigned int cp, int x) { return 0; }
BOOL WINAPI GetStringTypeW(DWORD t, LPCWSTR s, INT n, LPWORD out) { return FALSE; }
BOOL WINAPI GetStringTypeExA(LCID l, DWORD t, LPCSTR s, INT n, LPWORD out) { return FALSE; }
BOOL WINAPI IsBadStringPtrA(LPCSTR s, UINT_PTR n) { return FALSE; }
BOOL WINAPI IsBadStringPtrW(LPCWSTR s, UINT_PTR n) { return FALSE; }
INT WINAPI WideCharToMultiByte(UINT cp, DWORD f, LPCWSTR src, INT ns, LPSTR dst, INT nd, LPCSTR def, LPBOOL used)
{
    int i, n = ns < 0 ? 0 : ns;
    if (ns < 0) while (src[n]) n++;
    if (ns < 0) n++;
    if (!nd) return n;
    for (i = 0; i < n && i < nd; i++) dst[i] = src[i] < 0x80 ? (char)src[i] : '?';
    return i;
}

const char * __cdecl __wine_dbg_strdup(const char *str) { return str; }
int __cdecl __wine_dbg_output(const char *str) { return 0; }
int __cdecl __wine_dbg_header(enum __wine_debug_class cls, struct __wine_debug_channel *channel, const char *function) { return -1; }

LPVOID WINAPI HeapAlloc(HANDLE h, DWORD flags, SIZE_T size)
{
    char *p = malloc(size);
    if (p && (flags & HEAP_ZERO_MEMORY)) memset(p, 0, size);
    return p;
}
BOOL WINAPI HeapFree(HANDLE h, DWORD flags, LPVOID p) { free(p); return TRUE; }

/* ---- math the formatter needs ---- */
double CDECL floor(double x) { return __builtin_floor(x); }
double CDECL log10(double x) { return ink_log10(x); }
double CDECL frexp(double x, int *e)
{
    union { double d; UINT64 u; } v = { x };
    int ex = (int)((v.u >> 52) & 0x7ff);
    if (ex == 0)
    {
        if (x == 0) { *e = 0; return x; }
        v.d = x * 18446744073709551616.0; /* 2^64 */
        ex = (int)((v.u >> 52) & 0x7ff) - 64;
    }
    else if (ex == 0x7ff) { *e = 0; return x; }
    *e = ex - 1022;
    v.u = (v.u & ~(0x7ffULL << 52)) | (1022ULL << 52);
    return v.d;
}

/* 128-bit multiply (compiler runtime helper) */
typedef struct { UINT64 lo, hi; } u128_t;
u128_t __multi3(UINT64 alo, UINT64 ahi, UINT64 blo, UINT64 bhi)
{
    UINT64 a0 = (UINT32)alo, a1 = alo >> 32, b0 = (UINT32)blo, b1 = blo >> 32;
    UINT64 p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
    UINT64 mid = (p00 >> 32) + (UINT32)p01 + (UINT32)p10;
    u128_t r;
    r.lo = (mid << 32) | (UINT32)p00;
    r.hi = p11 + (p01 >> 32) + (p10 >> 32) + (mid >> 32) + alo * bhi + ahi * blo;
    return r;
}

/* ---- printing to the program's streams ---- */
static char outbuf[65536];

static int vprint_to(INT64 stream, const char *fmt, va_list va)
{
    int n = _vsnprintf(outbuf, sizeof(outbuf), fmt, va);
    if (n < 0) n = sizeof(outbuf);
    ink_output(stream, outbuf, n);
    return n;
}

/* ---- entry point: the engine calls msvcrt functions by number ---- */
#define P(x) ((void *)(x))
#define S(x) ((char *)(x))
#define I(x) ((int)(x))
#define W(x) ((wchar_t *)(x))

INT64 CDECL ink_call(int id, INT64 a, INT64 b, INT64 c, INT64 d)
{
    union { double f; INT64 i; } r;
    switch (id)
    {
    case 0: return strlen(S(a));
    case 1: return strcmp(S(a), S(b));
    case 2: return strncmp(S(a), S(b), c);
    case 3: return (INT64)strcpy(S(a), S(b));
    case 4: return (INT64)strncpy(S(a), S(b), c);
    case 5: return (INT64)strcat(S(a), S(b));
    case 6: return (INT64)strncat(S(a), S(b), c);
    case 7: return (INT64)strchr(S(a), I(b));
    case 8: return (INT64)strrchr(S(a), I(b));
    case 9: return (INT64)strstr(S(a), S(b));
    case 10: return strtol(S(a), P(b), I(c));
    case 11: return strtoul(S(a), P(b), I(c));
    case 12: return atoi(S(a));
    case 13: return atol(S(a));
    case 14: return (INT64)_strdup(S(a));
    case 15: return toupper(I(a));
    case 16: return tolower(I(a));
    case 17: return isspace(I(a));
    case 18: return isdigit(I(a));
    case 19: return isalpha(I(a));
    case 20: return isalnum(I(a));
    case 21: return isupper(I(a));
    case 22: return islower(I(a));
    case 23: return _stricmp(S(a), S(b));
    case 24: return _strnicmp(S(a), S(b), c);
    case 25: return strspn(S(a), S(b));
    case 26: return strcspn(S(a), S(b));
    case 27: return (INT64)strpbrk(S(a), S(b));
    case 28: return (INT64)strtok(S(a), S(b));
    case 29: return (INT64)memchr(P(a), I(b), c);
    case 30: r.f = strtod(S(a), P(b)); return r.i;
    case 31: r.f = atof(S(a)); return r.i;
    case 32: return _vsnprintf(S(a), b, S(c), (va_list)d);
    case 33: return vsprintf(S(a), S(b), (va_list)c);
    case 34: return vprint_to(a, S(b), (va_list)c);
    case 35: return memcmp(P(a), P(b), c);
    case 36: return (INT64)_itoa(I(a), S(b), I(c));
    case 37: return wcslen(W(a));
    case 38: return wcscmp(W(a), W(b));
    case 39: return wcsncmp(W(a), W(b), c);
    case 40: return (INT64)wcscpy(W(a), W(b));
    case 41: return (INT64)wcscat(W(a), W(b));
    case 42: return (INT64)wcschr(W(a), (wchar_t)b);
    case 43: return (INT64)wcsrchr(W(a), (wchar_t)b);
    case 44: return (INT64)wcsstr(W(a), W(b));
    case 45: return _wcsicmp(W(a), W(b));
    case 46: return towupper((wint_t)a);
    case 47: return towlower((wint_t)a);
    case 48: return wcstol(W(a), P(b), I(c));
    case 49: return (INT64)wcsncpy(W(a), W(b), c);
    case 50: return _wcsnicmp(W(a), W(b), c);
    case 51: return (INT64)_wcsdup(W(a));
    case 52: return wcstoul(W(a), P(b), I(c));
    }
    return 0;
}
