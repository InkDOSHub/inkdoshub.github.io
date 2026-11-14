// The display driver kernel interface (D3DKMT*, NtGdiDdDDI* calls): one adapter and its
// devices, enough for wined3d to find the screen it draws on.

use super::*;

const ADAPTER: u32 = 0x4000_0001;
const ADAPTER_LUID: u32 = 0x10;

impl Engine {
    /// Answers the D3DKMT calls this layer knows; None for the rest.
    pub(super) fn d3dkmt(&mut self, name: &str, desc: u64) -> Option<u64> {
        use crate::status::*;
        Some(match name {
            "NtGdiDdDDIOpenAdapterFromLuid" => {
                self.w32(desc + 8, ADAPTER);
                OK
            }
            "NtGdiDdDDIOpenAdapterFromGdiDisplayName" | "NtGdiDdDDIOpenAdapterFromHdc" => {
                // (DeviceName[32], hAdapter, LUID, VidPnSourceId); the hdc form starts with the hdc
                let at = if name.ends_with("Hdc") { desc + 8 } else { desc + 64 };
                self.w32(at, ADAPTER);
                self.w32(at + 4, ADAPTER_LUID);
                self.w32(at + 8, 0);
                self.w32(at + 12, 0);
                OK
            }
            "NtGdiDdDDICreateDevice" => {
                self.s.next_luid += 1;
                let h = 0x4000_1000 + self.s.next_luid as u32;
                self.w32(desc + 12, h);
                OK
            }
            "NtGdiDdDDIQueryVideoMemoryInfo" => {
                let budget: u64 = 1 << 30;
                self.w64(desc + 16, budget);
                self.w64(desc + 24, 0);
                self.w64(desc + 32, 0);
                self.w64(desc + 40, budget);
                OK
            }
            "NtGdiDdDDICloseAdapter" | "NtGdiDdDDIDestroyDevice" | "NtGdiDdDDISetVidPnSourceOwner" | "NtGdiDdDDISetQueuedLimit"
            | "NtGdiDdDDICheckVidPnExclusiveOwnership" => OK,
            _ => return None,
        })
    }
}
