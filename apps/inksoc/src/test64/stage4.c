/* InkSoC stage 4 test: program threads and synchronization (kernel32 + msvcrt).
 * Every result is checked. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <process.h>
#include <windows.h>

static int fails;
static void check(const char *what, int ok)
{
    printf("[%s] %s\n", ok ? "ok" : "FAIL", what);
    if (!ok) fails++;
}

/* 1. four threads add to one counter under a critical section */
static CRITICAL_SECTION cs;
static volatile long counter;
static DWORD WINAPI adder(void *p)
{
    int i, n = (int)(INT_PTR)p;
    for (i = 0; i < n; i++)
    {
        EnterCriticalSection(&cs);
        counter++;
        LeaveCriticalSection(&cs);
    }
    return 0;
}

/* 2. _beginthreadex and exit codes */
static unsigned __stdcall answer(void *p) { return 42; }

/* 3. producer / consumer: semaphore counts items, event says "done" */
static HANDLE items, done_ev;
static volatile int queue[64], qhead, qtail, consumed_sum;
static DWORD WINAPI producer(void *p)
{
    int i;
    for (i = 1; i <= 50; i++)
    {
        queue[qtail++ & 63] = i;
        ReleaseSemaphore(items, 1, NULL);
        if (i % 10 == 0) Sleep(1);
    }
    SetEvent(done_ev);
    return 0;
}
static DWORD WINAPI consumer(void *p)
{
    int got = 0;
    while (got < 50)
    {
        if (WaitForSingleObject(items, 2000) != WAIT_OBJECT_0) return 1;
        consumed_sum += queue[qhead++ & 63];
        got++;
    }
    return 0;
}

/* 4. TLS and last error are per thread */
static DWORD tls;
static DWORD WINAPI tls_thread(void *p)
{
    TlsSetValue(tls, p);
    SetLastError((DWORD)(INT_PTR)p);
    Sleep(5);
    DWORD err = GetLastError(); /* TlsGetValue clears the last error, as on Windows */
    return (TlsGetValue(tls) == p) | (err == (DWORD)(INT_PTR)p) << 1;
}

/* 5. preemption: a thread that never waits must still let others run */
static volatile int flag_set;
static DWORD WINAPI spinner(void *p)
{
    unsigned long n = 0;
    while (!flag_set) n++;
    return n > 0;
}
static DWORD WINAPI setter(void *p) { flag_set = 1; return 0; }

/* 6. mutex and SRW lock */
static HANDLE mtx;
static SRWLOCK srw = SRWLOCK_INIT;
static volatile int inside, max_inside, inside2, max_inside2;
static DWORD WINAPI mutex_user(void *p)
{
    int i;
    for (i = 0; i < 20; i++)
    {
        WaitForSingleObject(mtx, INFINITE);
        if (++inside > max_inside) max_inside = inside;
        Sleep(0);
        inside--;
        ReleaseMutex(mtx);
        AcquireSRWLockExclusive(&srw);
        if (++inside2 > max_inside2) max_inside2 = inside2;
        SwitchToThread();
        inside2--;
        ReleaseSRWLockExclusive(&srw);
    }
    return 0;
}

static int test_main(void)
{
    HANDLE h[4];
    DWORD code, t0, i;
    printf("InkSoC stage 4 test: threads\n");

    InitializeCriticalSection(&cs);
    for (i = 0; i < 4; i++) h[i] = CreateThread(NULL, 0, adder, (void *)(INT_PTR)100000, 0, NULL);
    check("WaitForMultipleObjects (all)", WaitForMultipleObjects(4, h, TRUE, INFINITE) == WAIT_OBJECT_0);
    printf("     counter %ld\n", counter);
    check("4 threads, critical section: counter 400000", counter == 400000);
    for (i = 0; i < 4; i++) CloseHandle(h[i]);

    {
        unsigned tid;
        HANDLE t = (HANDLE)_beginthreadex(NULL, 0, answer, NULL, 0, &tid);
        WaitForSingleObject(t, INFINITE);
        check("_beginthreadex + GetExitCodeThread = 42", tid != 0 && GetExitCodeThread(t, &code) && code == 42);
    }

    {
        DWORD c;
        HANDLE t = CreateThread(NULL, 0, (LPTHREAD_START_ROUTINE)answer, NULL, CREATE_SUSPENDED, NULL);
        GetExitCodeThread(t, &c);
        check("CREATE_SUSPENDED waits for ResumeThread", c == STILL_ACTIVE && WaitForSingleObject(t, 20) == WAIT_TIMEOUT);
        ResumeThread(t);
        check("ResumeThread", WaitForSingleObject(t, 1000) == WAIT_OBJECT_0);
    }

    items = CreateSemaphoreW(NULL, 0, 64, NULL);
    done_ev = CreateEventW(NULL, TRUE, FALSE, NULL);
    h[0] = CreateThread(NULL, 0, consumer, NULL, 0, NULL);
    h[1] = CreateThread(NULL, 0, producer, NULL, 0, NULL);
    WaitForMultipleObjects(2, h, TRUE, INFINITE);
    GetExitCodeThread(h[0], &code);
    check("producer/consumer (semaphore): sum 1275", code == 0 && consumed_sum == 1275);
    check("manual-reset event stays set", WaitForSingleObject(done_ev, 0) == WAIT_OBJECT_0 && WaitForSingleObject(done_ev, 0) == WAIT_OBJECT_0);

    {
        HANDLE ev = CreateEventW(NULL, FALSE, FALSE, NULL);
        t0 = GetTickCount();
        check("wait with timeout", WaitForSingleObject(ev, 30) == WAIT_TIMEOUT);
        check("Sleep(50) really waits", (Sleep(50), GetTickCount() - t0 >= 70));
        SetEvent(ev);
        check("auto-reset event resets", WaitForSingleObject(ev, 0) == WAIT_OBJECT_0 && WaitForSingleObject(ev, 0) == WAIT_TIMEOUT);
    }

    tls = TlsAlloc();
    TlsSetValue(tls, (void *)7);
    SetLastError(7);
    for (i = 0; i < 3; i++) h[i] = CreateThread(NULL, 0, tls_thread, (void *)(INT_PTR)(100 + i), 0, NULL);
    WaitForMultipleObjects(3, h, TRUE, INFINITE);
    {
        DWORD err = GetLastError();
        int ok = TlsGetValue(tls) == (void *)7 && err == 7;
        for (i = 0; i < 3; i++) { GetExitCodeThread(h[i], &code); ok &= code == 3; }
        check("TLS and GetLastError per thread", ok);
    }

    h[0] = CreateThread(NULL, 0, spinner, NULL, 0, NULL);
    h[1] = CreateThread(NULL, 0, setter, NULL, 0, NULL);
    check("preemption (busy thread does not block others)", WaitForSingleObject(h[0], 5000) == WAIT_OBJECT_0);

    mtx = CreateMutexW(NULL, FALSE, NULL);
    for (i = 0; i < 3; i++) h[i] = CreateThread(NULL, 0, mutex_user, NULL, 0, NULL);
    WaitForMultipleObjects(3, h, TRUE, INFINITE);
    check("mutex: one thread inside at a time", max_inside == 1);
    check("SRW lock: one thread inside at a time", max_inside2 == 1);

    {
        HANDLE ev = CreateEventW(NULL, FALSE, FALSE, NULL), two[2];
        two[0] = ev;
        two[1] = CreateThread(NULL, 0, (LPTHREAD_START_ROUTINE)answer, NULL, 0, NULL);
        check("WaitForMultipleObjects (any) returns the thread", WaitForMultipleObjects(2, two, FALSE, INFINITE) == WAIT_OBJECT_0 + 1);
    }

    printf("RESULT: %s (%d failed)\n", fails ? "FAILED" : "OK", fails);
    return fails;
}

void _pei386_runtime_relocator(void);
int atexit(void (*f)(void)) { return 0; }
void start(void) { _pei386_runtime_relocator(); exit(test_main()); }
