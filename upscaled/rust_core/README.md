# Upscaled Rust Core

Local Rust companion for the Python Upscaled workflow. It handles image metadata inspection, file hashing, progressive scale planning, and Lanczos resizing without cloud credentials.

```powershell
cd upscaled/rust_core
cargo run -- inspect path\to\image.png
cargo run -- plan --long-edge 1200 --target 4800
cargo run -- resize path\to\image.png output\image.png --scale 2
```

The Python pipeline remains the production implementation for cloud model execution, tiled inference, color management, and PDF delivery.