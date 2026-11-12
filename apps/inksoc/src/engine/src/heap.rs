// Process heap (HeapAlloc & co.) living in program memory.
// Small blocks: power-of-two size classes carved from 16 MB arenas (pages
// get real RAM only when touched). Large blocks: their own region.

use crate::Engine;
use std::collections::HashMap;

const ARENA: u64 = 16 << 20;
const MAX_SMALL: u64 = 64 << 10;

#[derive(Default)]
pub struct Heap {
    free: Vec<Vec<u64>>,
    bump: u64,
    bump_end: u64,
    sizes: HashMap<u64, u64>, // block -> requested size (for HeapSize / ReAlloc)
    large: HashMap<u64, u64>, // block -> region size
}

fn class(size: u64) -> usize { (size.max(16).next_power_of_two().trailing_zeros() - 4) as usize }

impl Engine {
    pub fn heap_alloc(&mut self, size: u64, zero: bool) -> u64 {
        if size > MAX_SMALL {
            let Some(a) = self.alloc(size) else { return 0 };
            self.s.heap.large.insert(a, size);
            self.s.heap.sizes.insert(a, size);
            return a;
        }
        let c = class(size);
        let csize = 16u64 << c;
        if self.s.heap.free.len() <= c { self.s.heap.free.resize(c + 1, Vec::new()); }
        let a = if let Some(a) = self.s.heap.free[c].pop() {
            if zero { for i in (0..csize).step_by(8) { let _ = self.mmu.write64(a + i, 0); } }
            a
        } else {
            if self.s.heap.bump + csize > self.s.heap.bump_end {
                let Some(r) = self.alloc(ARENA) else { return 0 };
                self.s.heap.bump = r;
                self.s.heap.bump_end = r + ARENA;
            }
            let a = self.s.heap.bump;
            self.s.heap.bump += csize;
            a // fresh arena memory is already zero
        };
        self.s.heap.sizes.insert(a, size);
        a
    }

    pub fn heap_free(&mut self, a: u64) -> bool {
        let Some(size) = self.s.heap.sizes.remove(&a) else { return false };
        if self.s.heap.large.remove(&a).is_some() {
            self.mmu.release_region(a);
        } else {
            self.s.heap.free[class(size)].push(a);
        }
        true
    }

    pub fn heap_size(&self, a: u64) -> u64 { self.s.heap.sizes.get(&a).copied().unwrap_or(u64::MAX) }

    pub fn heap_realloc(&mut self, a: u64, size: u64, zero: bool) -> u64 {
        let old = self.heap_size(a);
        if old == u64::MAX { return 0; }
        if size <= MAX_SMALL && old <= MAX_SMALL && class(size) == class(old) {
            if zero && size > old { for i in old..size { let _ = self.mmu.write8(a + i, 0); } }
            self.s.heap.sizes.insert(a, size);
            return a;
        }
        let n = self.heap_alloc(size, zero);
        if n == 0 { return 0; }
        let k = old.min(size);
        let mut i = 0;
        while i + 8 <= k { let v = self.mmu.read64(a + i).unwrap_or(0); let _ = self.mmu.write64(n + i, v); i += 8; }
        while i < k { let v = self.mmu.read8(a + i).unwrap_or(0); let _ = self.mmu.write8(n + i, v); i += 1; }
        self.heap_free(a);
        n
    }
}
