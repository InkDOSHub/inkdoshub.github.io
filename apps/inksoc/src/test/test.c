/* InkSoC proof test: tiny x86-64 Windows program (no CRT). */
typedef unsigned long long u64;
typedef unsigned int u32;
typedef unsigned char u8;

__declspec(dllimport) void* __stdcall VirtualAlloc(void* addr, u64 size, u32 type, u32 prot);
__declspec(dllimport) u32 __stdcall GetTickCount(void);
__declspec(dllimport) int __stdcall WriteConsoleA(void* h, const char* s, u32 n, u32* written, void* r);
__declspec(dllimport) void* __stdcall GetStdHandle(u32 n);
__declspec(dllimport) int __stdcall lstrlenA(const char* s);
__declspec(dllimport) u32 __stdcall RtlComputeCrc32(u32 init, const u8* data, int len);
__declspec(dllimport) void __stdcall ExitProcess(u32 code);
/* Size of the memory test in MB, patched by the host before loading. */
volatile u32 test_mb = 512;

static void *out;
static void print(const char *s) { u32 w; WriteConsoleA(out, s, lstrlenA(s), &w, 0); }
static void printn(u64 v) {
    char b[24]; int i = 23; b[i] = 0;
    do { b[--i] = '0' + (char)(v % 10); v /= 10; } while (v);
    print(b + i);
}
static void printh(u64 v) {
    char b[20]; int i = 19; b[i] = 0;
    do { int d = (int)(v & 15); b[--i] = d < 10 ? '0' + d : 'a' + d - 10; v >>= 4; } while (v);
    print("0x"); print(b + i);
}

void start(void) {
    out = GetStdHandle((u32)-11);
    print("InkSoC proof: x86-64 test program\n");

    /* 1. CPU: integer loop (sieve + xorshift) */
    u32 t0 = GetTickCount();
    u64 x = 88172645463325252ULL, acc = 0;
    for (u32 i = 0; i < 5000000; i++) {
        x ^= x << 13; x ^= x >> 7; x ^= x << 17;
        acc += (x & 0xffff) * 3 + (i >> 3);
    }
    u32 t1 = GetTickCount();
    print("[cpu] 5M iterations, checksum "); printh(acc);
    print(" in "); printn(t1 - t0); print(" ms\n");

    /* 2. Memory: reserve more than the real RAM pool and touch every page */
    u64 bytes = (u64)test_mb << 20;
    u8 *m = (u8 *)VirtualAlloc(0, bytes, 0x3000, 4);
    print("[mem] VirtualAlloc "); printn(test_mb); print(" MB at "); printh((u64)m); print("\n");
    if (!m) { print("[mem] FAILED\n"); ExitProcess(1); }
    t0 = GetTickCount();
    for (u64 p = 0; p < bytes; p += 4096) {
        u64 *q = (u64 *)(m + p);
        q[0] = p * 2654435761ULL; q[1] = ~p;
    }
    u64 bad = 0;
    for (u64 p = 0; p < bytes; p += 4096) {
        u64 *q = (u64 *)(m + p);
        if (q[0] != p * 2654435761ULL || q[1] != ~p) bad++;
    }
    t1 = GetTickCount();
    print("[mem] wrote+verified "); printn(bytes >> 12); print(" pages, errors: ");
    printn(bad); print(", "); printn(t1 - t0); print(" ms\n");

    /* 3. Bridge: a C function compiled to wasm reads program memory */
    t0 = GetTickCount();
    u32 crc = RtlComputeCrc32(0, m, (int)(bytes > 0x4000000 ? 0x4000000 : bytes));
    t1 = GetTickCount();
    print("[bridge] RtlComputeCrc32 over "); printn((bytes > 0x4000000 ? 0x4000000 : bytes) >> 20);
    print(" MB = "); printh(crc); print(" in "); printn(t1 - t0); print(" ms\n");

    print(bad ? "RESULT: FAIL\n" : "RESULT: OK\n");
    ExitProcess(bad ? 1 : 0);
}
