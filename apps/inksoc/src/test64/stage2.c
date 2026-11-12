/* InkSoC stage 2 test: a 64-bit program using the real msvcrt.dll API.
 * printf and the string functions run Wine's msvcrt code compiled to wasm;
 * malloc and FILE streams are the engine's own. Every result is checked. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <windows.h>

static int fails;
static void check(const char *what, int ok)
{
    printf("[%s] %s\n", ok ? "ok" : "FAIL", what);
    if (!ok) fails++;
}

static int test_main(void)
{
    char buf[256], *p, *q;
    printf("InkSoC stage 2 test: msvcrt from Wine, compiled to wasm\n");

    /* formatting */
    sprintf(buf, "%d|%5d|%-5d|%05d|%x|%X|%o|%u", 42, 42, 42, 42, 255, 255, 8, 3000000000u);
    check(buf, !strcmp(buf, "42|   42|42   |00042|ff|FF|10|3000000000"));
    sprintf(buf, "%lld|%I64x|%p", -1234567890123LL, 0x1122334455667788ULL, (void *)0x1234);
    check(buf, !strcmp(buf, "-1234567890123|1122334455667788|0000000000001234"));
    sprintf(buf, "%.2f|%8.3f|%e|%g|%g", 3.14159, -2.5, 12345.678, 0.0001, 1e20);
    check(buf, !strcmp(buf, "3.14|  -2.500|1.234568e+004|0.0001|1e+020"));
    sprintf(buf, "%s|%10s|%-6s|%.3s|%c%c", "wine", "right", "left", "abcdef", 'o', 'k');
    check(buf, !strcmp(buf, "wine|     right|left  |abc|ok"));
    check("snprintf truncates", _snprintf(buf, 5, "%s", "1234567890") == -1 && !memcmp(buf, "12345", 5));

    /* strings */
    strcpy(buf, "hello");
    strcat(buf, ", world");
    check("strcpy/strcat/strlen", strlen(buf) == 12 && !strcmp(buf, "hello, world"));
    check("strchr/strrchr/strstr", strchr(buf, 'o') == buf + 4 && strrchr(buf, 'o') == buf + 8 && strstr(buf, "wor") == buf + 7);
    check("strncmp/_stricmp", strncmp("abcx", "abcy", 3) == 0 && _stricmp("WiNe", "wine") == 0 && strcmp("a", "b") < 0);
    check("strtol/strtoul/atoi", strtol("-0x1f", NULL, 16) == -31 && strtoul("777", NULL, 8) == 511 && atoi("  123abc") == 123);
    check("strtod", strtod("2.5e3", &p) == 2500.0 && *p == 0 && atof("-0.125") == -0.125);
    strcpy(buf, "a,b;;c");
    q = strtok(buf, ",;");
    p = strtok(NULL, ",;");
    check("strtok", !strcmp(q, "a") && !strcmp(p, "b") && !strcmp(strtok(NULL, ",;"), "c") && !strtok(NULL, ",;"));
    check("toupper/isdigit", toupper('q') == 'Q' && isdigit('7') && !isalpha('7') && isspace('\t'));
    p = _strdup("duplicate");
    check("_strdup (Wine calls our heap)", p && !strcmp(p, "duplicate"));
    free(p);

    /* heap */
    {
        int i, ok = 1;
        int *a = malloc(1000 * sizeof(int));
        for (i = 0; i < 1000; i++) a[i] = i * 3;
        a = realloc(a, 100000 * sizeof(int));
        for (i = 0; i < 1000; i++) ok &= a[i] == i * 3;
        free(a);
        check("malloc/realloc/free", ok);
    }

    /* a string that crosses a page boundary in a VirtualAlloc block */
    {
        char *big = VirtualAlloc(NULL, 1 << 16, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        char *s = big + 4096 - 3;
        strcpy(s, "across pages");
        sprintf(big + 8192 - 5, "%s %d", s, 7);
        check("strings across pages", !strcmp(big + 8192 - 5, "across pages 7") && strlen(s) == 12);
    }

    /* files */
    {
        FILE *f = fopen("notes.txt", "w");
        fprintf(f, "line %d\n", 1);
        fputs("line 2\n", f);
        fclose(f);
        f = fopen("notes.txt", "r");
        fgets(buf, sizeof(buf), f);
        q = buf + 100;
        fgets(q, 100, f);
        fclose(f);
        check("fopen/fprintf/fgets", !strcmp(buf, "line 1\n") && !strcmp(q, "line 2\n") && !fopen("missing.txt", "r"));
    }

    printf("RESULT: %s (%d failed)\n", fails ? "FAILED" : "OK", fails);
    return fails;
}

/* mingw's own startup normally does this: patch calls that go through
   auto-imported functions (pseudo-relocations), then run the program */
void _pei386_runtime_relocator(void);
/* mingw's startup files also bring their own atexit (the program never exits through them here) */
int atexit(void (*f)(void)) { return 0; }
void start(void) { _pei386_runtime_relocator(); exit(test_main()); }
