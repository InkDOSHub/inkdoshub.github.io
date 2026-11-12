/* Test DLL: exports code and data, has its own relocations. */
__declspec(dllexport) int dll_counter = 40;
__declspec(dllexport) long long __cdecl dll_mix(long long a, long long b) { dll_counter++; return a * 1000003 + (b ^ 0x5555) + dll_counter; }
static const char *names[] = { "zero", "one", "two" };   /* pointers in data = relocations */
__declspec(dllexport) const char *__cdecl dll_name(int i) { return names[i % 3]; }
int __stdcall DllMainCRTStartup(void *h, unsigned reason, void *r) { if (reason == 1) dll_counter += 2; return 1; }
