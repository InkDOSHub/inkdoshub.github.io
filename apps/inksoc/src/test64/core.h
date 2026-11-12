#pragma once
typedef unsigned long long u64; typedef long long i64; typedef unsigned int u32;
#include <stddef.h>
void *mem_set(void *d, int c, size_t n);
void *mem_cpy(void *d, const void *s, size_t n);
u64 work_int(void); u64 work_sort(void); u64 work_float(void);
u64 work_mem(unsigned char *buf, size_t n);
