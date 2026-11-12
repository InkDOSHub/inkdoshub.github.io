/* Platform-independent workloads. Built for Windows (test exe) and for the
   host (to get the expected results). */
#include "core.h"

void *mem_set(void *d, int c, size_t n) { unsigned char *p = d; while (n--) *p++ = (unsigned char)c; return d; }
void *mem_cpy(void *d, const void *s, size_t n) { unsigned char *p = d; const unsigned char *q = s; while (n--) *p++ = *q++; return d; }

u64 work_int(void) {
    /* sieve + xorshift + division mix */
    static unsigned char sieve[200000];
    mem_set(sieve, 1, sizeof sieve);
    u64 count = 0, sum = 0;
    for (u32 i = 2; i < sizeof sieve; i++) {
        if (!sieve[i]) continue;
        count++; sum += i;
        for (u32 j = i * 2; j < sizeof sieve; j += i) sieve[j] = 0;
    }
    u64 x = 0x9E3779B97F4A7C15ULL, h = 0;
    for (int i = 0; i < 300000; i++) {
        x ^= x << 13; x ^= x >> 7; x ^= x << 17;
        h = h * 31 + (x % 1000003) + (u64)((i64)x / -977) + (x >> 59 ? __builtin_popcountll(x) : 0);
    }
    return count * 1000000007ULL ^ sum ^ h;
}

static int cmp_u32(const void *a, const void *b) { u32 x = *(const u32 *)a, y = *(const u32 *)b; return x < y ? -1 : x > y; }
static void sort_u32(u32 *v, int n) {
    /* simple shell sort through a function pointer (indirect calls) */
    int (*cmp)(const void *, const void *) = cmp_u32;
    for (int gap = n / 2; gap > 0; gap /= 2)
        for (int i = gap; i < n; i++)
            for (int j = i; j >= gap && cmp(&v[j - gap], &v[j]) > 0; j -= gap) { u32 t = v[j]; v[j] = v[j - gap]; v[j - gap] = t; }
}

u64 work_sort(void) {
    static u32 v[20000];
    u32 s = 12345;
    for (int i = 0; i < 20000; i++) { s = s * 1103515245u + 12345u; v[i] = s >> 3; }
    sort_u32(v, 20000);
    u64 h = 0;
    for (int i = 0; i < 20000; i += 97) h = h * 1315423911u + v[i];
    return h;
}

u64 work_float(void) {
    /* mandelbrot 96x64, pi series, sqrt/convert mix */
    u64 it = 0;
    for (int py = 0; py < 64; py++)
        for (int px = 0; px < 96; px++) {
            double cx = -2.0 + px * (3.0 / 96), cy = -1.0 + py * (2.0 / 64), zx = 0, zy = 0;
            int k = 0;
            while (k < 200 && zx * zx + zy * zy < 4.0) { double t = zx * zx - zy * zy + cx; zy = 2 * zx * zy + cy; zx = t; k++; }
            it += k;
        }
    double pi = 0;
    for (int i = 0; i < 200000; i++) pi += (i & 1 ? -4.0 : 4.0) / (2 * i + 1);
    float f = 1.0f; double r = 0;
    for (int i = 1; i < 2000; i++) { f = f * 1.0001f + 0.5f / i; r += __builtin_sqrt((double)i) / (f + 1); }
    long long ip = (long long)(pi * 1e12), ir = (long long)(r * 1e6);
    return it * 1000003ULL ^ (u64)ip ^ ((u64)ir << 20) ^ (u64)(i64)(-r * 1000);
}

u64 work_mem(unsigned char *buf, size_t n) {
    /* copies and fills of a large buffer (the compiler vectorizes these loops) */
    for (size_t i = 0; i < n; i++) buf[i] = (unsigned char)(i * 7 + (i >> 9));
    for (int round = 0; round < 4; round++) {
        mem_cpy(buf + n / 2, buf, n / 2 - 64);
        u32 *w = (u32 *)buf;
        for (size_t i = 0; i < n / 4; i++) w[i] = w[i] * 3 + (u32)round + (w[(i * 7) % (n / 4)] >> 5);
    }
    u64 h = 1469598103934665603ULL;
    for (size_t i = 0; i < n; i += 13) h = (h ^ buf[i]) * 1099511628211ULL;
    return h;
}
