fn main() {
    println!("cargo:rerun-if-changed=../proto/ai_sidecar.proto");
    tonic_build::configure()
        .build_client(true)
        .build_server(false)
        .compile_protos(&["../proto/ai_sidecar.proto"], &["../proto"])
        .expect("failed to compile ai_sidecar.proto");

    tauri_build::build()
}
