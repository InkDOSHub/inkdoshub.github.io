// Compiles the "Wine side" C code to a wasm object and links it in.
use std::process::Command;
fn main() {
    let out = std::env::var("OUT_DIR").unwrap();
    let obj = format!("{}/wine.o", out);
    let ok = Command::new("clang")
        .args(["--target=wasm32-unknown-unknown", "-O2", "-ffreestanding", "-nostdlib", "-c", "wine/ntdll_proof.c", "-o", &obj])
        .status().expect("clang").success();
    assert!(ok, "clang failed");
    println!("cargo:rustc-link-arg={}", obj);
    println!("cargo:rerun-if-changed=wine/ntdll_proof.c");
}
