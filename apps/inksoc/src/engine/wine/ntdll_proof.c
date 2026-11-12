/* Stand-in for Wine PE code compiled straight to wasm.
 * Every access to program memory goes through the engine's page table
 * (GUEST_U8 / GUEST_U32), which is what the planned compiler pass will
 * insert automatically when building real Wine DLLs. */
typedef unsigned long long u64;
typedef unsigned int u32;
typedef unsigned char u8;

extern u8 guest_read8(u64 addr);
extern u32 guest_read32(u64 addr);
#define GUEST_U8(p) guest_read8(p)
#define GUEST_U32(p) guest_read32(p)

static u32 crc_table[256];
static int crc_ready;

static void crc_init(void) {
    for (u32 i = 0; i < 256; i++) {
        u32 c = i;
        for (int k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
        crc_table[i] = c;
    }
    crc_ready = 1;
}

/* ntdll!RtlComputeCrc32 (same result as Windows/Wine) */
u32 wine_RtlComputeCrc32(u32 initial, u64 data, int len) {
    if (!crc_ready) crc_init();
    u32 crc = ~initial;
    while (len >= 4) {
        u32 w = GUEST_U32(data);
        for (int k = 0; k < 4; k++) { crc = crc_table[(crc ^ w) & 0xff] ^ (crc >> 8); w >>= 8; }
        data += 4; len -= 4;
    }
    while (len-- > 0) crc = crc_table[(crc ^ GUEST_U8(data++)) & 0xff] ^ (crc >> 8);
    return ~crc;
}

/* kernel32!lstrlenA */
int wine_lstrlenA(u64 s) {
    if (!s) return 0;
    int n = 0;
    while (GUEST_U8(s + n)) n++;
    return n;
}
