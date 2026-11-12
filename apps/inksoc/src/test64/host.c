#include <stdio.h>
#include <stdlib.h>
#include "core.h"
int main(void) {
    unsigned char *b = malloc(4 << 20);
    printf("#define EXP_INT 0x%llxULL\n#define EXP_SORT 0x%llxULL\n#define EXP_FLOAT 0x%llxULL\n#define EXP_MEM 0x%llxULL\n",
        work_int(), work_sort(), work_float(), work_mem(b, 4 << 20));
}
