// x86 memory-order check for several cores (InkSoC). Prints violations; all must be 0.
#include <windows.h>
#include <stdio.h>
#define N 2000000
static volatile LONG64 data, flag;
static volatile LONG lk;
static volatile LONG64 counter, icount;
static volatile LONG go;
static LONG64 bad;
static DWORD WINAPI writer(LPVOID p) { while (!go); for (LONG64 i = 1; i <= N; i++) { data = i; flag = i; } return 0; }
static DWORD WINAPI reader(LPVOID p) {
  while (!go); LONG64 b = 0, f = 0;
  while (f < N) { f = flag; LONG64 d = data; if (d < f) b++; }
  bad = b; return 0;
}
static DWORD WINAPI locker(LPVOID p) {
  while (!go);
  for (int i = 0; i < N / 4; i++) {
    while (InterlockedCompareExchange(&lk, 1, 0) != 0) YieldProcessor();
    counter = counter + 1;      // plain read and write inside the lock
    lk = 0;                     // plain store releases it (as compilers emit)
    InterlockedIncrement64(&icount);
  }
  return 0;
}
static void run(LPTHREAD_START_ROUTINE *f, int n) {
  HANDLE h[8]; go = 0;
  for (int i = 0; i < n; i++) h[i] = CreateThread(0, 0, f[i], 0, 0, 0);
  go = 1; WaitForMultipleObjects(n, h, TRUE, INFINITE);
  for (int i = 0; i < n; i++) CloseHandle(h[i]);
}
int main(void) {
  SYSTEM_INFO si; GetSystemInfo(&si);
  printf("Processors: %lu\n", si.dwNumberOfProcessors);
  DWORD t0 = GetTickCount();
  LPTHREAD_START_ROUTINE mp[2] = { writer, reader };
  run(mp, 2);
  printf("Message passing: %lld stale reads of %d (must be 0)\n", bad, N);
  LPTHREAD_START_ROUTINE lks[4] = { locker, locker, locker, locker };
  run(lks, 4);
  printf("Spinlock counter: %lld of %d (lost %lld, must be 0)\n", counter, N, N - counter);
  printf("Interlocked counter: %lld of %d (lost %lld, must be 0)\n", icount, N, N - icount);
  int ok = bad == 0 && counter == N && icount == N;
  printf("RESULT: %s (%lu ms)\n", ok ? "OK" : "FAILED", GetTickCount() - t0);
  return !ok;
}
