// Compiles the "Wine side" C code to a wasm object and links it in.
use std::process::Command;
fn main() {
    let mt = std::env::var("CARGO_CFG_TARGET_FEATURE").unwrap_or_default().split(',').any(|f| f == "atomics");
    let out = std::env::var("OUT_DIR").unwrap();
    let obj = format!("{}/wine.o", out);
    let ok = Command::new("clang")
        .args(["--target=wasm32-unknown-unknown", "-O2", "-ffreestanding", "-nostdlib", "-c", "wine/ntdll_proof.c", "-o", &obj])
        // the multi-core build links with a shared memory: every object needs atomics
        .args(if mt { &["-matomics", "-mbulk-memory"][..] } else { &[][..] })
        .status().expect("clang").success();
    assert!(ok, "clang failed");
    println!("cargo:rustc-link-arg={}", obj);
    // keep 1-4 MB of wasm memory free for wine.wasm (its data and stack)
    println!("cargo:rustc-link-arg=--global-base=4194304");
    // the JIT adds its compiled blocks to the function table
    println!("cargo:rustc-link-arg=--export-table");
    println!("cargo:rustc-link-arg=--growable-table");
    if mt {
        // several workers share one memory; each sets its own stack and thread-local area
        for a in ["--shared-memory", "--import-memory", "--max-memory=4294967296", "--export=__wasm_init_tls", "--export=__tls_size", "--export=__tls_align", "--export=__stack_pointer"] {
            println!("cargo:rustc-link-arg={}", a);
        }
    }
    println!("cargo:rerun-if-changed=wine/ntdll_proof.c");
}
