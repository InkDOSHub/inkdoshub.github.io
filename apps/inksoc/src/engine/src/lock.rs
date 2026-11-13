// The engine lock. With several cores (the multi-core build), everything
// shared — page table, Windows functions, heap, handles, threads — is used by
// one core at a time; only running program code goes in parallel. The lock is
// reentrant (a Windows function may touch a new page, which locks again).
// In the one-core build it costs nothing.

#[cfg(target_feature = "atomics")]
mod imp {
    use core::sync::atomic::{AtomicU32, Ordering::*};
    static OWNER: AtomicU32 = AtomicU32::new(0); // core id + 1, 0 = free
    static mut DEPTH: u32 = 0;
    static WAITERS: AtomicU32 = AtomicU32::new(0);
    pub const MT: bool = true;

    pub static COUNT: [AtomicU32; 4] = [AtomicU32::new(0), AtomicU32::new(0), AtomicU32::new(0), AtomicU32::new(0)];
    pub fn count_locked() { COUNT[3].fetch_add(1, Relaxed); }
    pub fn counter(i: usize) -> f64 { COUNT[i].load(Relaxed) as f64 }
    pub struct Guard(());
    pub fn lock() -> Guard {
        let me = crate::eng().core + 1;
        if OWNER.load(Relaxed) == me { unsafe { DEPTH += 1; } return Guard(()); }
        let mut spins = 0;
        let mut was_away = false;
        COUNT[0].fetch_add(1, Relaxed);
        loop {
            match OWNER.compare_exchange(0, me, Acquire, Relaxed) {
                Ok(_) => break,
                Err(cur) => {
                    spins += 1;
                    // contended: not inside program code while waiting (TLB shootdowns need not
                    // wait for us); the free lock costs no extra writes
                    if spins == 1 { COUNT[1].fetch_add(1, Relaxed); was_away = crate::mmu::is_away(me - 1); crate::mmu::away(me - 1); }
                    if spins > 64 {
                        WAITERS.fetch_add(1, SeqCst);
                        unsafe { core::arch::wasm32::memory_atomic_wait32(OWNER.as_ptr() as *mut i32, cur as i32, 1_000_000); }
                        WAITERS.fetch_sub(1, SeqCst);
                    }
                }
            }
        }
        unsafe { DEPTH = 1; }
        // back to where it was (a core called from JavaScript stays away)
        if spins != 0 && !was_away { crate::mmu::safe_point(me - 1); }
        Guard(())
    }
    impl Drop for Guard {
        fn drop(&mut self) {
            unsafe {
                DEPTH -= 1;
                if DEPTH == 0 {
                    OWNER.store(0, SeqCst);
                    // only wake a core that went to sleep on the lock (notify is not free)
                    if WAITERS.load(SeqCst) != 0 { core::arch::wasm32::memory_atomic_notify(OWNER.as_ptr() as *mut i32, 1); }
                }
            }
        }
    }

    /// Wakes idle cores (a thread may be ready to run).
    static GEN: AtomicU32 = AtomicU32::new(0);
    pub fn kick() {
        GEN.fetch_add(1, Release);
        unsafe { core::arch::wasm32::memory_atomic_notify(GEN.as_ptr() as *mut i32, u32::MAX); }
    }
    pub fn gen() -> u32 { GEN.load(Acquire) }
    /// Sleeps until kick() or `ms` pass.
    pub fn idle(g: u32, ms: f64) {
        COUNT[2].fetch_add(1, Relaxed);
        let me = crate::eng().core;
        crate::mmu::away(me);
        let ns = (ms.clamp(0.0, 50.0) * 1e6) as i64;
        unsafe { core::arch::wasm32::memory_atomic_wait32(GEN.as_ptr() as *mut i32, g as i32, ns); }
        crate::mmu::safe_point(me);
    }
}

#[cfg(not(target_feature = "atomics"))]
mod imp {
    pub const MT: bool = false;
    pub struct Guard(());
    #[inline(always)]
    pub fn lock() -> Guard { Guard(()) }
    #[inline(always)]
    pub fn kick() {}
    pub fn gen() -> u32 { 0 }
    pub fn counter(_i: usize) -> f64 { 0.0 }
    #[inline(always)]
    pub fn count_locked() {}
    pub fn idle(_g: u32, _ms: f64) {}
}

pub use imp::*;
