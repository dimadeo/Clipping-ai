# 5K Progressive Upscaling Pipeline — Replicate API Blueprint

| Item | Value |
|---|---|
| Target | **9000 px long edge** by default (= 150 cm @ 150 PPI, Andre's largest print format); `--target 5120` for 5K. Finalizes to **exactly** the target via supersampled trim |
| Deliverables | `upscale_pipeline.py` (library + CLI), `run_upscale.ps1` (Windows entry point), `prepare_job.ps1` / `prepare_job.py` (draft check), `requirements.txt`, `.env` / `.env.example`, this document, `CHANGELOG.md`. Print-shop output: `<original name>_<W>x<H>cm_<ppi>ppi.pdf` (or `.tif`) + `_SPEC.txt`; `tiff_to_pdf.py` for TIFFs already delivered |
| Deploy path | `C:\Users\andre\Upscaled\` → `input\`, `output\`, `work\`, `.env` |
| Verified against | `replicate==1.0.7`, Pillow 12 (+littlecms), numpy 2, model schemas pulled from replicate.com on **2026-09-14**; pipeline v1.4.2 (history in `CHANGELOG.md`) |
| Default cost | **~$0.002–0.07 per image** (Real-ESRGAN at $0.002/call; a tiled second pass is ~12–35 calls); Topaz/Clarity options **$0.03–0.10+** |

---

## 1. Workflow architecture & pipeline

```
 input/*.{jpg,png,webp,tif,bmp}
        │
        ▼
 ┌─────────────────────────┐   fail ─► ValidationError (image skipped, batch continues)
 │ 1. INPUT VALIDATION     │
 │ verify() · EXIF bake ·  │──► work/<stem>/pass0_source.png  +  ImageMeta{w,h,mode,sha256}
 │ mode → RGB/RGBA · floor │
 └─────────────────────────┘
        │
        ▼ (optional, --face-restore)
 ┌─────────────────────────┐
 │ 2. MODEL INFERENCE      │   sczhou/codeformer, upscale=1, fidelity 0.7
 │ face restoration @1x    │──► work/<stem>/pass0_face_restored.png
 └─────────────────────────┘
        │
        ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ 3. PROGRESSIVE UPSCALING (dynamic loop)                                  │
 │   measure long edge L ──► L ≥ 5120 ? ──yes──► exit loop                  │
 │        │ no                                                              │
 │   guards: api_passes < 3 · wall-clock < budget · progress check          │
 │   remaining = 5120 / L · factor = min(4.0, remaining × 1.01)             │
 │   factor < 1.15 ─► local Lanczos (no API call)                           │
 │   else ─► Replicate predictions.create (429/5xx backoff, wait=60)        │
 │           poll with deadline ─► download (URL expires in 1 h)            │
 │           ─► work/<stem>/pass<n>_<model>_x<f>.png                        │
 │   re-measure · QualityTracker (sharpness, round-trip PSNR, colour drift) │
 └─────────────────────────────────────────────────────────────────────────┘
        │
        ▼
 ┌─────────────────────────┐
 │ 4. OUTPUT VERIFICATION  │   exact-5120 trim · encode · embed provenance
 │ dims · aspect · verify()│──► output/<stem>_5K_<W>x<H>_<model>_<sha8>.<ext>
 │ report + manifest       │──► output/<stem>_report.json · output/manifest.jsonl
 └─────────────────────────┘
```

### Stage contracts

| Stage | Trigger | Inputs | Outputs | Hard-fail conditions |
|---|---|---|---|---|
| **1. Input Validation** | CLI invocation on file/dir (`python upscale_pipeline.py input/ --out output/`), or `run_upscale.ps1` | Source file, `PipelineConfig` | `ImageMeta` (w, h, mode, format, sha256), EXIF-normalised lossless working copy `pass0_source.png` | Unsupported extension; `Image.verify()` fails (corrupt/truncated); min side < 16 px; long edge < `ceil(5120 / 4^max_passes)` = **80 px** (mathematically unreachable) |
| **2. Model Inference** (optional) | `--face-restore` flag | Working copy | `pass0_face_restored.png` (same dims) | Model failure after retries |
| **3. Progressive Upscaling** | Long edge < 5120 after measurement | Current working image, selected `ModelProfile`, computed factor | `pass<n>_<model>_x<f>.png` (lossless), per-pass metrics dict | `max_passes` reached; wall-clock budget exceeded; two consecutive no-progress passes; non-retryable model error; `--quality-policy abort` tripped |
| **4. Output Verification / Delivery** | Loop exit (long edge ≥ target) | Last pass file, source meta + ICC, provenance, print spec | Final file (ICC + dpi embedded), `<stem>_report.json`, `manifest.jsonl` row, `_SPEC.txt` (printshop) | Trim long edge < target (or ≠ target when exact); aspect drift > 0.5 % (vs source, or vs sheet under fit); delivered PPI < `print_ppi`; ICC missing or dpi tag wrong in the written file; file fails `verify()` |

### Artefacts and naming

| Artefact | Path | Purpose |
|---|---|---|
| Working copy / passes | `work/<stem>/pass0_source.png`, `pass1_real-esrgan_x4.00.png`, `pass2_…_tiles/t000_out.png` … | Lossless audit trail; every intermediate is re-encoded to PNG so passes are comparable; tile outputs kept for audit |
| Final deliverable | `output/<stem>_<target>px_<W>x<H>_<model>_<sha8>.<png\|jpg\|webp\|tiff>` | `<sha8>` = first 8 hex of the **source** SHA-256 → idempotent re-runs skip delivered files |
| Per-image report | `output/<stem>_report.json` | Every pass: dims in/out, model, pinned version, prediction id, requested factor, attempts, quality metrics, flags |
| Batch manifest | `output/manifest.jsonl` | One row per image per run (status, dims, passes, est. cost, seconds, error) |
| Embedded provenance | PNG `tEXt:upscale_pipeline` / EXIF `ImageDescription` (jpg, webp, tiff) | JSON with source hash, models, versions, factors, flags — travels with the file |
| Print-shop file + note | `output/<original name>_<W>x<H>cm_<ppi>ppi.pdf` (default) or `.tif` + `…_SPEC.txt` | PDF: one page at print size, lossless image, ICC output intent, TrimBox/BleedBox (see *PDF delivery*). TIFF-LZW with ICC and dpi. The name gives the size the image actually prints at; tags of earlier runs are dropped from the original name; `_2`, `_3` … only when a different picture already has the name. The note carries pixel sizes, sheet, bleed, profile, SHA-256 |
| Delivery webhook (optional) | `DELIVERY_WEBHOOK_URL` | The manifest row POSTed per image as JSON (now incl. `output_sha256`, `delivery`, `print_report`), HMAC-signed when `DELIVERY_WEBHOOK_SECRET` is set |

---

## 2. Replicate model selection

All slugs, parameters, hardware and prices below were read from the live model pages on 2026-09-14. Version hashes are pinned in the script (`REPLICATE_PIN_VERSIONS=0` to float to latest).

| Profile key | Replicate slug (pinned version) | Engine | Hardware / cost | Factor control | Alpha | Artifact profile | Use for |
|---|---|---|---|---|---|---|---|
| `real-esrgan` **(default)** | `nightmareai/real-esrgan` (`b3ef1941…`) · 98.7 M runs | Real-ESRGAN x4plus (+ optional GFPGAN) | T4 · **$0.002 / image** | `scale` float 0–10 (native **4×**; other values = 4× net + Lanczos) | ✔ | Deterministic, no hallucination; slight waxiness on skin/foliage at extreme factors | Passes 1–2 of every photo; anything where fidelity to the source is the contract |
| `real-esrgan-a100` | `daanelson/real-esrgan-a100` (`f94d7ed4…`) · 16.6 M runs | Identical schema | A100-80 GB · ~$0.01 | same | ✔ | same | Automatically selected by `auto` once the working image exceeds **2.5 MP** (pass 2/3 inputs) — avoids T4 OOM |
| `clarity` | `philz1337x/clarity-upscaler` (`dfad4170…`) · 30.3 M runs | SD 1.5 + ControlNet-tile + LoRA, tiled | A100-40 GB · ~$0.012 median (more for 5K outputs) | `scale_factor` float, `creativity` 0–1, `resemblance` 0–3, `dynamic`, `num_inference_steps`, `sharpen`, `seed` | ✘ (flattened) | Adds plausible micro-texture; **can hallucinate**, shift colour, re-draw text/logos | Final pass only (`--final-model clarity`) for editorial/marketing imagery; never for archival, product, or text-bearing images |
| `topaz` | `topazlabs/image-upscale` (official, latest) · 3.5 M runs | Topaz Gigapixel models (Standard V2, High Fidelity V2, Low Resolution V2, CGI, Text Refine) | Priced per **output megapixel**: **$0.05 ≤ 24 MP**, $0.10 ≤ 48 MP | `upscale_factor` enum **2x / 4x / 6x** only; `face_enhancement`, `subject_detection` | ✘ | Lowest artifacting of the set; conservative; enum factors force overshoot | Premium single-pass route (`--model topaz`); 5120 output at 1280–2560 px input = one 2× or 4× call |
| `google` | `google/upscaler` (official, latest) · 1.1 M runs | Google (Imagen) upscaler | see model page | `upscale_factor` enum **x2 / x4**; JPEG output (`compression_quality` → 100) | ✘ | Clean, conservative, slight JPEG re-encode per pass | Alternative conservative route; JPEG output makes it a poor fit for multi-pass chains |
| `codeformer` | `sczhou/codeformer` (`cc4956dd…`) · 54.8 M runs | CodeFormer face restoration (+ optional Real-ESRGAN background) | L40S · ~$0.0035 | `codeformer_fidelity` 0–1, `upscale` (set **1**), `background_enhance` (off) | ✘ | Excellent on degraded faces; fidelity < 0.5 re-invents identity | Stage 2 pre-pass at native resolution when faces matter; then upscale with `face_enhance=false` to avoid double processing |

Also verified as reachable but not wired in (drop-in candidates): `jingyunliang/swinir` (6.3 M runs, A100-80, 4× transformer SR, slow), `mv-lab/swin2sr` (JPEG-artifact-aware 4×), `recraft-ai/recraft-crisp-upscale` (illustration/vector-style), `zsxkib/aura-sr-v2` (fast 4× GAN, 22 K runs — immature).

### Recommended routing

| Content | Passes | Command |
|---|---|---|
| Photographs, renders (default) | Real-ESRGAN 4× → Real-ESRGAN-A100 remainder → exact trim | `--model auto` |
| Portraits / old photos | CodeFormer @1× → Real-ESRGAN chain | `--model auto --face-restore` |
| Editorial texture boost | Real-ESRGAN 4× → Clarity final pass (creativity 0.30, resemblance 1.0) | `--model auto --final-model clarity` |
| Minimum-artifact commercial | Topaz High Fidelity V2, 2× or 4× | `--model topaz --extra enhance_model="High Fidelity V2"` |
| Digital art / CGI | Topaz CGI | `--model topaz --extra enhance_model=CGI` |

### Progressive iterations vs one massive jump

1. **Networks have a native factor.** Real-ESRGAN x4plus, SwinIR and AuraSR are trained at exactly **4×**. Requesting `scale=8` on `nightmareai/real-esrgan` runs the 4× network once and then **cv2 Lanczos-resizes** to 8× — the extra 4× carries zero learned detail (blur, no texture). Any factor > 4 must therefore be split into passes, each operating at its native scale.
2. **Detail synthesis is frequency-banded.** Pass 1 hallucinates detail one octave above the source; pass 2 sees that output as its "source" and synthesises the next octave. A single pass cannot produce the second band because its receptive field never sees it.
3. **VRAM and tiling.** A 5K frame is **15–26 MP**. `nightmareai/real-esrgan` on a T4 does not tile; inputs above ~2.5 MP at 4× (→ 40 MP output) risk CUDA OOM. Progressive passes keep each call inside the model's comfort envelope, and `auto` moves pass 2/3 to the A100 variant. The script also **halves the factor automatically on an OOM signature** and lets the loop make up the difference.
4. **Artifact compounding is the trade-off.** Every generative pass treats the previous pass's inventions as ground truth, so error compounds geometrically. Mitigations built in: hard cap of **3 API passes**; deterministic model for early passes; generative model (if any) only on the final pass at low creativity; **round-trip PSNR** measured after every pass (downsample output → compare with input) with a 24 dB drift threshold.
5. **Overshoot + supersampled trim beats exact-factor requests.** The loop requests `remaining × 1.01` (never lands on 5119 through integer rounding), then Stage 4 downsamples with Lanczos to exactly 5120. A 1 % supersample removes ringing on edges at no visible cost. Enum models (Topaz 2/4/6×) overshoot more — accepted, but note Topaz bills by **output** megapixels.
6. **Tiny remainders are not worth a call.** Remainders below **1.15×** are done locally with Lanczos (`min_api_scale`), saving a paid call and a cold start for a factor no model can improve on.

### Tiling (v1.1) — how a 9000 px pass stays inside a T4

A 4× network runs at 4× internally whatever `scale` you request: asking Real-ESRGAN for ×1.75 on an 18 MP intermediate still materialises a 300 MP feature map first, so **halving the factor never fixes an OOM — only a smaller input does**. The pipeline therefore tiles any input above the model's `max_input_mp` (2.5 MP for the T4 profile):

| Step | Detail |
|---|---|
| Grid | ≤ `tile_size`² source px per tile (default **1024² = 1.05 MP**), `tile_overlap` **48 px** shared with each neighbour, last row/column aligned to the far edge (no slivers) |
| Request factor | An **integer** `k = ceil(remaining)` (2–4; enum models use their smallest factor ≥ remaining). Integer factors make tile pixel *(i, j)* land exactly on global pixel *(k·y0+i, k·x0+j)* — no per-tile resampling phase error, which is what causes visible seams with fractional per-tile scales |
| Concurrency | `tile_workers` (**4**) predictions in flight; well under the 600 req/min limit |
| Stitch | `tile_margin` **8 px** trimmed from every internal edge (all models show border artefacts there), raster-order compositing with linear ramps across the remaining overlap, uint8 canvas (≈ 3 B/px) |
| Final resize | One global Lanczos `k → remaining` (e.g. ×2 → ×1.75) — a supersample, quality-positive |
| OOM escalation | single call → tiled → tile size halved (min 256 px) → enum step-down; never more than `max_retries_per_pass` blind retries |
| Verified | Stitched output vs a whole-image reference: **PSNR 138 dB, max pixel diff 0** on RGB and RGBA test images |

Cost example: 1300×900 → 9000 px = 1 single call + 24 tiles ≈ **$0.05** and ~1–2 min. `--plan` prints exactly this per image before anything is spent.

### Pass math (target 5120, native max 4×, overshoot 1 %)

| Source long edge | Required ×  | API passes | Factor plan |
|---|---|---|---|
| 80 px (hard floor) | 64.0 | 3 | 4.0 → 4.0 → 4.0 |
| 320 px | 16.0 | 2 | 4.0 → 4.0 |
| 640 px | 8.0 | 2 | 4.0 → 2.02 |
| 800 px | 6.4 | 2 | 4.0 → 1.616 |
| 1024 px | 5.0 | 2 | 4.0 → 1.262 |
| **1280 px** | 4.0 | **1** | 4.0 |
| 1600 px | 3.2 | 1 | 3.232 |
| 1920 px | 2.667 | 1 | 2.693 |
| 2560 px | 2.0 | 1 | 2.02 |
| 3840 px | 1.333 | 1 | 1.347 |
| 4480 px | 1.143 | 1 | 1.154 |
| ≥ 4600 px | < 1.115 | 0 | local Lanczos only |
| ≥ 5120 px | 1.0 | 0 | trim/re-encode only |

Below **640 px** the pipeline warns: large prints from a sub-VGA source are achievable but soft; below the hard floor (`target / 4^max_passes`, 36 px at 9000/4 passes) it refuses.

### Pass math (target 9000, native max 4×, overshoot 1 %, tiling above 2.5 MP)

| Source | Required × | Passes | Factor plan (pass 2 tiled at k=2) |
|---|---|---|---|
| 800×600 | 11.25 | 2 | 4.0 → 2.84 (12 tiles) |
| 1300×900 | 6.92 | 2 | 4.0 → 1.75 (24 tiles) |
| 2000×1000 | 4.5 | 2 | 4.0 → 1.14 local Lanczos (1 call total) |
| 4000×2667 (10.7 MP) | 2.25 | 1 | 2.27 (≈ 20 tiles) |
| 6000×4000 (24 MP) | 1.5 | 1 | 1.51 (35 tiles) |

### Print suitability (Stage 4)

`--print-size` / `UPSCALE_PRINT_SIZE` grades the **delivered** file at the PPI it will actually print at: the binding axis of a contained fit — the long edge against the sheet's long edge for images at least as elongated as the sheet, the short edge otherwise (a square on 150×100 is graded, tagged and named on its 100 cm side). The same value is written as the dpi tag and into the file name. Named formats: `150x100`, `100x150`, `150x150`, `a0`–`a4`; explicit: `60x40cm`, `24x16in`.

| Grade | PPI | Meaning at 150 cm |
|---|---|---|
| photo-sharp | ≥ 300 | fine-art at arm's length (needs 17,717 px — not realistic from camera files) |
| **sharp** | ≥ 150 | large-format standard — **9000 px delivers 152 PPI on all three of Andre's formats** |
| acceptable | ≥ 125 | fine at > 1 m viewing distance |
| marginal | ≥ 100 | soft up close |
| poor | < 100 | re-target or print smaller (5120 px = 87 PPI at 150 cm) |

An aspect mismatch > 5 % between image and sheet is noted (crop or margins). The grade and the recommendation line go into `<stem>_report.json`, `manifest.jsonl` and the console summary.

### Print-shop delivery (v1.2, `--preset printshop`)

What a large-format shop needs is not "a big PNG" but a file that opens at the right physical size, in a known colour space, with bleed, and a note saying so. Stage 4 now produces exactly that:

| Item | Implementation |
|---|---|
| Pixel target from the sheet | `--print-ppi 150` + `--print-size 150x100` → `required_long_edge()` computes the long edge so the sheet is covered at 150 PPI (8859 px for 150 cm), respecting `--fit`; `UPSCALE_TARGET_PX` is only the fallback |
| Sheet fit | `--fit none` (keep aspect, shop centres it), `crop` (centred crop to the sheet ratio), `pad` (white canvas at the sheet ratio). Verification checks the delivered aspect against the sheet when a fit was applied |
| Colour management | The source ICC profile is captured **before** any conversion (`source.icc` in `work/`), and re-embedded in the delivery — the models never converted colour, so it still describes the numbers. No profile → sRGB embedded (Pillow/littlecms built-in). `--icc-target AdobeRGB1998.icc` converts into a given profile (perceptual intent) and embeds it |
| Physical size | `XResolution/YResolution` = delivered PPI (e.g. 150 dpi) so Photoshop / the RIP opens the file at 150 × 100 cm; 300 dpi when no sheet is given |
| Bleed | `--bleed-mm 3` → mirrored-edge extension of `round(3/25.4 × ppi)` px per side (18 px at 150 PPI); trim and file sizes both reported |
| Encoding | PDF by default since 1.4.1 (see *PDF delivery* below); `--format tiff`: TIFF-LZW, 8-bit RGB, single layer, alpha flattened to white (JPEG q95 4:4:4 or PNG on request). No JSON metadata inside the file (RIP-safe); `Software` tag only |
| Sharpening | `--sharpen`: one mild unsharp mask (r 0.6, 60 %, threshold 2) after the final resize — opt-in |
| Naming | `<original name>_150x100cm_150ppi.tif`; a square on the 150x100 sheet is `<original name>_100x100cm_150ppi.tif`. Pixel size and profile are in `_SPEC.txt` |
| Delivery note | `<file>_SPEC.txt`: dimensions (trim / with bleed), print size and PPI with grade, bleed, colour profile and bit depth, format, resolution tag, fit, **SHA-256 of the delivered file**, source, pipeline/models, timestamp |
| Integrity | `output_sha256` in the manifest and report; `verify_output()` re-opens the written file and asserts ICC presence and the dpi tag |

Not done on purpose: 16-bit output (the models emit 8-bit; padding to 16-bit adds bytes, not information) and CMYK (needs the shop's press profile — convert at the RIP; the note says so).

### PDF delivery (v1.4.1, fixed in v1.4.2; `--format pdf`, the `.env` default)

| Item | Implementation |
|---|---|
| Page | One page, MediaBox = BleedBox = the delivered file incl. bleed at the delivered PPI (`px / ppi * 72 pt`), TrimBox = the trim inset by the bleed (no ArtBox: PDF/X allows only one of the two). The image is placed with `w 0 0 h 0 0 cm`, never resampled |
| Image | 8-bit RGB XObject, `/FlateDecode` with `/Predictor 15` (PNG "Up" filter per row, applied with numpy in 512-row bands, streamed to the file, length as an indirect object). Lossless; typically 4-5x smaller than TIFF-LZW |
| Write | Written to `<name>.pdf.<pid>.part` next to the destination and `os.replace()`d onto the final name only once complete (one atomic filesystem rename); any exception, including Ctrl+C, deletes the `.part` file. A reader (a browser tab, Explorer's thumbnailer, a backup tool, antivirus) can never observe a partial file at the final name, however long the write takes on a large image |
| Colour | `[/ICCBased]` stream (`/N 3`, `/Alternate /DeviceRGB`) with the same RGB profile the TIFF route embeds (source profile if it is RGB, else sRGB assumed with a warning; or `--icc-target`, which must be RGB). Only a printer-class (`prtr`) profile, i.e. the shop's canvas/paper profile given with `--icc-target`, is also declared as the PDF/X output intent (`/S /GTS_PDFX`, `/DestOutputProfile`); with a display-class profile such as sRGB the file is a plain colour-managed PDF with no PDF/X claim. The default sRGB is the Windows sRGB IEC61966-2.1 v2 profile. Without any profile: `/DeviceRGB`, noted in `_SPEC.txt` |
| Metadata | XMP with dc:title, dates, Producer, `pdf:Trapped` False, xmpMM ids derived from the pixel hash, and `pdfxid:GTS_PDFXVersion` = PDF/X-4 only together with an output intent; Info dict with `/Trapped /False`, both `/ID` strings equal. Info and XMP text is the same ASCII-cleaned string. Default preset only: provenance JSON in `/Subject` (capped at 32,000 bytes) and `dc:description` |
| Verification | `verify_pdf()` re-reads the file: `%PDF-1.6`, `startxref` -> `xref`, one page, no ArtBox, MediaBox/TrimBox vs pixels, PPI and bleed (0.05 pt), ICC present, PDF/X marker and output intent present together exactly when a printer-class profile was embedded, and decodes the image stream (Flate, inverse Up, streamed) to compare the pixel SHA-256 with what `write_pdf()` hashed while writing. A corrupt length or stream raises `VerificationError` for that image |
| Not claimed | Certified PDF/X-4 conformance. With a printer-class profile the file declares PDF/X-4 and meets the checks above; a shop that requires certification runs its preflight (Acrobat: Print Production > Preflight > PDF/X-4). The Print Quality Auditor page reads PNG/JPEG/WebP/TIFF only; pypdf needs its 75 MB decompression limits raised for large deliveries |
| Existing TIFFs | `tiff_to_pdf.py` writes the PDF for an already delivered TIFF from its pixels, resolution tags, ICC and the bleed in its `_SPEC.txt`; no upscaling, no API calls. Each PDF is written under a temporary name, verified like a pipeline delivery and only then renamed into place; the spec sheet then gets one `PDF delivery:` line with the file's SHA-256, written atomically. A PDF is skipped only when it is complete, not older than its TIFF, has the TIFF's pixel size and is the file its spec sheet records, made from the TIFF as it is now (its size and date are recorded in that line); `--dry-run` lists the decisions, `--force` redoes a file. TIFFs it cannot place correctly are refused (no or unit-less resolution, non-square pixels, CMYK or 16-bit, several pages, an orientation tag, a spec sheet for another size). Several files at once when memory allows (`--workers`), each compressed on several cores (`--threads`, i.e. `write_pdf(threads=N)`); `--threads 1` writes the same bytes as the pipeline. Tests: `test_tiff_to_pdf.py` |

### Texture / grain overlay (v1.3, `--texture`)

An optional finishing step for fine-art / editorial prints: a paper or canvas texture tile, or synthetic film grain,
blended into the finished pixels. It runs in Stage 4 **after** the exact trim, sheet fit and sharpen and **before**
colour conversion and bleed, so the texture is at output resolution (never upscaled) and the bleed mirrors it.

| Item | Implementation |
|---|---|
| Source | `--texture tile.png` (any PNG/TIFF; repeated over the image, EXIF-normalised, converted to RGB) or `--texture grain` / `grain-color` (synthetic, no file). `--texture-mode grain` / `grain-color` on their own also enable grain |
| Blend | `--texture-mode multiply` (paper darkens), `overlay`, `soft-light` (Pegtop form; the gentlest); `--texture-strength 0..1` is the opacity (default 0.18). Grain: luminance noise clipped to ±40 levels (`grain`) or independent per-channel noise (`grain-color`), amplitude ∝ strength |
| Memory | Processed in 512-row bands with float32 temporaries per band, so a 9000×6000 delivery peaks at a few hundred MB |
| Determinism | Fixed seeds (42 / 1337): re-running produces byte-identical files, so the manifest SHA-256 is stable |
| Alpha | Blended on RGB, the alpha channel is re-attached (PNG default preset); print formats are flattened to white first |
| Validation | Missing texture file or unknown mode → `exit 2` before any API call; a file combined with a grain mode logs that the file is ignored |
| Provenance | `texture` in the PNG/JPEG provenance JSON, `texture` / `texture_mode` / `texture_strength` in the delivery record, `Texture:` line in `_SPEC.txt`, part of the idempotency key |

`.env`: `UPSCALE_TEXTURE`, `UPSCALE_TEXTURE_MODE`, `UPSCALE_TEXTURE_STRENGTH`. Launcher: `-Texture`, `-TextureMode`, `-TextureStrength`.

### Print-quality fix + re-check (v1.4, `--print-fix`)

The Print Quality Auditor (dashboard: https://claude.ai/artifact/BxN4SXQyh3HDtxGUKdrm6Z, source in
`Print Quality Auditor\`) grades a delivered file the way a prepress check does. On the batch-01 prints it
found the same three defects everywhere: simulated ink coverage up to 304% against the 280% canvas limit, pure RGB
black in the shadows (a four-plate rich black), and 8-bit banding in soft dark gradients (2–3 mm steps over a fifth
of the image). Stage 4 now fixes those before the file is written and re-checks the result, so the auditor's
findings are addressed in the deliverable rather than in a note to the shop.

| Item | Implementation |
|---|---|
| Where | `apply_print_fix()` runs after the texture step and before colour conversion and bleed, on the working RGB numbers; `check_print_quality()` runs right after it, on the same numbers, before `--icc-target` |
| Ink limit / black | `_black_floor_for(limit)` finds the lowest neutral grey whose heavy-GCR separation (`_cmyk_tac`, the auditor's model) stays 3% under the substrate limit (level 23 for 280%). A neutral toe lift `v + floor·t²`, `t = 1 − max(r,g,b)/knee` (knee = max(96, 2·floor), so the curve is monotonic and ends in the shadows), raises dark pixels to that floor with all channels moving together: no pure 0,0,0, no crushed floor, no pixel over the limit, and a saturated colour keeps its hue (255,0,0 is untouched; 0,0,40 becomes 8,8,48) |
| Banding | Two passes of a 13 px box blur (`_box_blur`, cumulative sums) blended in only where the blur moves a pixel by ≤ 3 levels (flat tone; edges keep their value), then ±1.2-level triangular dither where tone was smoothed or lifted; both fade out between luminance 110 and 150, so white, highlights and flat midtones are untouched. 512-row float32 bands, fixed seed: byte-identical re-runs |
| Substrates | `PRINT_QUALITY_SUBSTRATES`: coated 300, uncoated 260, canvas 280 (default), vinyl 300, textile 250 — the auditor's table. `--print-fix-substrate` / `UPSCALE_PRINT_FIX_SUBSTRATE` |
| Re-check | `PrintQualityReport`: 99.9th-percentile ink and over-limit area, black floor (L ≤ 3), neutral RGB black, on a 2400 px box-filtered copy (area average: a sharp edge cannot ring into false black); banding as stepped plateaus of ≥ 6 px in smooth dark gradients (`_plateaus`, the auditor's run scan; shorter runs occur by chance in dithered tone) on 1200 full-resolution rows and columns, because resizing averages the steps away. With the sheet known, `_band_score()` is the auditor's Tier C banding score at its viewing distance (1.6 × the long side, 60–400 cm). Flags at > 1% over the limit, > 5% crushed, > 1% neutral black, banding score < 9 (no sheet: > 5% stepped in ≥ 2 mm plateaus); `critical` at > 5% over the limit, > 15% crushed, or banding score < 7 |
| Policy | `--print-quality-policy warn` (default) delivers and flags: `PQ:CAVEATS` / `PQ:CRITICAL` in the summary table, `Print quality:` line and `!` flags in `_SPEC.txt`, `delivery.print_quality` in the report and manifest. `abort` raises `PrintQualityRefused` for a file still critical after the fix; the refused image's report, manifest row and status row keep the re-check, and the batch continues |
| Progress | `write_batch_status()` rewrites `output\<batch>\batch_status.json` atomically before the first and after every image (totals, ok / skipped / failed, critical / caveats, cost, one row per image with print size, PPI, grade, re-check, error). The auditor's **Follow a batch** mode watches it every 3 s |
| Idempotency | The fix joins `delivery_key` only when it is on, so pre-1.4 print-shop deliveries stay recognised with the fix off and are re-delivered with it on (batch 01: no API cost, the 5120 px inputs finish locally). Default-preset files are matched by the hash in their name, so they need `--force`, as for every other delivery parameter |
| Robustness | `batch_status.json` is replaced atomically with five retries; a reader holding it open (Windows refuses the replace) yields a warning, never an exception. The re-check composites RGBA over white first, as the print does |
| Measured | Batch-01 prints, pipeline functions + full auditor port: peak ink 302–304% → 277–278%, over-limit area 2.3–11.7% → 0%, crushed black 0.3–6.4% → 0%, neutral black 0.5–5.9% → 0%, banding p90 step 2.7–4.2 mm → 1.7–3.1 mm (pipeline score 6.7–8.3 → 8.0–9.2); auditor ink / clipping / black checks → 10, banding 7.8–9.1 → 8.7–9.5. Mean pixel change 1–3 levels, max 26, shadows only. Pure red, white, mid grey unchanged; a text page stays `ok`. The pipeline's banding score runs a little stricter than the dashboard's because it ignores plateaus under 6 px |

Not fixed on purpose: the auditor's resolution finding (real detail about 25% of the pixel count, 38 effective PPI on
the sheet) is a property of the 220–550 px sources. Only a generative last pass (`--final-model clarity`) or a
smaller print changes it, and both are the user's call.

### Idempotent re-runs (v1.3.1)

Default-preset file names carry the source hash (`_<sha8>`), so an existing final is found by glob. Print-shop names
are sheet-derived and carry no hash; for them `<stem>_report.json` is the index: it records `source_sha256` and a
`delivery_key` (hash of target, exact, preset, format, fit, bleed, sheet, PPI, sharpen, ICC target, texture). A source
whose bytes and key match a successful report whose file still exists is **skipped** — no API spend on a re-run.
A skip only appends a manifest row and keeps the delivery's report, so the index survives any number of re-runs; reports that 1.3.1 to 1.3.3 rewrote as `skipped` still count. Changing any delivery parameter, or `--force`, re-delivers.

### Reusing earlier results (v1.3.2, `--min-api-scale`)

A paid call is only worth it while the model still has detail to add. A remaining enlargement below `min_api_scale`
(default x1.15) is done locally with Lanczos. Raising it to x2 lets already-upscaled files, such as the 5120 px results
of the 1.0 run, be finished to any sheet up to 150 cm @ 150 PPI with zero API calls. Without it, the x1.15-x1.73 step
over a 26 MP image is tiled into about 36 calls per image, which costs more than upscaling the small original again.

---

## 3. Production code implementation

### Dependencies and environment

```powershell
cd C:\Users\andre\Upscaled
copy .env.example .env      # paste REPLICATE_API_TOKEN, adjust folders/defaults
.\run_upscale.ps1 -DryRun   # offline plumbing test (no API calls, no token needed)
.\run_upscale.ps1           # live; creates .venv and installs requirements.txt on first run
```

`.env` is auto-loaded by both `upscale_pipeline.py` (file next to the script) and `run_upscale.ps1`. Precedence: **CLI flag > environment > .env > built-in default**; if a key appears twice in `.env`, the **last** line wins (a warning is logged).

| Group | Key | Default | Role |
|---|---|---|---|
| Executor | `REPLICATE_API_TOKEN` | — (required unless `--dry-run`) | Replicate is the only executor; there is no self-hosted renderer |
| | `REPLICATE_PIN_VERSIONS` | `1` | `1` = pinned version hashes (reproducible), `0` = latest |
| | `REPLICATE_POLL_INTERVAL` | `0.5` | Client polling interval (s) |
| Storage (local) | `UPSCALE_INPUT_DIR` / `UPSCALE_OUTPUT_DIR` / `UPSCALE_WORK_DIR` | `input` / `output` / `work` | Deliverables stay on the local filesystem; no upload endpoint |
| Pipeline defaults | `UPSCALE_MODEL`, `UPSCALE_FINAL_MODEL`, `UPSCALE_TARGET_PX`, `UPSCALE_MAX_PASSES`, `UPSCALE_EXACT`, `UPSCALE_FORMAT`, `UPSCALE_JPEG_QUALITY`, `UPSCALE_FACE_RESTORE`, `UPSCALE_QUALITY_POLICY`, `UPSCALE_BUDGET_SECONDS`, `UPSCALE_PRINT_SIZE` | `auto`, —, `9000`, `4`, `1`, `png`, `95`, `0`, `warn`, `1800`, — | Same semantics as the CLI flags; invalid values abort with exit code 2 |
| Tiling | `UPSCALE_TILING`, `UPSCALE_TILE_SIZE`, `UPSCALE_TILE_OVERLAP`, `UPSCALE_TILE_MARGIN`, `UPSCALE_TILE_WORKERS` | `auto`, `1024`, `48`, `8`, `4` | See *Tiling* above |
| Print-shop delivery | `UPSCALE_PRESET`, `UPSCALE_PRINT_PPI`, `UPSCALE_FIT`, `UPSCALE_BLEED_MM`, `UPSCALE_SHARPEN`, `UPSCALE_ICC_TARGET` | `default`, —, `none`, `0`, `0`, — (the shipped `.env` sets `printshop`, `150`, `none`, `3`) | See *Print-shop delivery* above; format precedence: CLI `--format` > printshop preset (tiff) > `UPSCALE_FORMAT` > png |
| Print-quality fix + re-check | `UPSCALE_PRINT_FIX`, `UPSCALE_PRINT_FIX_SUBSTRATE`, `UPSCALE_PRINT_QUALITY_POLICY` | `0`, `canvas`, `warn` (the shipped `.env` sets `1`, `canvas`, `warn`) | See *Print-quality fix + re-check* above |
| Delivery | `DELIVERY_WEBHOOK_URL` | — (off) | POST one JSON manifest row per finished image (ok / skipped / failed) to an email or store-sync workflow; 10 s timeout, 2 attempts, never fatal |
| | `DELIVERY_WEBHOOK_SECRET` | — | When set, body is signed: `X-Upscale-Signature: sha256=<HMAC-SHA256>` |

### Module map (`upscale_pipeline.py`)

| Symbol | Responsibility |
|---|---|
| `PipelineConfig` | All knobs (target, max passes, model, exact trim, format, thresholds, budget, dry-run) |
| `ModelProfile` / `MODELS` | Registry: slug, pinned version, native max factor, enum factors, alpha support, MP comfort limit, timeout, cost, `build_input()` payload builder |
| `select_profile()` | `auto` → Real-ESRGAN x4plus; large inputs are tiled (v1.1) so the T4 model stays in its envelope; `real-esrgan-a100` remains an explicit choice |
| `validate_input()` / `read_meta()` | Stage 1; `read_meta()` is the programmatic dimension check used after every pass |
| `ReplicateRunner` | `predictions.create` with 429/5xx backoff → bounded polling with `cancel()` on deadline → failure classification (OOM regex) → download with retry |
| `QualityTracker` | Sharpness (Laplacian variance @1024 px), round-trip PSNR, colour drift; thresholds → flags |
| `plan_passes()` / `choose_scale()` | Static projection for logs; per-pass factor incl. enum handling |
| `run_pass()` / `run_pass_single()` / `run_pass_tiled()` | One pass: single call or tiled (grid → concurrent predictions → stitch), retries, OOM escalation, PNG normalisation; `--dry-run` swaps in a local simulator |
| `plan_tiles()` / `tile_factor()` / `stitch_tiles()` | Tile grid, integer request factor, margin-trimmed feather compositing + global Lanczos |
| `PrintSpec` / `PrintReport` / `check_print()` | Print-size parsing (named formats, cm/in) and PPI grading of the delivered file |
| `print_plan()` | `--plan`: passes, tiles, API calls, cost, output size and print grade per image, no API |
| `required_long_edge()` / `delivered_ppi()` | Sheet-driven pixel target and the PPI a delivered trim actually gives on the sheet |
| `fit_to_sheet()` / `add_bleed()` / `apply_colour()` | Crop/pad to sheet ratio, mirrored bleed, ICC keep/assume/convert |
| `write_spec_sheet()` | The `_SPEC.txt` delivery note with the output SHA-256 |
| `apply_texture()` / `_load_texture()` | v1.3 texture-tile / film-grain overlay, band-wise (memory-bounded), fixed seeds |
| `apply_print_fix()` / `_black_floor_for()` / `_box_blur()` / `_cmyk_tac()` | v1.4 ink-limit toe lift + edge-aware deband + dither, band-wise, fixed seed |
| `check_print_quality()` / `_plateaus()` / `PrintQualityReport` | v1.4 re-check of the delivered pixels (ink, black floor, neutral black, banding) with flags and grade |
| `write_batch_status()` | v1.4 live `batch_status.json` for the dashboard's batch monitor, rewritten atomically after every image |
| `delivery_key()` / `previous_delivery()` | Idempotent re-runs for sheet-named (printshop) outputs via `<stem>_report.json` (source SHA-256 + delivery parameters) |
| `run_face_restore()` | Stage 2 CodeFormer at 1× |
| `finalize()` / `verify_output()` | Stage 4: exact trim → fit → sharpen → texture → colour → bleed → encode with ICC + dpi; re-open and assert dims, aspect (vs source or sheet), delivered PPI, ICC, dpi tag |
| `process_image()` | Orchestrator with the dynamic loop and all safeguards; never raises — returns `ImageResult` |
| `load_dotenv()` / `env()` | Dependency-free `.env` loader (environment wins) and typed accessor behind every CLI default |
| `notify_webhook()` | Optional signed POST of the manifest row per image; failures logged, never fatal |
| `main()` | CLI, `.env` validation, batch loop, reports, webhook, summary table, exit code (1 if any image failed) |

### Full script

```python
#!/usr/bin/env python3
"""
upscale_pipeline.py -- Progressive 5K/9K (large-format print) upscaling on the Replicate API.

Stages
  1. Input Validation      -> ImageMeta (dims, mode, hash), EXIF-normalised working copy
  2. Model Inference       -> optional face restoration (CodeFormer) at native resolution
  3. Progressive Upscaling -> dynamic loop: measure -> plan factor -> Replicate -> download -> re-measure
  4. Output Verification   -> exact trim, sheet fit, texture, print-fix, colour (ICC), bleed, encode, dims /
                              aspect / PPI / ICC / dpi assertions, print-quality re-check, provenance metadata,
                              print-shop spec sheet

Usage
  python upscale_pipeline.py INPUT [INPUT ...] --out OUT_DIR [options]
  python upscale_pipeline.py ./input --out ./output --model auto --exact
  python upscale_pipeline.py photo.jpg --out ./output --dry-run     # offline loop test, no API calls

Environment (.env next to this file is auto-loaded; existing environment wins)
  REPLICATE_API_TOKEN      required unless --dry-run
  REPLICATE_PIN_VERSIONS   "0" to run latest model versions instead of the pinned hashes below
  UPSCALE_*                CLI defaults (INPUT_DIR, OUTPUT_DIR, WORK_DIR, MODEL, FINAL_MODEL, TARGET_PX,
                           MAX_PASSES, MIN_API_SCALE, FORMAT, QUALITY_POLICY, BUDGET_SECONDS, PRINT_SIZE, PRINT_PPI, PRESET, FIT,
                           BLEED_MM, SHARPEN, ICC_TARGET, TILING, TILE_*, TEXTURE, TEXTURE_MODE, TEXTURE_STRENGTH,
                           PRINT_FIX, PRINT_FIX_SUBSTRATE, PRINT_QUALITY_POLICY)
                           -- see .env.example
  DELIVERY_WEBHOOK_URL     optional: POST one JSON row per finished image (signed if DELIVERY_WEBHOOK_SECRET set)

Verified against replicate==1.0.7 (Python client), Pillow 12, numpy 2.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import logging
import math
import mmap
import os
import random
import re
import shutil
import sys
import time
import zlib
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, Optional
from xml.sax.saxutils import escape as xml_escape

import httpx
import numpy as np
from PIL import Image, ImageFile, ImageFilter, ImageOps, PngImagePlugin, UnidentifiedImageError

try:                                   # littlecms bindings ship with the standard Pillow wheels
    from PIL import ImageCms
    HAS_CMS = True
except ImportError:                    # pragma: no cover
    ImageCms = None  # type: ignore
    HAS_CMS = False

try:  # the replicate client is optional for --dry-run
    from replicate.client import Client as ReplicateClient
    from replicate.exceptions import ReplicateError
except ImportError:  # pragma: no cover
    ReplicateClient = None  # type: ignore
    ReplicateError = Exception  # type: ignore

__version__ = "1.4.2"

# A 5K output is ~15-26 MP; a 6x Topaz overshoot can reach ~100 MP. Bound, but do not choke.
Image.MAX_IMAGE_PIXELS = 900_000_000
ImageFile.LOAD_TRUNCATED_IMAGES = False

LOG = logging.getLogger("upscale")

SUPPORTED_INPUT_EXT = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"}


# =============================================================================
# Errors
# =============================================================================
class PipelineError(Exception):
    """Base class: the image cannot be delivered; the batch continues."""


class ValidationError(PipelineError):
    pass


class VerificationError(PipelineError):
    pass


class PrintQualityRefused(VerificationError):
    """--print-quality-policy abort: the re-check stayed critical after the fix. Carries the report."""
    def __init__(self, message: str, report: "PrintQualityReport"):
        super().__init__(message)
        self.report = report


class SafeguardTripped(PipelineError):
    """max passes / budget / no-progress guard."""


class ModelRunFailed(PipelineError):
    def __init__(self, message: str, *, oom: bool = False, retryable: bool = True, logs: str = ""):
        super().__init__(message)
        self.oom = oom
        self.retryable = retryable
        self.logs = logs


class PassTimeout(ModelRunFailed):
    def __init__(self, message: str):
        super().__init__(message, retryable=True)


# =============================================================================
# Configuration
# =============================================================================
@dataclass
class PipelineConfig:
    target_long_edge: int = 9000         # 9000 px covers 150 cm @ 150 PPI large-format sharp
    max_passes: int = 4                 # 9000 px from a small source may need 4 passes
    model: str = "auto"                 # profile key or "auto"
    final_model: Optional[str] = None   # optional different profile for the last pass (hybrid strategy)
    face_restore: bool = False
    exact: bool = True                  # trim overshoot to exactly target_long_edge (supersampling)
    overshoot: float = 0.01             # request +1% so integer rounding never lands at 5119
    output_format: str = "png"          # png | jpg | webp | tiff | pdf
    jpeg_quality: int = 95
    quality_policy: str = "warn"        # warn | abort
    min_input_long_edge_warn: int = 640
    min_api_scale: float = 1.15         # below this factor use local Lanczos instead of a paid call
    max_retries_per_pass: int = 2
    budget_seconds: int = 1800          # wall-clock budget per image
    dry_run: bool = False
    force: bool = False
    pin_versions: bool = True
    extra_inputs: dict[str, Any] = field(default_factory=dict)   # passthrough model params
    print_size: Optional[str] = None                               # e.g. '150x100', '60x40cm', '24x16in'
    tiling: str = "auto"                # auto | always | off -- split large inputs into overlapping tiles
    tile_size: int = 1024               # tile edge in SOURCE px (1024^2 = 1.05 MP per API call)
    tile_overlap: int = 48              # shared px between neighbours, feather-blended on stitch
    tile_margin: int = 8                # px discarded from each internal tile edge (model border artefacts)
    tile_workers: int = 4               # concurrent tile predictions

    # print-shop delivery (Stage 4)
    preset: str = "default"             # default | printshop (TIFF-LZW, ICC embedded, dpi tag, spec sheet, no JSON in file)
    print_ppi: Optional[float] = None   # with print_size: derive the pixel target from the sheet at this PPI
    fit: str = "none"                   # none | crop | pad -- match the sheet aspect (crop centred / pad white)
    bleed_mm: float = 0.0               # mirrored-edge bleed added on every side, in mm at the delivered PPI
    sharpen: bool = False               # mild unsharp mask after the final resize
    icc_target: Optional[str] = None    # path to an .icc to convert INTO (e.g. AdobeRGB1998.icc); default keep source

    # texture / grain overlay (Stage 4 pre-step, v1.3)
    texture_file: Optional[str] = None  # PNG/TIFF tile to blend in, or the shorthand "grain" / "grain-color"
    texture_strength: float = 0.18      # 0..1 blend opacity (grain: amplitude)
    texture_mode: str = "multiply"      # multiply | overlay | soft-light | grain | grain-color

    # print-quality fix + re-check (Stage 4, v1.4): what the Print Quality Auditor flags on delivered files
    print_fix: bool = False             # toe lift under the substrate ink limit + edge-aware deband + dither
    print_fix_substrate: str = "canvas" # key of PRINT_QUALITY_SUBSTRATES: sets the ink limit for fix and check
    print_quality_policy: str = "warn"  # warn = deliver and flag | abort = refuse a file still critical after the fix
    work_dir: Path = Path("work")
    out_dir: Path = Path("output")

    # quality thresholds (see QualityTracker)
    sharpness_drop_ratio: float = 0.55   # new/prev sharpness below this => over-smoothing
    sharpness_spike_ratio: float = 3.5   # above this => over-sharpening / halo risk
    min_round_trip_psnr: float = 24.0    # dB; below => structural drift / hallucination
    max_color_drift: float = 8.0         # mean per-channel shift (0-255)


# =============================================================================
# Model registry (schemas verified on replicate.com, 2026-09-14)
# =============================================================================
@dataclass(frozen=True)
class ModelProfile:
    key: str
    owner_name: str
    version: Optional[str]                  # pinned version hash (None => model endpoint / latest)
    kind: str                               # "upscaler" | "face"
    max_scale: float                        # native max factor per pass
    allowed_scales: Optional[tuple[float, ...]]  # enum-only models
    supports_alpha: bool
    max_input_mp: float                     # above this the model tends to OOM / reject
    timeout_s: int                          # incl. cold start
    est_cost_usd: float                     # rough per-run figure for the cost log
    output_is_list: bool
    build_input: Callable[[Path, float, dict], dict]
    notes: str = ""
    external_tiling_ok: bool = True          # False for generative models that tile internally with a global prompt

    @property
    def ref(self) -> str:
        return f"{self.owner_name}:{self.version}" if self.version else self.owner_name


def _in_real_esrgan(img: Path, scale: float, extra: dict) -> dict:
    return {"image": img, "scale": round(scale, 3), "face_enhance": bool(extra.get("face_enhance", False))}


def _in_clarity(img: Path, scale: float, extra: dict) -> dict:
    payload = {
        "image": img,
        "scale_factor": round(scale, 3),
        "creativity": 0.30,        # fidelity-first; 0.35 is the model default
        "resemblance": 1.0,        # pull output toward the source (default 0.6)
        "dynamic": 6,
        "num_inference_steps": 18,
        "sharpen": 0,
        "downscaling": False,
        "output_format": "png",
        "seed": 1337,              # deterministic re-runs
    }
    payload.update({k: v for k, v in extra.items() if k not in ("face_enhance",)})
    return payload


def _in_topaz(img: Path, scale: float, extra: dict) -> dict:
    return {
        "image": img,
        "upscale_factor": f"{int(round(scale))}x",     # "2x" | "4x" | "6x"
        "enhance_model": extra.get("enhance_model", "Standard V2"),
        "output_format": "png",
        "subject_detection": extra.get("subject_detection", "None"),
        "face_enhancement": bool(extra.get("face_enhance", False)),
    }


def _in_google(img: Path, scale: float, extra: dict) -> dict:
    return {"image": img, "upscale_factor": f"x{int(round(scale))}", "compression_quality": 100}


def _in_codeformer(img: Path, scale: float, extra: dict) -> dict:
    return {
        "image": img,
        "codeformer_fidelity": float(extra.get("codeformer_fidelity", 0.7)),
        "background_enhance": bool(extra.get("background_enhance", False)),
        "face_upsample": True,
        "upscale": 1,              # restore at native resolution; the upscaler does the scaling
    }


MODELS: dict[str, ModelProfile] = {
    "real-esrgan": ModelProfile(
        key="real-esrgan", owner_name="nightmareai/real-esrgan",
        version="b3ef194191d13140337468c916c2c5b96dd0cb06dffc032a022a31807f6a5ea8",
        kind="upscaler", max_scale=4.0, allowed_scales=None, supports_alpha=True,
        max_input_mp=2.5, timeout_s=420, est_cost_usd=0.002, output_is_list=False,
        build_input=_in_real_esrgan,
        notes="Real-ESRGAN x4plus on T4. Deterministic, no hallucination, $0.002/image. Fractional scale = 4x then Lanczos.",
    ),
    "real-esrgan-a100": ModelProfile(
        key="real-esrgan-a100", owner_name="daanelson/real-esrgan-a100",
        version="f94d7ed4a1f7e1ffed0d51e4089e4911609d5eeee5e874ef323d2c7562624bed",
        kind="upscaler", max_scale=4.0, allowed_scales=None, supports_alpha=True,
        max_input_mp=12.0, timeout_s=600, est_cost_usd=0.01, output_is_list=False,
        build_input=_in_real_esrgan,
        notes="Same schema as real-esrgan, A100-80GB: use for the large inputs of pass 2/3.",
    ),
    "clarity": ModelProfile(
        key="clarity", owner_name="philz1337x/clarity-upscaler",
        version="dfad41707589d68ecdccd1dfa600d55a208f9310748e44bfe35b4a6291453d5e",
        kind="upscaler", max_scale=4.0, allowed_scales=None, supports_alpha=False,
        max_input_mp=16.0, timeout_s=900, est_cost_usd=0.03, output_is_list=True,
        build_input=_in_clarity, external_tiling_ok=False,
        notes="SD1.5 + ControlNet-tile generative upscaler. Adds texture; can hallucinate. Best as a final pass at low creativity.",
    ),
    "topaz": ModelProfile(
        key="topaz", owner_name="topazlabs/image-upscale", version=None,
        kind="upscaler", max_scale=6.0, allowed_scales=(2.0, 4.0, 6.0), supports_alpha=False,
        max_input_mp=24.0, timeout_s=600, est_cost_usd=0.05, output_is_list=False,
        build_input=_in_topaz,
        notes="Topaz Gigapixel-class, billed per output megapixel (~$0.05 for <=24 MP output). Enum factors only.",
    ),
    "google": ModelProfile(
        key="google", owner_name="google/upscaler", version=None,
        kind="upscaler", max_scale=4.0, allowed_scales=(2.0, 4.0), supports_alpha=False,
        max_input_mp=16.0, timeout_s=300, est_cost_usd=0.02, output_is_list=False,
        build_input=_in_google,
        notes="Google Imagen upscaler, x2/x4 only, JPEG output. Clean, conservative.",
    ),
    "codeformer": ModelProfile(
        key="codeformer", owner_name="sczhou/codeformer",
        version="cc4956dd26fa5a7185d5660cc9100fab1b8070a1d1654a8bb5eb6d443b020bb2",
        kind="face", max_scale=1.0, allowed_scales=None, supports_alpha=False,
        max_input_mp=8.0, timeout_s=300, est_cost_usd=0.0035, output_is_list=False,
        build_input=_in_codeformer,
        notes="Face restoration pre-pass at native resolution (upscale=1).",
    ),
}


def select_profile(key: str, meta: "ImageMeta", cfg: PipelineConfig) -> ModelProfile:
    """'auto' => Real-ESRGAN x4plus. Large inputs are tiled (see run_pass_tiled), so the cheap T4 model
    is always in its comfort envelope; 'real-esrgan-a100' remains available as an explicit choice."""
    if key == "auto":
        key = "real-esrgan"
    if key not in MODELS:
        raise ValidationError(f"Unknown model profile '{key}'. Known: {', '.join(MODELS)}")
    return MODELS[key]


# =============================================================================
# Stage 1 -- Input validation
# =============================================================================
@dataclass
class ImageMeta:
    path: str
    width: int
    height: int
    mode: str
    format: Optional[str]
    sha256: str
    icc_path: Optional[str] = None       # copy of the embedded ICC profile (source only)
    icc_name: Optional[str] = None       # its description, or None when the source carried no profile

    @property
    def long_edge(self) -> int:
        return max(self.width, self.height)

    @property
    def megapixels(self) -> float:
        return self.width * self.height / 1e6

    @property
    def aspect(self) -> float:
        return self.width / self.height


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_meta(path: Path) -> ImageMeta:
    """Programmatic dimension check. Cheap (header only), used after every pass."""
    with Image.open(path) as im:
        w, h = im.size
        return ImageMeta(str(path), w, h, im.mode, im.format, sha256_file(path))


def validate_input(src: Path, cfg: PipelineConfig) -> tuple[ImageMeta, Path]:
    """Integrity + policy checks. Returns (meta, EXIF-normalised working copy as PNG)."""
    if not src.is_file():
        raise ValidationError(f"not a file: {src}")
    if src.suffix.lower() not in SUPPORTED_INPUT_EXT:
        raise ValidationError(f"unsupported extension {src.suffix!r}")
    try:
        with Image.open(src) as im:
            im.verify()                       # structural integrity (truncated / corrupt)
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise ValidationError(f"corrupt or unreadable image: {exc}") from exc

    with Image.open(src) as im:
        icc = im.info.get("icc_profile")      # capture BEFORE convert(): the profile describes the source numbers
        im = ImageOps.exif_transpose(im)      # bake orientation so dims are the *visual* dims
        keep_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
        im = im.convert("RGBA" if keep_alpha else "RGB")
        w, h = im.size
        if min(w, h) < 16:
            raise ValidationError(f"degenerate dimensions {w}x{h}")
        # hard floor: even max_passes x max native 4x cannot reach the target
        floor = math.ceil(cfg.target_long_edge / (4.0 ** cfg.max_passes))
        if max(w, h) < floor:
            raise ValidationError(
                f"long edge {max(w, h)}px cannot reach {cfg.target_long_edge}px in "
                f"{cfg.max_passes} passes of 4x (floor {floor}px)")
        if max(w, h) < cfg.min_input_long_edge_warn:
            LOG.warning("%s: long edge %dpx is below %dpx; expect soft results at the target size",
                        src.name, max(w, h), cfg.min_input_long_edge_warn)
        work = cfg.work_dir / _stem(src) / "pass0_source.png"
        work.parent.mkdir(parents=True, exist_ok=True)
        im.save(work, "PNG", compress_level=1)
    meta = read_meta(work)
    if icc:
        icc_path = work.with_name("source.icc")
        icc_path.write_bytes(icc)
        meta.icc_path, meta.icc_name = str(icc_path), icc_description(icc)
    LOG.info("[validate] %s -> %dx%d %s (%.2f MP), profile: %s", src.name, meta.width, meta.height,
             meta.mode, meta.megapixels, meta.icc_name or "none (sRGB assumed)")
    return meta, work


def icc_description(icc: bytes) -> str:
    if not HAS_CMS:
        return "embedded ICC"
    try:
        return ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(icc))).strip()
    except Exception:
        return "embedded ICC (unreadable description)"


def icc_header(icc: Optional[bytes]) -> dict:
    """Device class, colour space and version from an ICC profile header; empty when the bytes are not a profile."""
    if not icc or len(icc) < 132 or icc[36:40] != b"acsp":
        return {}
    return {"class": icc[12:16].decode("latin-1"), "space": icc[16:20].decode("latin-1").strip(),
            "version": f"{icc[8]}.{icc[9] >> 4}"}


def srgb_profile_bytes() -> Optional[bytes]:
    """The standard sRGB IEC61966-2.1 v2 profile that Windows ships (stable bytes, accepted by every RIP); the
    littlecms built-in v4 profile when it is not there."""
    win = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "spool" / "drivers" / "color" / "sRGB Color Space Profile.icm"
    try:
        b = win.read_bytes()
        if icc_header(b).get("space") == "RGB":
            return b
    except OSError:
        pass
    if not HAS_CMS:
        return None
    try:
        return ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    except Exception:
        return None


def _stem(path: Path) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", path.stem)[:80]


# tags this pipeline appends to deliverable names: 1.0 "_5K_5120x3413_real-esrgan_1a2b3c4d", default preset "_9000px_9000x6000_local_1a2b3c4d"
_RESULT_TAG = re.compile(r"(?:_5K_\d+x\d+|_\d+px_\d+x\d+)_[A-Za-z0-9-]+_[0-9a-f]{8}")


def _display_stem(path: Path) -> str:
    """The original image name: an earlier result fed back in loses the tags earlier runs appended."""
    base = path.stem
    m = _RESULT_TAG.search(base)
    if m and m.start() > 0:
        base = base[:m.start()]
    return re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("_")[:80] or _stem(path)


def _print_path(out_dir: Path, base: str, fmt: str, src_sha256: str) -> Path:
    """<base>.<fmt>, or <base>_2.<fmt>, _3 ... when that name already holds a print of a DIFFERENT source
    (its spec sheet names the source hash). The same source re-delivered overwrites its own file."""
    dst, n = out_dir / f"{base}.{fmt}", 2
    while dst.exists():
        spec = dst.with_name(dst.stem + "_SPEC.txt")
        if spec.exists() and src_sha256[:16] in spec.read_text(encoding="utf-8", errors="ignore"):
            break
        dst, n = out_dir / f"{base}_{n}.{fmt}", n + 1
    return dst


# =============================================================================
# Replicate runner -- rate limits, timeouts, failure classification, downloads
# =============================================================================
class ReplicateRunner:
    """Thin, defensive wrapper around predictions.create + polling.

    Why not replicate.run()? It has no wall-clock bound, and the client's built-in retry transport
    only retries idempotent verbs (GET/PUT/...), so a 429 on the POST that creates a prediction is
    NOT retried automatically. This wrapper owns both.
    """

    RETRYABLE_STATUS = {429, 500, 502, 503, 504}
    OOM_PATTERNS = re.compile(r"out of memory|OOM|CUDA error|cudaErrorMemoryAllocation|exceeds .* limit", re.I)

    def __init__(self, cfg: PipelineConfig):
        self.cfg = cfg
        self.client = None
        if cfg.dry_run:
            return
        if ReplicateClient is None:
            raise PipelineError("replicate package not installed: pip install replicate")
        token = os.environ.get("REPLICATE_API_TOKEN")
        if not token:
            raise PipelineError("REPLICATE_API_TOKEN is not set")
        self.client = ReplicateClient(
            api_token=token,
            timeout=httpx.Timeout(connect=15.0, read=120.0, write=120.0, pool=15.0),
        )
        self.http = httpx.Client(timeout=httpx.Timeout(connect=15.0, read=300.0, write=60.0, pool=15.0),
                                 follow_redirects=True)

    # -- public ---------------------------------------------------------------
    def run(self, profile: ModelProfile, payload: dict, *, label: str) -> tuple[bytes, dict]:
        """Create prediction (with 429/5xx backoff), wait with a deadline, download the first output."""
        if self.cfg.dry_run:
            raise RuntimeError("run() must not be called in dry-run mode")
        prediction = self._create_with_backoff(profile, payload, label=label)
        prediction = self._wait_with_deadline(prediction, profile, label=label)
        url = self._first_output_url(prediction.output, profile)
        data = self._download_with_retry(url)
        info = {
            "prediction_id": prediction.id,
            "model": profile.owner_name,
            "version": profile.version or "latest",
            "predict_time_s": (prediction.metrics or {}).get("predict_time"),
        }
        return data, info

    # -- create ---------------------------------------------------------------
    def _create_with_backoff(self, profile: ModelProfile, payload: dict, *, label: str, max_attempts: int = 8):
        kwargs: dict[str, Any] = {"input": payload, "wait": 60}          # Prefer: wait=60 => fewer polls
        if profile.version and self.cfg.pin_versions:
            kwargs["version"] = profile.version
        else:
            kwargs["model"] = profile.owner_name
        for attempt in range(1, max_attempts + 1):
            try:
                return self.client.predictions.create(**kwargs)
            except ReplicateError as exc:                                   # HTTP-level error
                status = getattr(exc, "status", None)
                detail = getattr(exc, "detail", "") or str(exc)
                if status not in self.RETRYABLE_STATUS or attempt == max_attempts:
                    raise ModelRunFailed(f"create failed ({status}): {detail}", retryable=False)
                delay = self._retry_delay(attempt, detail)
                LOG.warning("[%s] HTTP %s on create (attempt %d/%d), sleeping %.1fs: %s",
                            label, status, attempt, max_attempts, delay, detail[:120])
                time.sleep(delay)
            except httpx.HTTPError as exc:                                  # network-level error
                if attempt == max_attempts:
                    raise ModelRunFailed(f"network error on create: {exc}")
                delay = self._retry_delay(attempt, "")
                LOG.warning("[%s] network error on create (attempt %d): %s; sleeping %.1fs", label, attempt, exc, delay)
                time.sleep(delay)
        raise ModelRunFailed("unreachable")

    @staticmethod
    def _retry_delay(attempt: int, detail: str) -> float:
        """Honour the server's hint ('resets in ~30s' / 'available in 1 second'), else exp backoff + jitter."""
        m = re.search(r"(\d+(?:\.\d+)?)\s*(?:s\b|sec|second)", detail or "")
        if m:
            return min(float(m.group(1)) + 0.5, 90.0)
        base = min(2.0 * (2 ** (attempt - 1)), 60.0)
        return base * random.uniform(0.8, 1.2)

    # -- wait -----------------------------------------------------------------
    def _wait_with_deadline(self, prediction, profile: ModelProfile, *, label: str):
        deadline = time.monotonic() + profile.timeout_s
        last_status, poll = None, 1.0
        while prediction.status not in ("succeeded", "failed", "canceled"):
            if time.monotonic() > deadline:
                try:
                    prediction.cancel()
                except Exception:  # noqa: BLE001 - best effort
                    pass
                raise PassTimeout(f"{profile.key} exceeded {profile.timeout_s}s (last status {prediction.status})")
            if prediction.status != last_status:
                LOG.info("[%s] prediction %s -> %s", label, prediction.id, prediction.status)
                last_status = prediction.status
            time.sleep(poll)
            poll = min(poll * 1.5, 5.0)
            try:
                prediction.reload()
            except (ReplicateError, httpx.HTTPError) as exc:                 # transient GET failure: keep polling
                LOG.warning("[%s] poll error: %s", label, exc)
        if prediction.status != "succeeded":
            err = str(prediction.error or f"status={prediction.status}")
            logs = (prediction.logs or "")[-2000:]
            oom = bool(self.OOM_PATTERNS.search(err + " " + logs))
            raise ModelRunFailed(f"{profile.key} {prediction.status}: {err}", oom=oom, retryable=True, logs=logs)
        return prediction

    # -- output ---------------------------------------------------------------
    @staticmethod
    def _first_output_url(output: Any, profile: ModelProfile) -> str:
        if isinstance(output, list):
            if not output:
                raise ModelRunFailed(f"{profile.key} returned an empty output list", retryable=True)
            output = output[0]
        url = getattr(output, "url", output)
        if not isinstance(url, str) or not (url.startswith("http") or url.startswith("data:")):
            raise ModelRunFailed(f"{profile.key} returned an unexpected output: {output!r}", retryable=False)
        return url

    def _download_with_retry(self, url: str, attempts: int = 4) -> bytes:
        """replicate.delivery URLs expire after ONE HOUR: download immediately, never store the URL."""
        if url.startswith("data:"):
            import base64
            return base64.b64decode(url.split(",", 1)[1])
        for attempt in range(1, attempts + 1):
            try:
                r = self.http.get(url)
                r.raise_for_status()
                if len(r.content) < 1024:
                    raise ModelRunFailed("downloaded output is suspiciously small", retryable=True)
                return r.content
            except (httpx.HTTPError, ModelRunFailed) as exc:
                if attempt == attempts:
                    raise ModelRunFailed(f"download failed after {attempts} attempts: {exc}")
                time.sleep(2.0 * attempt)
        raise ModelRunFailed("unreachable")


# =============================================================================
# Quality tracking (local, no API): sharpness, round-trip PSNR, colour drift
# =============================================================================
class QualityTracker:
    REF_LONG_EDGE = 1024  # metrics are computed at a fixed size so passes are comparable

    @staticmethod
    def _ref(im: Image.Image, size: Optional[tuple[int, int]] = None) -> Image.Image:
        im = im.convert("RGB")
        if size is None:
            s = QualityTracker.REF_LONG_EDGE / max(im.size)
            size = (max(1, round(im.width * s)), max(1, round(im.height * s)))
        return im.resize(size, Image.Resampling.LANCZOS)

    @staticmethod
    def sharpness(im: Image.Image) -> float:
        """Variance of the Laplacian on a 1024px reference copy."""
        a = np.asarray(QualityTracker._ref(im).convert("L"), dtype=np.float32)
        lap = a[:-2, 1:-1] + a[2:, 1:-1] + a[1:-1, :-2] + a[1:-1, 2:] - 4.0 * a[1:-1, 1:-1]
        return float(lap.var())

    @staticmethod
    def round_trip(prev: Image.Image, new: Image.Image) -> tuple[float, float]:
        """Downsample `new` back to `prev` resolution: PSNR (structure) and mean colour drift (0-255)."""
        size = QualityTracker._ref(prev).size
        a = np.asarray(QualityTracker._ref(prev, size), dtype=np.float32)
        b = np.asarray(QualityTracker._ref(new, size), dtype=np.float32)
        mse = float(np.mean((a - b) ** 2))
        psnr = 99.0 if mse < 1e-9 else 10.0 * math.log10(255.0 ** 2 / mse)
        drift = float(np.mean(np.abs(a.reshape(-1, 3).mean(0) - b.reshape(-1, 3).mean(0))))
        return psnr, drift

    @classmethod
    def compare(cls, prev_path: Path, new_path: Path, cfg: PipelineConfig) -> dict:
        with Image.open(prev_path) as p, Image.open(new_path) as n:
            s_prev, s_new = cls.sharpness(p), cls.sharpness(n)
            psnr, drift = cls.round_trip(p, n)
        ratio = s_new / s_prev if s_prev > 1e-6 else 1.0
        flags = []
        if ratio < cfg.sharpness_drop_ratio:
            flags.append(f"over-smoothing (sharpness x{ratio:.2f})")
        if ratio > cfg.sharpness_spike_ratio:
            flags.append(f"over-sharpening/halo risk (sharpness x{ratio:.2f})")
        if psnr < cfg.min_round_trip_psnr:
            flags.append(f"structural drift (round-trip PSNR {psnr:.1f} dB)")
        if drift > cfg.max_color_drift:
            flags.append(f"colour drift ({drift:.1f}/255)")
        return {"sharpness_prev": round(s_prev, 2), "sharpness_new": round(s_new, 2),
                "sharpness_ratio": round(ratio, 3), "round_trip_psnr_db": round(psnr, 2),
                "color_drift": round(drift, 2), "flags": flags}



# =============================================================================
# Print suitability checker
# =============================================================================
@dataclass
class PrintSpec:
    """Target print dimensions in inches. Supply either (width_in, height_in) or one side + aspect."""
    width_in: Optional[float] = None     # e.g. 24.0
    height_in: Optional[float] = None    # e.g. 16.0
    min_ppi_sharp: int = 150             # large-format sharp (poster/banner viewed at arm's length)
    min_ppi_acceptable: int = 100        # minimum for large prints viewed at >1 m

    NAMED = {
        "150x100": (150.0, 100.0), "100x150": (150.0, 100.0),
        "150x150": (150.0, 150.0),
        "a0": (118.9, 84.1), "a1": (84.1, 59.4), "a2": (59.4, 42.0),
        "a3": (42.0, 29.7), "a4": (29.7, 21.0),
    }

    @classmethod
    def from_string(cls, s: str, **kw) -> "PrintSpec":
        """Parse named shortcuts (150x100, a1 ...) or '24x16in', '60x40cm', '24' (square)."""
        key = s.strip().lower().replace(" ", "").rstrip("cm")
        if key in cls.NAMED:
            w_cm, h_cm = cls.NAMED[key]
            return cls(width_in=round(w_cm/2.54, 4), height_in=round(h_cm/2.54, 4), **kw)
        s2 = s.strip().lower().replace(" ", "")
        cm = s2.endswith("cm"); s2 = s2.rstrip("incm").rstrip("x").strip()
        parts = re.split(r"[x\xd7,]", s2)
        dims = [float(p) for p in parts if p]
        if cm:
            dims = [d / 2.54 for d in dims]
        w = dims[0]; h = dims[1] if len(dims) > 1 else dims[0]
        return cls(width_in=w, height_in=h, **kw)


@dataclass
class PrintReport:
    long_px: int
    short_px: int
    print_spec: Optional[PrintSpec]
    # computed
    long_in: Optional[float] = None
    short_in: Optional[float] = None
    ppi_long: Optional[float] = None
    grade: str = "unspecified"           # sharp | acceptable | marginal | poor | unspecified
    max_sharp_in: float = 0.0            # max long-edge inches at 300 PPI
    max_acceptable_in: float = 0.0       # max long-edge inches at 150 PPI
    recommendation: str = ""

    def __post_init__(self) -> None:
        sp = self.print_spec
        sharp_ppi = sp.min_ppi_sharp if sp else 150
        acc_ppi = sp.min_ppi_acceptable if sp else 100
        self.max_sharp_in = round(self.long_px / sharp_ppi, 2)
        self.max_acceptable_in = round(self.long_px / acc_ppi, 2)
        if sp and sp.width_in and sp.height_in:
            self.long_in = max(sp.width_in, sp.height_in)
            self.short_in = min(sp.width_in, sp.height_in)
            # PPI at which the image maps onto the sheet: the binding axis of a contained fit (equals the
            # long-edge PPI when the image is at least as elongated as the sheet, else the short-edge PPI)
            ppi_l, ppi_s = self.long_px / self.long_in, self.short_px / self.short_in
            self.ppi_long = round(max(ppi_l, ppi_s), 1)
            axis_px, axis_in = (self.long_px, self.long_in) if ppi_l >= ppi_s else (self.short_px, self.short_in)
            ppi = self.ppi_long
            sharp_t = sp.min_ppi_sharp; acc_t = sp.min_ppi_acceptable
            if ppi >= 300:
                self.grade = "photo-sharp"   # fine-art at this size
            elif ppi >= sharp_t:
                self.grade = "sharp"          # large-format sharp
            elif ppi >= (sharp_t + acc_t) / 2:
                self.grade = "acceptable"
            elif ppi >= acc_t:
                self.grade = "marginal"
            else:
                self.grade = "poor"
            self.recommendation = (
                f"{axis_px}px / {round(axis_in, 1)}in = {ppi} PPI -> {self.grade.upper()}. "
                f"Max sharp ({sharp_t} PPI): {self.max_sharp_in}in long edge. "
                f"Max acceptable ({acc_t} PPI): {self.max_acceptable_in}in long edge."
            )
        else:
            self.recommendation = (
                f"No print size specified. Max long edge: {round(self.max_sharp_in*2.54)}cm at {sharp_ppi} PPI (sharp), "
                f"{round(self.max_acceptable_in*2.54)}cm at {acc_ppi} PPI (acceptable), "
                f"{round(self.long_px/300*2.54)}cm at 300 PPI (photo)."
            )


def check_print(meta: ImageMeta, spec: Optional[PrintSpec]) -> PrintReport:
    r = PrintReport(long_px=meta.long_edge, short_px=min(meta.width, meta.height), print_spec=spec)
    if spec and spec.width_in and spec.height_in:
        img_aspect = meta.long_edge / max(1, min(meta.width, meta.height))
        print_aspect = max(spec.width_in, spec.height_in) / min(spec.width_in, spec.height_in)
        if abs(img_aspect - print_aspect) / print_aspect > 0.05:
            r.recommendation += (f" Aspect mismatch: image {img_aspect:.2f}:1 vs print {print_aspect:.2f}:1 "
                                 f"-> expect crop or margins.")
    mark = {"photo-sharp": "OK", "sharp": "OK", "acceptable": "~", "marginal": "!", "poor": "X", "unspecified": "?"}
    LOG.info("[print] %s %s", mark.get(r.grade, "?"), r.recommendation)
    return r

# =============================================================================
# Stage 3 -- pass planning + execution
# =============================================================================
def plan_passes(long_edge: int, target: int, max_scale: float, max_passes: int, overshoot: float) -> list[float]:
    """Static plan for logging/cost estimates. The loop re-measures real dims after every pass."""
    plan, cur = [], float(long_edge)
    while cur < target and len(plan) < max_passes:
        f = min(max_scale, (target / cur) * (1 + overshoot))
        plan.append(round(f, 3))
        cur *= f
    return plan


def choose_scale(profile: ModelProfile, remaining: float, overshoot: float) -> float:
    """Continuous models: exact remainder (+overshoot) capped at native max.
    Enum models: smallest allowed factor >= remainder, else the largest (loop continues)."""
    want = remaining * (1 + overshoot)
    if profile.allowed_scales:
        for s in profile.allowed_scales:
            if s >= want:
                return s
        return profile.allowed_scales[-1]
    return min(profile.max_scale, want)


def local_resize(src: Path, dst: Path, scale: float) -> Path:
    with Image.open(src) as im:
        size = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
        out = im.resize(size, Image.Resampling.LANCZOS)
        out.save(dst, "PNG", compress_level=1)
    return dst


def simulate_upscale(src: Path, dst: Path, scale: float) -> Path:
    """--dry-run stand-in for the API: Lanczos + mild unsharp mask, so the loop can be tested offline."""
    with Image.open(src) as im:
        size = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
        out = im.resize(size, Image.Resampling.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.5, percent=60))
        out.save(dst, "PNG", compress_level=1)
    return dst


def prepare_model_input(src: Path, profile: ModelProfile) -> Path:
    """Flatten alpha for models that do not support it (white matte) -- keeps the API call from failing."""
    with Image.open(src) as im:
        if im.mode == "RGBA" and not profile.supports_alpha:
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.getchannel("A"))
            flat = src.with_name(src.stem + "_rgb.png")
            bg.save(flat, "PNG", compress_level=1)
            return flat
    return src


# =============================================================================
# Tiled upscaling -- keeps every API call inside the model's input envelope
# =============================================================================
@dataclass(frozen=True)
class Tile:
    index: int
    x0: int
    y0: int
    x1: int
    y1: int


def plan_tiles(width: int, height: int, tile: int, overlap: int) -> list[Tile]:
    """Grid of <= tile px squares sharing `overlap` px with each neighbour; the last row/column is
    aligned to the far edge so no sliver tiles are produced."""
    def starts(length: int) -> list[int]:
        if length <= tile:
            return [0]
        step = max(1, tile - overlap)
        pts = list(range(0, length - tile, step))
        pts.append(length - tile)
        return pts
    tiles: list[Tile] = []
    for y0 in starts(height):
        for x0 in starts(width):
            tiles.append(Tile(len(tiles), x0, y0, min(x0 + tile, width), min(y0 + tile, height)))
    return tiles


def _ramp(length: int, ramp: int, at_start: bool, at_end: bool) -> np.ndarray:
    """1-D blend weights for an incoming tile: 0->1 over `ramp` px on sides that overlap an already-placed
    tile (top/left in raster order), 1 elsewhere."""
    w = np.ones(length, dtype=np.float32)
    ramp = max(1, min(ramp, length))
    if at_start:
        w[:ramp] = np.arange(1, ramp + 1, dtype=np.float32) / (ramp + 1)
    if at_end:
        pass                                    # right/bottom edges are blended by the NEXT tile's ramp
    return w


def stitch_tiles(tiles: list[Tile], outputs: dict[int, Path], src_size: tuple[int, int], k: int,
                 overlap: int, mode: str, margin: int, final_scale: float) -> Image.Image:
    """Tiles were upscaled by an INTEGER factor k, so tile pixel (i, j) is global pixel (k*y0+i, k*x0+j):
    registration is exact and no per-tile resampling phase error exists. Internal edges are trimmed by
    `margin` source px (model border artefacts), then tiles are composited in raster order with linear
    ramps across the remaining overlap. Finally one global Lanczos resize brings k -> final_scale."""
    sw, sh = src_size
    W, H = sw * k, sh * k
    C = len(mode)
    margin = max(0, min(margin, (overlap - 4) // 2))              # keep >= 4 source px of real overlap
    ramp = (overlap - 2 * margin) * k
    canvas = np.zeros((H, W, C), dtype=np.uint8)
    for t in tiles:                                                # tiles are generated in raster order
        with Image.open(outputs[t.index]) as im:
            im = im.convert(mode)
            want = ((t.x1 - t.x0) * k, (t.y1 - t.y0) * k)
            if im.size != want:                                    # model padded/rounded: force exact k x
                im = im.resize(want, Image.Resampling.LANCZOS)
            arr = np.asarray(im, dtype=np.float32)
        m = margin * k
        l, r = (m if t.x0 > 0 else 0), (m if t.x1 < sw else 0)
        u, d = (m if t.y0 > 0 else 0), (m if t.y1 < sh else 0)
        arr = arr[u:arr.shape[0] - d, l:arr.shape[1] - r]
        X0, Y0 = t.x0 * k + l, t.y0 * k + u
        X1, Y1 = X0 + arr.shape[1], Y0 + arr.shape[0]
        w = (_ramp(Y1 - Y0, ramp, t.y0 > 0, False)[:, None] * _ramp(X1 - X0, ramp, t.x0 > 0, False)[None, :])[:, :, None]
        region = canvas[Y0:Y1, X0:X1].astype(np.float32)
        canvas[Y0:Y1, X0:X1] = np.clip(np.round(region * (1.0 - w) + arr * w), 0, 255).astype(np.uint8)
    img = Image.fromarray(canvas, mode)
    if abs(final_scale - k) > 1e-6:
        img = img.resize((max(1, round(sw * final_scale)), max(1, round(sh * final_scale))), Image.Resampling.LANCZOS)
    return img


def run_pass_single(runner: ReplicateRunner, profile: ModelProfile, src: Path, dst: Path, scale: float,
                    cfg: PipelineConfig, *, label: str) -> dict:
    if cfg.dry_run:
        simulate_upscale(src, dst, scale)
        return {"model": profile.owner_name, "version": "dry-run", "prediction_id": None, "predict_time_s": None}
    payload = profile.build_input(prepare_model_input(src, profile), scale, cfg.extra_inputs)
    data, info = runner.run(profile, payload, label=label)
    dst.write_bytes(data)
    with Image.open(dst) as im:                 # re-encode to PNG so every intermediate is lossless + uniform
        if im.format != "PNG":
            im.load()
            im.save(dst, "PNG", compress_level=1)
    return info


def tile_factor(profile: ModelProfile, scale: float) -> float:
    """Integer request factor for tiles (exact registration); enum models use their smallest factor >= scale."""
    if profile.allowed_scales:
        return next((f for f in profile.allowed_scales if f >= scale - 1e-6), profile.allowed_scales[-1])
    return float(min(int(profile.max_scale), max(2, math.ceil(scale - 1e-6))))


def run_pass_tiled(runner: ReplicateRunner, profile: ModelProfile, src: Path, dst: Path, scale: float,
                   cfg: PipelineConfig, tile_size: int, *, label: str) -> dict:
    """Split -> N concurrent predictions at an integer factor k (each <= tile_size^2 px) -> composite
    -> one global Lanczos resize k -> scale -> PNG."""
    src_flat = prepare_model_input(src, profile)
    with Image.open(src_flat) as im:
        im.load()
        mode = im.mode if im.mode in ("RGB", "RGBA") else "RGB"
        base = im.convert(mode)
    k = tile_factor(profile, scale)
    tiles = plan_tiles(base.width, base.height, tile_size, cfg.tile_overlap)
    tdir = dst.parent / f"{dst.stem}_tiles"
    tdir.mkdir(parents=True, exist_ok=True)
    est_mb = base.width * k * base.height * k * len(mode) / 1e6
    LOG.info("[%s] tiling %dx%d -> %d tiles of <=%dpx at x%g (overlap %d, margin %d), %d workers, canvas ~%.0f MB",
             label, base.width, base.height, len(tiles), tile_size, k, cfg.tile_overlap, cfg.tile_margin,
             cfg.tile_workers, est_mb)

    for t in tiles:                                                # crop on the main thread; workers only call the API
        base.crop((t.x0, t.y0, t.x1, t.y1)).save(tdir / f"t{t.index:03d}_in.png", "PNG", compress_level=1)

    def do_tile(t: Tile) -> tuple[int, Path, dict]:
        tin = tdir / f"t{t.index:03d}_in.png"
        tout = tdir / f"t{t.index:03d}_out.png"
        if cfg.dry_run:
            simulate_upscale(tin, tout, k)
            return t.index, tout, {}
        for attempt in range(1, cfg.max_retries_per_pass + 2):
            try:
                data, info = runner.run(profile, profile.build_input(tin, k, cfg.extra_inputs),
                                        label=f"{label} tile {t.index + 1}/{len(tiles)}")
                tout.write_bytes(data)
                return t.index, tout, info
            except ModelRunFailed as exc:
                if exc.oom or not exc.retryable or attempt > cfg.max_retries_per_pass:
                    raise
                LOG.warning("[%s] tile %d attempt %d failed: %s", label, t.index, attempt, exc)
                time.sleep(3.0 * attempt)
        raise ModelRunFailed("unreachable")

    outputs: dict[int, Path] = {}
    predict_s = 0.0
    with ThreadPoolExecutor(max_workers=max(1, cfg.tile_workers)) as ex:
        futures = [ex.submit(do_tile, t) for t in tiles]
        try:
            for fut in as_completed(futures):
                idx, tout, info = fut.result()
                outputs[idx] = tout
                predict_s += float(info.get("predict_time_s") or 0.0)
                if len(outputs) % max(1, len(tiles) // 4) == 0 or len(outputs) == len(tiles):
                    LOG.info("[%s] tiles done %d/%d", label, len(outputs), len(tiles))
        except BaseException:
            for f in futures:
                f.cancel()
            raise
    stitched = stitch_tiles(tiles, outputs, base.size, int(k), cfg.tile_overlap, mode, cfg.tile_margin, scale)
    stitched.save(dst, "PNG", compress_level=1)
    for f in tdir.glob("t*_in.png"):
        f.unlink(missing_ok=True)                 # keep tile outputs for audit, drop the inputs
    return {"model": profile.owner_name, "version": ("dry-run" if cfg.dry_run else (profile.version or "latest")),
            "prediction_id": None, "predict_time_s": round(predict_s, 1), "tiles": len(tiles),
            "tile_size": tile_size, "tile_factor": k}


def run_pass(runner: ReplicateRunner, profile: ModelProfile, src: Path, dst: Path, scale: float,
             cfg: PipelineConfig, *, label: str) -> tuple[Path, dict]:
    """One pass. Large inputs are tiled; on GPU OOM the pass escalates: single -> tiled -> smaller tiles
    (a 4x network runs at 4x internally whatever `scale` says, so shrinking the INPUT is the only real fix);
    enum-factor models fall back to the next lower factor."""
    meta = read_meta(src)
    tile_size = cfg.tile_size
    use_tiles = cfg.tiling != "off" and profile.external_tiling_ok and (
        cfg.tiling == "always" or meta.megapixels > profile.max_input_mp)
    attempts = 0
    while True:
        attempts += 1
        try:
            if use_tiles:
                info = run_pass_tiled(runner, profile, src, dst, scale, cfg, tile_size, label=label)
            else:
                info = run_pass_single(runner, profile, src, dst, scale, cfg, label=label)
            info["scale_requested"] = round(scale, 3)
            info["attempts"] = attempts
            info["api_calls"] = 0 if cfg.dry_run else info.get("tiles", 1)
            return dst, info
        except ModelRunFailed as exc:
            if exc.oom:
                if not use_tiles and cfg.tiling != "off" and profile.external_tiling_ok:
                    use_tiles = True
                    LOG.warning("[%s] OOM on a single call -> switching to tiled mode (%dpx tiles)", label, tile_size)
                    continue
                if use_tiles and tile_size > 256:
                    tile_size //= 2
                    LOG.warning("[%s] OOM inside a tile -> halving tile size to %dpx", label, tile_size)
                    continue
                if profile.allowed_scales:
                    lower = [f for f in profile.allowed_scales if f < scale]
                    if lower:
                        LOG.warning("[%s] OOM at x%.2f -> stepping down to x%.2f", label, scale, lower[-1])
                        scale = lower[-1]
                        continue
            if not exc.retryable or attempts > cfg.max_retries_per_pass:
                raise
            LOG.warning("[%s] pass failed (attempt %d/%d): %s", label, attempts, cfg.max_retries_per_pass + 1, exc)
            time.sleep(3.0 * attempts)


def run_face_restore(runner: ReplicateRunner, src: Path, cfg: PipelineConfig, *, label: str) -> tuple[Path, dict]:
    profile = MODELS["codeformer"]
    dst = src.with_name("pass0_face_restored.png")
    if cfg.dry_run:
        shutil.copyfile(src, dst)
        return dst, {"model": profile.owner_name, "version": "dry-run"}
    payload = profile.build_input(prepare_model_input(src, profile), 1.0, cfg.extra_inputs)
    data, info = runner.run(profile, payload, label=label)
    dst.write_bytes(data)
    with Image.open(dst) as im:
        if im.format != "PNG":
            im.load()
            im.save(dst, "PNG", compress_level=1)
    return dst, info


# =============================================================================
# Stage 4 -- finalize + verify
# =============================================================================


# =============================================================================
# Texture / grain overlay (Stage 4 pre-step)
# =============================================================================
TEXTURE_MODES = ("multiply", "overlay", "soft-light", "grain", "grain-color")
TEXTURE_BAND_ROWS = 512      # rows per float32 working band: a 9000 px wide band is ~55 MB per temporary


def _load_texture(path: str, size: tuple[int, int]) -> np.ndarray:
    """Repeat (tile) the texture file over `size` = (w, h); returns uint8 HxWx3."""
    with Image.open(path) as t:
        t = ImageOps.exif_transpose(t).convert("RGB")
        tw, th = t.size
        tile = np.asarray(t, dtype=np.uint8)
    w, h = size
    return np.tile(tile, (math.ceil(h / th), math.ceil(w / tw), 1))[:h, :w]


def apply_texture(im: Image.Image, cfg: PipelineConfig) -> Image.Image:
    """Blend a paper/canvas texture tile or synthetic film grain into the finished image (Stage 4: after the exact
    trim, fit and sharpen; before colour conversion and bleed). Processed in horizontal bands so a 9000x6000
    delivery needs a few hundred MB, not several GB of float32 temporaries. Fixed seeds: re-runs are identical."""
    tf = cfg.texture_file
    if not tf:
        return im
    # "grain" / "grain-color" work both as --texture-mode and as the --texture shorthand
    mode = tf if tf in ("grain", "grain-color") else cfg.texture_mode
    if mode not in TEXTURE_MODES:
        raise ValidationError(f"unknown texture_mode {mode!r} (use {', '.join(TEXTURE_MODES)})")
    st = max(0.0, min(1.0, cfg.texture_strength))
    src = np.asarray(im.convert("RGB") if im.mode != "RGB" else im, dtype=np.uint8)
    h, w = src.shape[:2]
    tex = _load_texture(tf, (w, h)) if mode in ("multiply", "overlay", "soft-light") else None
    rng = np.random.default_rng(42 if mode == "grain" else 1337)
    out = np.empty_like(src)
    for y0 in range(0, h, TEXTURE_BAND_ROWS):
        y1 = min(h, y0 + TEXTURE_BAND_ROWS)
        a = src[y0:y1].astype(np.float32)
        if mode == "grain":                                    # luminance grain, clipped to +-40 levels
            g = rng.standard_normal((y1 - y0, w), dtype=np.float32) * (st * 24.0)
            a += np.clip(g, -40.0, 40.0)[:, :, None]
        elif mode == "grain-color":                            # independent per-channel (colour) grain
            a += rng.standard_normal((y1 - y0, w, 3), dtype=np.float32) * (st * 20.0)
        else:
            t = tex[y0:y1].astype(np.float32)
            if mode == "multiply":
                b = a * t / 255.0
            elif mode == "overlay":
                b = np.where(a < 128.0, 2.0 * a * t / 255.0, 255.0 - 2.0 * (255.0 - a) * (255.0 - t) / 255.0)
            else:                                              # soft-light (Pegtop form)
                b = a * (255.0 + (2.0 * t - 255.0) * (1.0 - a / 255.0)) / 255.0
            a = a * (1.0 - st) + b * st
        out[y0:y1] = np.clip(np.rint(a), 0, 255).astype(np.uint8)
    result = Image.fromarray(out, "RGB")
    if im.mode == "RGBA":
        result.putalpha(im.getchannel("A"))
    return result


# =============================================================================
# Print-quality fix + re-check (Stage 4, v1.4) -- the pipeline side of the Print Quality Auditor
# =============================================================================
PRINT_QUALITY_SUBSTRATES = {"coated": 300, "uncoated": 260, "canvas": 280, "vinyl": 300, "textile": 250}
PRINT_FIX_BAND_ROWS = 512
PRINT_FIX_RADIUS = 6          # deband smoothing radius in output px (about 1 mm at 150 PPI)
PRINT_FIX_DITHER = 1.2        # triangular dither amplitude, 8-bit levels
PRINT_CHECK_LONG_EDGE = 2400  # ink / black-floor checks run on a box-filtered copy of this size (area average: no ringing)
PRINT_CHECK_LINES = 1200      # banding is scanned on this many full-resolution rows + columns (resizing hides it)
PRINT_CHECK_MIN_PLATEAU = 6   # shorter runs of one value occur by chance in dithered tone and are not steps


def _cmyk_tac(rgb: np.ndarray) -> np.ndarray:
    """Total area coverage (%) of a heavy-GCR sRGB->CMYK separation, per pixel (float32 HxW). The same
    approximation the Print Quality Auditor uses: neutral RGB 0,0,0 -> about C74 M70 Y68 K92 = 304%."""
    a = rgb.astype(np.float32) / 255.0
    c0, m0, y0 = 1.0 - a[..., 0], 1.0 - a[..., 1], 1.0 - a[..., 2]
    k0 = np.minimum(np.minimum(c0, m0), y0)
    k = np.where(k0 <= 0.3, 0.0, 0.92 * np.power(np.clip((k0 - 0.3) / 0.7, 0.0, None), 1.25))
    return (np.clip(c0 - 0.28 * k, 0, 1) + np.clip(m0 - 0.33 * k, 0, 1) + np.clip(y0 - 0.35 * k, 0, 1) + k) * 100.0


def _black_floor_for(limit: int, margin: float = 3.0) -> int:
    """Lowest neutral grey level whose ink coverage stays `margin` % under the substrate limit (23 for 280%)."""
    for g in range(0, 128):
        if float(_cmyk_tac(np.array([[[g, g, g]]], dtype=np.uint8))[0, 0]) <= limit - margin:
            return g
    return 128


def _box_blur(a: np.ndarray, radius: int, axis: int) -> np.ndarray:
    """Running mean of width 2*radius+1 along `axis` (edge-padded), from a cumulative sum."""
    pad = [(0, 0)] * a.ndim
    pad[axis] = (radius + 1, radius)
    c = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis, dtype=np.float64)
    n = c.shape[axis]
    hi = np.take(c, range(2 * radius + 1, n), axis=axis)
    lo = np.take(c, range(0, n - 2 * radius - 1), axis=axis)
    return ((hi - lo) / (2 * radius + 1)).astype(np.float32)


def apply_print_fix(im: Image.Image, cfg: PipelineConfig) -> Image.Image:
    """Fix what the print-quality audit flags on every delivered file (Stage 4: after texture, before colour
    and bleed, in the working RGB numbers):
      - ink coverage over the substrate limit: a neutral toe lift, driven by a pixel's brightest channel and
        fading out by level `knee` (96 for canvas), raises the deepest shadow to the grey whose separation
        stays under the limit (level 23 for 280%). Pure RGB 0,0,0 (four-plate rich black) and the crushed
        black floor go with it; a saturated colour keeps its hue, because all three channels move together
        and only when the whole pixel is dark;
      - 8-bit banding in soft dark gradients: edge-aware box smoothing (only where the local tone is flat
        to within 3 levels) plus triangular dither, both confined to dark and lower-mid tones (fading out
        from luminance 110 to 150, the range where 8-bit steps print), before the single re-quantisation.
    Processed in float32 bands; fixed seed, so re-runs are byte-identical."""
    if not cfg.print_fix:
        return im
    limit = PRINT_QUALITY_SUBSTRATES.get(cfg.print_fix_substrate, 280)
    floor = _black_floor_for(limit)
    knee = max(96.0, 2.0 * floor)            # >= 2*floor keeps v + floor*(1-v/knee)^2 monotonic
    src = np.asarray(im.convert("RGB") if im.mode != "RGB" else im, dtype=np.uint8)
    h, w = src.shape[:2]
    r, ov = PRINT_FIX_RADIUS, 3 * PRINT_FIX_RADIUS
    rng = np.random.default_rng(20260915)
    out = np.empty_like(src)
    for y0 in range(0, h, PRINT_FIX_BAND_ROWS):
        y1 = min(h, y0 + PRINT_FIX_BAND_ROWS)
        a0, a1 = max(0, y0 - ov), min(h, y1 + ov)
        band = src[a0:a1].astype(np.float32)
        t = np.clip(1.0 - band.max(axis=2, keepdims=True) / knee, 0.0, 1.0)
        lifted = band + floor * t * t                                    # dark pixels only, all channels alike
        tone = np.clip((150.0 - (0.2126 * lifted[..., 0] + 0.7152 * lifted[..., 1] + 0.0722 * lifted[..., 2])) / 40.0,
                       0.0, 1.0)[..., None]                              # 1 in the shadows, 0 above luminance 150
        smooth = lifted
        for _ in range(2):
            smooth = _box_blur(_box_blur(smooth, r, 1), r, 0)
        flat = np.clip((3.0 - np.abs(smooth - lifted).max(axis=2, keepdims=True)) / 1.5, 0.0, 1.0) * tone
        deband = lifted + flat * (smooth - lifted)                       # edges and light tones keep their value
        weight = np.maximum(flat, t * tone)                              # dither where tone was smoothed or lifted
        s0, s1 = y0 - a0, y1 - a0
        shape = (y1 - y0, w, 1)
        noise = (rng.random(shape, dtype=np.float32) - rng.random(shape, dtype=np.float32)) * PRINT_FIX_DITHER
        out[y0:y1] = np.clip(np.rint(deband[s0:s1] + weight[s0:s1] * noise), 0, 255).astype(np.uint8)
    result = Image.fromarray(out, "RGB")
    if im.mode == "RGBA":
        result.putalpha(im.getchannel("A"))
    return result


@dataclass
class PrintQualityReport:
    """Re-check of the delivered pixels against the thresholds the Print Quality Auditor grades on."""
    substrate: str
    ink_limit: int
    tac_p999: float             # 99.9th percentile total area coverage, %
    tac_over_limit_pct: float   # share of the image over the substrate ink limit
    clip_black_pct: float       # share of pixels at the black floor (luminance <= 3)
    neutral_black_pct: float    # share of pixels that are neutral RGB black (four-plate rich black)
    band_stepped_pct: float     # share of the scanned lines lying in stepped plateaus (>= 6 px) of smooth dark gradients
    band_step_px: int           # 90th-percentile plateau width, px
    band_step_mm: float         # the same at the delivered PPI (0 when no PPI is known)
    band_score: Optional[float] = None   # the auditor's Tier C banding score (1-10) at the sheet's viewing distance
    flags: list[str] = field(default_factory=list)
    grade: str = "ok"           # ok | caveats | critical


def _luma(rgb: np.ndarray) -> np.ndarray:
    return (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2] + 0.5).astype(np.int16)


def _plateaus(a: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Stepped plateaus along axis 1 of int16 luminance lines: runs of >= 3 equal values inside a smooth dark
    gradient (2 <= L < 150, |L[x+1]-L[x-1]| <= 3) whose neighbours on both sides are runs at most 3 levels
    away. Returns the run lengths and, per run, whether the step skips a level (posterisation)."""
    h = a.shape[0]
    grad = np.full(a.shape, 99, np.int16)
    grad[:, 1:-1] = np.abs(a[:, 2:] - a[:, :-2])
    smooth = (a >= 2) & (a < 150) & (grad <= 3)
    af = np.concatenate([a, np.full((h, 1), -999, np.int16)], axis=1).ravel()   # sentinel ends every line
    sf = np.concatenate([smooth, np.zeros((h, 1), bool)], axis=1).ravel()
    prev_s = np.concatenate(([False], sf[:-1]))
    prev_v = np.concatenate(([-999], af[:-1]))
    start = sf & (~prev_s | (af != prev_v))
    st = np.flatnonzero(start)
    if st.size < 3:
        return np.zeros(0, int), np.zeros(0, bool)
    brk = np.flatnonzero(start | ~sf)
    nxt = np.searchsorted(brk, st, side="right")
    end = np.where(nxt < brk.size, brk[np.minimum(nxt, brk.size - 1)], af.size)
    ln, v = end - st, af[st].astype(int)
    touch = np.zeros(st.size, bool)
    touch[1:] = end[:-1] == st[1:]                       # run i-1 ends exactly where run i starts
    dv = np.abs(np.diff(v))
    dv_prev, dv_next = np.concatenate(([99], dv)), np.concatenate((dv, [99]))
    adj_prev, adj_next = touch, np.concatenate((touch[1:], [False]))
    keep = adj_prev & (dv_prev <= 3) & adj_next & (dv_next <= 3) & (ln >= 3)
    return ln[keep], dv_next[keep] >= 2


def _band_score(step_mm: float, stepped_pct: float, sheet_cm: tuple[float, float]) -> float:
    """The Print Quality Auditor's Tier C banding score: plateau width in arc-minutes at the viewing distance it
    assumes for the sheet (1.6 x the long side, 60-400 cm), 9.6 up to 1.5 arc-min, 7 at 6 arc-min."""
    if stepped_pct < 0.2:
        return 10.0
    dist_cm = round(min(400.0, max(60.0, max(sheet_cm) * 1.6)) / 10) * 10
    v = step_mm / (dist_cm * 10) * 3438 / 3
    if v <= 0.5:
        score = 9.6
    elif v <= 1:
        score = 9.6 - (v - 0.5) * 1.4
    elif v <= 2:
        score = 8.9 - (v - 1) * 1.9
    else:
        score = max(3.0, 7 - (v - 2) * 1.5)
    if stepped_pct < 2.0:
        score = max(score, 8.0)
    return round(score, 1)


def check_print_quality(im: Image.Image, substrate: str, ppi: float = 0.0,
                        sheet_cm: Optional[tuple[float, float]] = None) -> PrintQualityReport:
    """Ink coverage, black floor and neutral black are measured on an area-averaged copy (long edge
    PRINT_CHECK_LONG_EDGE; a box filter, so sharp edges cannot ring into false black); banding on every k-th
    full-resolution row and column, because resizing averages the steps away, counting plateaus of at least
    PRINT_CHECK_MIN_PLATEAU px. With the sheet size the banding is graded the way the auditor grades Tier C.
    Runs on the working RGB numbers, i.e. after --print-fix and before any --icc-target conversion."""
    limit = PRINT_QUALITY_SUBSTRATES.get(substrate, 280)
    if im.mode == "RGBA":                    # what prints is the image over the (white) sheet, not the hidden RGB
        rgb = Image.new("RGB", im.size, (255, 255, 255))
        rgb.paste(im, mask=im.getchannel("A"))
    else:
        rgb = im if im.mode == "RGB" else im.convert("RGB")
    s = min(1.0, PRINT_CHECK_LONG_EDGE / max(im.size))
    small = rgb.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.Resampling.BOX) \
        if s < 1.0 else rgb
    a = np.asarray(small, dtype=np.uint8)
    tac = _cmyk_tac(a)
    lum = _luma(a)
    mx, mn = a.max(axis=2).astype(np.int16), a.min(axis=2).astype(np.int16)

    full = np.asarray(rgb, dtype=np.uint8)
    k = max(1, round((im.width + im.height) / PRINT_CHECK_LINES))
    rows, cols = full[::k], np.ascontiguousarray(full[:, ::k].transpose(1, 0, 2))
    ln_r, _ = _plateaus(_luma(rows))
    ln_c, _ = _plateaus(_luma(cols))
    lengths = np.concatenate([ln_r, ln_c])
    lengths = lengths[lengths >= PRINT_CHECK_MIN_PLATEAU]
    scanned = rows.shape[0] * im.width + cols.shape[0] * im.height
    stepped = float(lengths.sum())
    if stepped:
        order = np.argsort(lengths)
        cum = np.cumsum(lengths[order])
        step_px = int(lengths[order][min(len(order) - 1, np.searchsorted(cum, 0.9 * stepped))])
    else:
        step_px = 0
    r = PrintQualityReport(
        substrate=substrate, ink_limit=limit,
        tac_p999=round(float(np.percentile(tac, 99.9)), 1),
        tac_over_limit_pct=round(float((tac > limit).mean()) * 100, 2),
        clip_black_pct=round(float((lum <= 3).mean()) * 100, 2),
        neutral_black_pct=round(float(((mx <= 20) & (mx - mn <= 6)).mean()) * 100, 2),
        band_stepped_pct=round(stepped / scanned * 100, 2),
        band_step_px=step_px, band_step_mm=round(step_px / ppi * 25.4, 2) if ppi else 0.0,
    )
    if ppi and sheet_cm:
        r.band_score = _band_score(r.band_step_mm, r.band_stepped_pct, sheet_cm)
    if r.tac_over_limit_pct > 1.0:
        r.flags.append(f"ink coverage over {limit}% on {r.tac_over_limit_pct:g}% of the image (peak {r.tac_p999:g}%)")
    if r.clip_black_pct > 5.0:
        r.flags.append(f"{r.clip_black_pct:g}% of the image is crushed to black")
    if r.neutral_black_pct > 1.0:
        r.flags.append(f"{r.neutral_black_pct:g}% neutral RGB black (four-plate rich black, registration risk)")
    if r.band_score is not None:             # the auditor's bands: 9+ production, 7-8.9 caveats, below 7 critical
        band_caveat, band_critical = r.band_score < 9.0, r.band_score < 7.0
        band_text = f"banding score {r.band_score:g}/10: {r.band_step_mm:g} mm steps over {r.band_stepped_pct:g}% of the image"
    else:                                    # no sheet: 2 mm / 12 px steps over more than 5% of the image
        wide = r.band_step_mm >= 2.0 if ppi else r.band_step_px >= 12
        band_caveat = r.band_stepped_pct > 5.0 and wide
        band_critical = r.band_stepped_pct > 10.0 and (r.band_step_mm >= 3.0 if ppi else r.band_step_px >= 18)
        band_text = (f"banding: {r.band_stepped_pct:g}% of the image steps in "
                     f"{f'{r.band_step_mm:g} mm' if ppi else f'{r.band_step_px} px'} plateaus")
    if band_caveat:
        r.flags.append(band_text)
    critical = r.tac_over_limit_pct > 5.0 or r.clip_black_pct > 15.0 or band_critical
    r.grade = "critical" if critical else ("caveats" if r.flags else "ok")
    return r


def required_long_edge(meta: ImageMeta, spec: PrintSpec, ppi: float, fit: str) -> int:
    """Pixels on the image's long edge so that the sheet is covered at `ppi` after fit=crop, or fully
    contained for fit=none/pad. Sheet and image are compared as long:short ratios (the shop rotates)."""
    sheet_long, sheet_short = max(spec.width_in, spec.height_in), min(spec.width_in, spec.height_in)
    a_sheet, a_img = sheet_long / sheet_short, meta.long_edge / max(1, min(meta.width, meta.height))
    if fit == "crop":
        # image more elongated than the sheet: its short edge must span the sheet's short edge
        return math.ceil(sheet_short * ppi * a_img) if a_img >= a_sheet else math.ceil(sheet_long * ppi)
    # contained: the more elongated side hits the sheet first
    return math.ceil(sheet_long * ppi) if a_img >= a_sheet else math.ceil(sheet_short * ppi * a_img)


def delivered_ppi(width: int, height: int, spec: PrintSpec) -> float:
    """PPI at which the (trim) image maps onto the sheet when printed as large as the sheet allows without
    cropping: the binding axis, i.e. the LARGER of the two px/inch ratios. (A 1575x1575 file on a 150x100 sheet
    prints 100x100 cm at 40 PPI -- the short axis binds; the long-edge ratio would say 26.7 and, used as the
    dpi tag, would open the file larger than the sheet.)"""
    sheet_long, sheet_short = max(spec.width_in, spec.height_in), min(spec.width_in, spec.height_in)
    img_long, img_short = max(width, height), min(width, height)
    return round(max(img_long / sheet_long, img_short / sheet_short), 1)


def fit_to_sheet(im: Image.Image, spec: PrintSpec, mode: str) -> Image.Image:
    """crop: centred crop to the sheet's long:short ratio. pad: white canvas at that ratio, image centred.
    The sheet follows the image's orientation (a portrait image on a 150x100 sheet is printed 100x150)."""
    sheet_long, sheet_short = max(spec.width_in, spec.height_in), min(spec.width_in, spec.height_in)
    a_sheet = sheet_long / sheet_short
    w, h = im.size
    ratio = a_sheet if w >= h else 1.0 / a_sheet             # target width/height in the image's orientation
    if mode == "crop":
        # ceil: an image already at the sheet ratio must not lose a pixel to float rounding (2362.5 -> 2362)
        tw, th = min(w, math.ceil(h * ratio - 1e-6)), min(h, math.ceil(w / ratio - 1e-6))
        l, t = (w - tw) // 2, (h - th) // 2
        return im.crop((l, t, l + tw, t + th))
    if mode == "pad":
        tw, th = max(w, round(h * ratio)), max(h, round(w / ratio))
        canvas = Image.new(im.mode, (tw, th), (255,) * len(im.mode))
        canvas.paste(im, ((tw - w) // 2, (th - h) // 2))
        return canvas
    return im


def add_bleed(im: Image.Image, px: int) -> Image.Image:
    """Mirrored-edge bleed (what large-format shops expect instead of a white border)."""
    if px <= 0:
        return im
    arr = np.asarray(im)
    pad = ((px, px), (px, px)) + (((0, 0),) if arr.ndim == 3 else ())
    return Image.fromarray(np.pad(arr, pad, mode="reflect"), im.mode)


def apply_colour(im: Image.Image, src_meta: ImageMeta, cfg: PipelineConfig) -> tuple[Image.Image, Optional[bytes], str]:
    """Return (image, icc bytes to embed, profile name). Keeps the source profile (pixel numbers were never
    converted, so it still describes them), assumes sRGB when there was none, or converts into --icc-target."""
    src_icc = Path(src_meta.icc_path).read_bytes() if src_meta.icc_path else None
    name = src_meta.icc_name or "sRGB IEC61966-2.1 (assumed, built-in profile embedded)"
    space = icc_header(src_icc).get("space")
    if src_icc and space != "RGB":
        # the working pixels are RGB; a CMYK or grey source profile no longer describes them
        LOG.warning("[colour] source profile %r is %s, not RGB: sRGB is assumed for the delivery",
                    src_meta.icc_name, space or "not a valid ICC profile")
        name = f"sRGB IEC61966-2.1 (assumed; the source profile '{src_meta.icc_name}' is {space or 'not a valid ICC profile'}, not RGB)"
        src_icc = None
    icc = src_icc or srgb_profile_bytes()
    if cfg.icc_target:
        if not HAS_CMS:
            raise VerificationError("--icc-target needs Pillow with littlecms (ImageCms)")
        if icc_header(Path(cfg.icc_target).read_bytes()).get("space") != "RGB":
            raise VerificationError("--icc-target must be an RGB profile for an RGB delivery")
        dst = ImageCms.ImageCmsProfile(str(cfg.icc_target))
        srcp = ImageCms.ImageCmsProfile(io.BytesIO(src_icc)) if src_icc else ImageCms.createProfile("sRGB")
        alpha = im.getchannel("A") if im.mode == "RGBA" else None
        im = ImageCms.profileToProfile(im.convert("RGB"), srcp, dst,
                                       renderingIntent=ImageCms.Intent.PERCEPTUAL, outputMode="RGB")
        if alpha is not None:
            im.putalpha(alpha)
        icc = Path(cfg.icc_target).read_bytes()
        name = icc_description(icc)
    return im, icc, name


# =============================================================================
# PDF delivery: one page, the image at print size, lossless, ICC embedded, PDF/X-4 intent with a printer profile
# =============================================================================
PDF_BAND_ROWS = 512
_XML_BAD = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _clean_text(s: str) -> str:
    """ASCII-only text without control characters, used identically in the Info dict and in XMP so they agree."""
    return _XML_BAD.sub("", s.encode("ascii", "replace").decode("ascii"))


def _pdf_text(s: str) -> bytes:
    """PDF literal string from cleaned text: the delimiters and line ends escaped."""
    s = _clean_text(s).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").replace("\r", "\\r").replace("\n", "\\n")
    return b"(" + s.encode("ascii") + b")"


def _pdf_num(v: float) -> str:
    return f"{v:.4f}".rstrip("0").rstrip(".")


def _pdf_date(dt: datetime) -> bytes:
    return dt.astimezone(timezone.utc).strftime("(D:%Y%m%d%H%M%S+00'00')").encode("ascii")


def _uuid_like(seed: str) -> str:
    h = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def _xmp_packet(title: str, producer: str, created: datetime, doc_id: str, instance_id: str,
                pdfx: bool, subject: Optional[str]) -> bytes:
    stamp = created.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    xml = (
        '<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n'
        ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n'
        '  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"'
        ' xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"'
        ' xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/">\n'
        f'   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">{xml_escape(title)}</rdf:li></rdf:Alt></dc:title>\n'
        + (f'   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">{xml_escape(subject)}</rdf:li></rdf:Alt></dc:description>\n'
           if subject else '')
        + f'   <xmp:CreateDate>{stamp}</xmp:CreateDate><xmp:ModifyDate>{stamp}</xmp:ModifyDate>'
        f'<xmp:MetadataDate>{stamp}</xmp:MetadataDate>\n'
        f'   <xmp:CreatorTool>{xml_escape(producer)}</xmp:CreatorTool><pdf:Producer>{xml_escape(producer)}</pdf:Producer>'
        '<pdf:Trapped>False</pdf:Trapped>\n'
        + ('   <pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>\n' if pdfx else '')
        + f'   <xmpMM:DocumentID>uuid:{doc_id}</xmpMM:DocumentID><xmpMM:InstanceID>uuid:{instance_id}</xmpMM:InstanceID>\n'
        '  </rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>\n' + (" " * 64 + "\n") * 32 + '<?xpacket end="w"?>'
    )
    return xml.encode("utf-8")


def _up_filtered_bands(arr: np.ndarray, raw_sha: Any) -> Iterator[bytes]:
    """The image as PNG "Up"-filtered rows (filter byte 2 per row), PDF_BAND_ROWS rows at a time; raw_sha is fed the
    unfiltered pixels."""
    h, w = arr.shape[:2]
    prev = np.zeros((w, 3), dtype=np.uint8)
    for y0 in range(0, h, PDF_BAND_ROWS):
        band = arr[y0:min(h, y0 + PDF_BAND_ROWS)]
        raw_sha.update(band.tobytes())
        above = np.concatenate([prev[None, :, :], band[:-1]], axis=0)
        delta = (band - above).reshape(len(band), w * 3)          # uint8 wraps: the PNG "Up" filter
        yield np.concatenate([np.full((len(band), 1), 2, dtype=np.uint8), delta], axis=1).tobytes()
        prev = band[-1]


def _deflate_band(data: bytes, zdict: Optional[bytes], last: bool) -> bytes:
    comp = (zlib.compressobj(6, zlib.DEFLATED, -15, 8, zlib.Z_DEFAULT_STRATEGY, zdict) if zdict
            else zlib.compressobj(6, zlib.DEFLATED, -15))
    return comp.compress(data) + comp.flush(zlib.Z_FINISH if last else zlib.Z_SYNC_FLUSH)


def _flate_image_stream(arr: np.ndarray, raw_sha: Any, threads: int = 1) -> Iterator[bytes]:
    """The FlateDecode image stream, in pieces. threads=1: one zlib stream, byte-identical to earlier versions.
    threads > 1: the pigz layout -- each band is a raw deflate run primed with the previous band's last 32 KB and
    ended on a sync point, compressed on a thread pool and joined under one zlib header and Adler-32. Any zlib reader
    decodes it as one stream to the same bytes, at practically the same size, 3-4x faster on 4 cores."""
    if threads <= 1:
        comp = zlib.compressobj(6)
        for data in _up_filtered_bands(arr, raw_sha):
            yield comp.compress(data)
        yield comp.flush()
        return
    last = (arr.shape[0] - 1) // PDF_BAND_ROWS
    yield b"\x78\x9c"                                      # zlib header: deflate, 32 KB window, default level
    adler, zdict, pending = 1, None, deque()
    with ThreadPoolExecutor(max_workers=threads, thread_name_prefix="pdf-deflate") as pool:
        for i, data in enumerate(_up_filtered_bands(arr, raw_sha)):
            adler = zlib.adler32(data, adler)
            pending.append(pool.submit(_deflate_band, data, zdict, i == last))
            zdict = data[-32768:]
            while len(pending) > threads:                 # bounds memory to about threads + 1 bands in flight
                yield pending.popleft().result()
        while pending:
            yield pending.popleft().result()
    yield adler.to_bytes(4, "big")


def write_pdf(dst: Path, im: Image.Image, ppi: float, bleed_px: int, icc: Optional[bytes], icc_name: str,
              title: str, subject: Optional[str] = None, created: Optional[datetime] = None,
              threads: int = 1) -> dict:
    """Single-page PDF 1.6 for the print shop: the image placed at its physical size (MediaBox = BleedBox = the
    file incl. bleed, TrimBox = the trim; no ArtBox, PDF/X allows only one of the two), 8-bit RGB, Flate-compressed
    with the PNG "Up" predictor (lossless), in an ICCBased colour space. When the profile is a printer-class
    (output device) profile, as the shop's profile given with --icc-target is, it is also declared as the PDF/X
    output intent and the XMP declares PDF/X-4; a display-class profile such as sRGB gives a plain, fully
    colour-managed PDF without a PDF/X claim. /Trapped /False. Written band by band. Returns the facts for the spec
    sheet incl. the SHA-256 of the raw pixels, which verify_pdf() recomputes from the file. threads > 1 compresses
    the image bands in parallel (see _flate_image_stream): same pixels, practically the same size."""
    if im.mode in ("RGBA", "LA", "PA"):
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im.convert("RGBA"), mask=im.convert("RGBA").getchannel("A"))
        im = bg
    elif im.mode != "RGB":
        im = im.convert("RGB")
    hdr = icc_header(icc)
    if icc and hdr.get("space") != "RGB":
        raise ValidationError(f"the PDF delivery needs an RGB ICC profile, got {hdr.get('space') or 'invalid profile bytes'}")
    pdfx = bool(icc) and hdr.get("class") == "prtr"
    title, subject = _clean_text(title), (_clean_text(subject)[:32000] if subject else None)
    w, h = im.size
    pt_w, pt_h, b_pt = w / ppi * 72.0, h / ppi * 72.0, bleed_px / ppi * 72.0
    created = created or datetime.now(timezone.utc)
    producer = f"upscale_pipeline {__version__}"
    arr = np.asarray(im)
    raw_sha = hashlib.sha256()
    offsets: dict[int, int] = {}
    # written under a temp name and renamed into place only once complete, so a viewer, thumbnailer, backup tool
    # or antivirus scan that opens the destination mid-write (a real risk for a 100+ MB file that takes seconds
    # to write) can never see a partial PDF -- os.replace on the same volume is a single atomic filesystem rename
    tmp = dst.with_name(dst.name + f".{os.getpid()}.part")
    try:
      with open(tmp, "wb") as fh:
        def obj(num: int, body: bytes) -> None:
            offsets[num] = fh.tell()
            fh.write(f"{num} 0 obj\n".encode("ascii") + body + b"\nendobj\n")

        def stream(num: int, entries: bytes, data: bytes) -> None:
            obj(num, b"<< " + entries + f" /Length {len(data)} >>\nstream\n".encode("ascii") + data + b"\nendstream")

        fh.write(b"%PDF-1.6\n%\xe2\xe3\xcf\xd3\n")
        obj(1, b"<< /Type /Catalog /Pages 2 0 R /Metadata 8 0 R" + (b" /OutputIntents [7 0 R]" if pdfx else b"") + b" >>")
        obj(2, b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
        box = f"[0 0 {_pdf_num(pt_w)} {_pdf_num(pt_h)}]".encode("ascii")
        trim = f"[{_pdf_num(b_pt)} {_pdf_num(b_pt)} {_pdf_num(pt_w - b_pt)} {_pdf_num(pt_h - b_pt)}]".encode("ascii")
        obj(3, b"<< /Type /Page /Parent 2 0 R /MediaBox " + box + b" /BleedBox " + box + b" /TrimBox " + trim
               + b" /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>")
        # the image is streamed so the compressed data is never held in memory; its length is object 9
        offsets[4] = fh.tell()
        fh.write((f"4 0 obj\n<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace "
                  + ("[/ICCBased 6 0 R]" if icc else "/DeviceRGB")
                  + " /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3"
                  f" /BitsPerComponent 8 /Columns {w} >> /Length 9 0 R >>\nstream\n").encode("ascii"))
        start = fh.tell()
        for chunk in _flate_image_stream(arr, raw_sha, threads):
            fh.write(chunk)
        length = fh.tell() - start
        fh.write(b"\nendstream\nendobj\n")
        stream(5, b"", f"q {_pdf_num(pt_w)} 0 0 {_pdf_num(pt_h)} 0 0 cm /Im0 Do Q".encode("ascii"))
        if icc:
            stream(6, b"/N 3 /Alternate /DeviceRGB /Filter /FlateDecode", zlib.compress(icc, 9))
        else:
            obj(6, b"null")
        if pdfx:
            obj(7, b"<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier " + _pdf_text(icc_name[:64])
                   + b" /Info " + _pdf_text(icc_name) + b" /DestOutputProfile 6 0 R >>")
        else:
            obj(7, b"null")
        pixels = raw_sha.hexdigest()
        doc_id, inst_id = _uuid_like(pixels), _uuid_like(pixels + created.isoformat())
        stream(8, b"/Type /Metadata /Subtype /XML", _xmp_packet(title, producer, created, doc_id, inst_id, pdfx, subject))
        obj(9, str(length).encode("ascii"))
        obj(10, b"<< /Title " + _pdf_text(title) + b" /Producer " + _pdf_text(producer) + b" /Creator " + _pdf_text(producer)
                + b" /CreationDate " + _pdf_date(created) + b" /ModDate " + _pdf_date(created) + b" /Trapped /False"
                + (b" /Subject " + _pdf_text(subject) if subject else b"") + b" >>")
        xref = fh.tell()
        n = max(offsets) + 1
        fh.write(f"xref\n0 {n}\n".encode("ascii") + b"0000000000 65535 f \n")
        for i in range(1, n):
            fh.write(f"{offsets[i]:010d} 00000 n \n".encode("ascii"))
        fid = doc_id.replace("-", "")                     # both strings equal: a freshly written file
        fh.write(f"trailer\n<< /Size {n} /Root 1 0 R /Info 10 0 R /ID [<{fid}> <{fid}>] >>\n"
                 f"startxref\n{xref}\n%%EOF\n".encode("ascii"))
      tmp.replace(dst)
    except BaseException:
      tmp.unlink(missing_ok=True)
      raise
    if not icc:
        colour = "DeviceRGB; no ICC profile available, no output intent"
    elif pdfx:
        colour = f"ICCBased {icc_name} (printer-class profile); PDF/X-4 output intent"
    else:
        colour = (f"ICCBased {icc_name}; no PDF/X output intent ({icc_name.split(' (')[0]} is a display-class profile; "
                  "the shop's printer profile via --icc-target gives a PDF/X-4 file)")
    return {
        "pdf_version": "1.6", "pages": 1, "pdfx": pdfx,
        "page_pt": f"{pt_w:.2f} x {pt_h:.2f}", "page_cm": f"{w / ppi * 2.54:.2f} x {h / ppi * 2.54:.2f}",
        "trim_cm": f"{(w - 2 * bleed_px) / ppi * 2.54:.2f} x {(h - 2 * bleed_px) / ppi * 2.54:.2f}",
        "image": "8-bit RGB, Flate + PNG Up predictor (lossless)", "colour": colour,
        "pixels_sha256": pixels, "bytes": dst.stat().st_size,
    }


def read_pdf_delivery(path: Path) -> dict:
    """Facts about a PDF written by write_pdf(), read back from the file: header, page boxes, image size, colour
    space, output intent, PDF/X marker, xref sanity and the SHA-256 of the decoded pixels (Flate + Up predictor,
    streamed). A minimal parser for this pipeline's own files, not a general PDF reader."""
    with open(path, "rb") as fh, mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        def box(name: bytes) -> Optional[tuple[float, ...]]:
            m = re.search(rb"/" + name + rb"\s*\[([^\]]*)\]", mm)
            return tuple(float(x) for x in m.group(1).split()) if m else None

        i = mm.find(b"/Subtype /Image")
        if i < 0:
            raise VerificationError("no image object in the PDF")
        head_end = mm.find(b"stream\n", i)
        if head_end < 0:
            raise VerificationError("image object has no stream")
        head = bytes(mm[i:head_end])

        def num(key: bytes) -> int:
            m = re.search(rb"/" + key + rb"\s+(\d+)", head)
            if not m:
                raise VerificationError(f"image object lacks /{key.decode()}")
            return int(m.group(1))

        w, h, cols = num(b"Width"), num(b"Height"), num(b"Columns")
        if cols != w:
            raise VerificationError("predictor columns do not match the image width")
        m = re.search(rb"/Length\s+(\d+)\s+0\s+R", head)
        if not m:
            raise VerificationError("image stream length is not an indirect reference")
        lm = re.search(rb"(?<![0-9])" + m.group(1) + rb" 0 obj\s*(\d+)\s*endobj", mm)
        if not lm:
            raise VerificationError("image stream length object not found")
        length = int(lm.group(1))
        pos, end = head_end + len(b"stream\n"), head_end + len(b"stream\n") + length
        if end > len(mm):
            raise VerificationError("image stream runs past the end of the file")
        d = zlib.decompressobj()
        sha = hashlib.sha256()
        rowlen = w * 3 + 1
        prev = np.zeros(w * 3, dtype=np.uint8)
        buf, rows_done = b"", 0

        def take() -> None:
            nonlocal buf, rows_done, prev
            n = len(buf) // rowlen
            if not n:
                return
            block = np.frombuffer(buf, dtype=np.uint8, count=n * rowlen).reshape(n, rowlen)
            if not np.all(block[:, 0] == 2):
                raise VerificationError("unexpected PNG filter type in the image stream")
            rec = np.empty((n, w * 3), dtype=np.uint8)
            np.add(prev, block[0, 1:], out=rec[0])
            for r in range(1, n):  # inverse "Up" row by row (uint8 wraps): 2-4x faster than np.cumsum down axis 0
                np.add(rec[r - 1], block[r, 1:], out=rec[r])
            sha.update(rec)
            prev = rec[-1].copy()
            rows_done += n
            buf = buf[n * rowlen:]

        try:
            while pos < end and not d.eof:  # bytes after the end of the zlib stream are ignored, as they always were
                chunk = mm[pos:min(end, pos + (4 << 20))]
                if not chunk:
                    raise VerificationError("image stream runs past the end of the file")
                pos += len(chunk)
                while chunk and not d.eof:  # at most 256 rows per step: a very compressible image never inflates at once
                    buf += d.decompress(chunk, 256 * rowlen)
                    chunk = d.unconsumed_tail
                    take()
            buf += d.flush()
        except zlib.error as exc:
            raise VerificationError(f"image stream is corrupt: {exc}") from exc
        take()
        if rows_done != h or buf:
            raise VerificationError(f"image stream decodes to {rows_done} rows, expected {h}")
        sx = mm.rfind(b"startxref")
        xm = re.search(rb"startxref\s+(\d+)", mm[sx:sx + 64]) if sx >= 0 else None
        xref_ok = bool(xm) and mm[int(xm.group(1)):int(xm.group(1)) + 4] == b"xref"
        return {
            "header": bytes(mm[:8]).decode("latin-1"), "width": w, "height": h,
            "media": box(b"MediaBox"), "bleed": box(b"BleedBox"), "trim": box(b"TrimBox"), "art": box(b"ArtBox"),
            "icc_based": b"/ICCBased" in head, "output_intent": mm.find(b"/S /GTS_PDFX") >= 0,
            "pdfx_marker": mm.find(b"GTS_PDFXVersion>PDF/X-4<") >= 0,
            "pages": len(re.findall(rb"/Type\s*/Page(?!s)", mm)), "xref_ok": xref_ok,
            "pixels_sha256": sha.hexdigest(),
        }


def verify_pdf(final: Path, delivery: Optional[dict]) -> ImageMeta:
    """Structural and pixel verification of a PDF delivery against what finalize() intended to write."""
    f = read_pdf_delivery(final)
    if not f["header"].startswith("%PDF-1.6"):
        raise VerificationError(f"unexpected PDF header {f['header']!r}")
    if not f["xref_ok"]:
        raise VerificationError("startxref does not point at the xref table")
    if f["pages"] != 1:
        raise VerificationError(f"{f['pages']} pages in the PDF, expected 1")
    if f["art"] is not None:
        raise VerificationError("the page carries an ArtBox next to the TrimBox, which PDF/X forbids")
    if f["output_intent"] != f["pdfx_marker"]:
        raise VerificationError("PDF/X-4 marker and PDF/X output intent do not agree")
    if delivery:
        fw, fh_ = map(int, delivery["file_px"].split("x"))
        if (f["width"], f["height"]) != (fw, fh_):
            raise VerificationError(f"PDF image {f['width']}x{f['height']} != {delivery['file_px']}")
        ppi = float(delivery["ppi"])
        exp_w, exp_h, b_pt = fw / ppi * 72.0, fh_ / ppi * 72.0, delivery["bleed_px"] / ppi * 72.0
        mb = f["media"]
        if not mb or abs(mb[2] - exp_w) > 0.05 or abs(mb[3] - exp_h) > 0.05 or mb[0] or mb[1]:
            raise VerificationError(f"MediaBox {mb} != {exp_w:.2f} x {exp_h:.2f} pt")
        tb = f["trim"]
        if not tb or any(abs(a - b) > 0.05 for a, b in zip(tb, (b_pt, b_pt, exp_w - b_pt, exp_h - b_pt))):
            raise VerificationError(f"TrimBox {tb} is not the trim inset by {b_pt:.2f} pt")
        if delivery["icc_embedded"] and not f["icc_based"]:
            raise VerificationError("ICC colour space missing from the PDF")
        facts = delivery.get("pdf") or {}
        if "pdfx" in facts and bool(facts["pdfx"]) != f["output_intent"]:
            raise VerificationError("PDF/X output intent does not match what was written")
        if facts.get("pixels_sha256") and f["pixels_sha256"] != facts["pixels_sha256"]:
            raise VerificationError("the pixels decoded from the PDF differ from the pixels that were written")
    return ImageMeta(str(final), f["width"], f["height"], "RGB", "PDF", sha256_file(final))


def finalize(current: Path, src: Path, src_meta: ImageMeta, cfg: PipelineConfig, provenance: dict,
             spec: Optional[PrintSpec] = None) -> tuple[Path, dict]:
    """Stage 4: exact trim -> sheet fit -> sharpen -> texture -> colour -> bleed -> encode with ICC + dpi -> name."""
    printshop = cfg.preset == "printshop"
    fmt = cfg.output_format.lower()
    fmt = "jpg" if fmt == "jpeg" else ("tif" if fmt in ("tif", "tiff") else fmt)
    with Image.open(current) as im:
        im.load()
        if cfg.exact and max(im.size) != cfg.target_long_edge:
            sc = cfg.target_long_edge / max(im.size)
            size = (cfg.target_long_edge, max(1, round(im.height * sc))) if im.width >= im.height \
                else (max(1, round(im.width * sc)), cfg.target_long_edge)
            im = im.resize(size, Image.Resampling.LANCZOS)
        if spec and cfg.fit in ("crop", "pad"):
            im = fit_to_sheet(im, spec, cfg.fit)
        trim_w, trim_h = im.size
        ppi = delivered_ppi(trim_w, trim_h, spec) if spec else 300.0
        if cfg.sharpen:
            im = im.filter(ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=2))
        if fmt in ("jpg", "tif", "pdf") and im.mode == "RGBA":
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.getchannel("A"))
            im = bg
        im = apply_texture(im, cfg)
        im = apply_print_fix(im, cfg)
        sheet_cm = (spec.width_in * 2.54, spec.height_in * 2.54) if spec and spec.width_in and spec.height_in else None
        pq = check_print_quality(im, cfg.print_fix_substrate, ppi, sheet_cm) if (printshop or cfg.print_fix) else None
        if pq is not None:
            LOG.info("[print-quality] %s: %s%s", src.name, pq.grade.upper(),
                     (" -- " + "; ".join(pq.flags)) if pq.flags else " (ink, black floor and banding within limits)")
            if pq.grade == "critical" and cfg.print_quality_policy == "abort":
                raise PrintQualityRefused("print quality policy=abort: " + "; ".join(pq.flags), pq)
        im, icc, icc_name = apply_colour(im, src_meta, cfg)
        bleed_px = round(cfg.bleed_mm / 25.4 * ppi) if cfg.bleed_mm > 0 else 0
        im = add_bleed(im, bleed_px)
        w, h = im.size
        model_tag = provenance.get("models_used", ["local"])[-1].split("/")[-1]
        cfg.out_dir.mkdir(parents=True, exist_ok=True)
        if printshop:
            # original name + the size it actually prints at (trim, width x height) + PPI; details are in _SPEC.txt
            w_cm, h_cm = round(trim_w / ppi * 2.54), round(trim_h / ppi * 2.54)
            dst = _print_path(cfg.out_dir, f"{_display_stem(src)}_{w_cm}x{h_cm}cm_{round(ppi)}ppi", fmt, src_meta.sha256)
        else:
            dst = cfg.out_dir / f"{_stem(src)}_{cfg.target_long_edge}px_{w}x{h}_{model_tag}_{src_meta.sha256[:8]}.{fmt}"
        dpi_tag = (ppi, ppi)
        pdf_facts: Optional[dict] = None
        save_kw: dict = {"dpi": dpi_tag}
        if icc:
            save_kw["icc_profile"] = icc
        meta_json = json.dumps(provenance, separators=(",", ":"))
        if fmt == "png":
            info = PngImagePlugin.PngInfo()
            info.add_text("Software", f"upscale_pipeline {__version__}")
            if not printshop:
                info.add_text("upscale_pipeline", meta_json)
            im.save(dst, "PNG", pnginfo=info, compress_level=3, **save_kw)
        elif fmt == "jpg":
            exif = Image.Exif(); exif[0x0131] = f"upscale_pipeline {__version__}"
            if not printshop: exif[0x010E] = meta_json[:60000]
            im.save(dst, "JPEG", quality=cfg.jpeg_quality, subsampling=0, optimize=True,
                    exif=exif.tobytes(), **save_kw)
        elif fmt == "webp":
            exif = Image.Exif(); exif[0x0131] = f"upscale_pipeline {__version__}"
            im.save(dst, "WEBP", quality=cfg.jpeg_quality, method=6, exif=exif.tobytes(), **save_kw)
        elif fmt == "tif":
            im.save(dst, "TIFF", compression="tiff_lzw",
                    software=f"upscale_pipeline {__version__}", **save_kw)
        elif fmt == "pdf":
            created = provenance.get("created_utc")
            pdf_facts = write_pdf(dst, im, ppi, bleed_px, icc, icc_name, title=dst.stem,
                                  subject=None if printshop else meta_json[:60000],
                                  created=datetime.fromisoformat(created) if created else None)
        else:
            raise ValidationError(f"unsupported output format {fmt!r}")
    tex_f = cfg.texture_file
    tex_mode = (tex_f if tex_f in ("grain", "grain-color") else cfg.texture_mode) if tex_f else None
    delivery = {
        "trim_px": f"{trim_w}x{trim_h}", "file_px": f"{w}x{h}", "ppi": ppi,
        "bleed_mm": cfg.bleed_mm, "bleed_px": bleed_px,
        "color_profile": icc_name, "icc_embedded": bool(icc),
        "format": fmt.upper(), "bit_depth": "8-bit " + ("RGBA" if im.mode == "RGBA" else "RGB"),
        "fit": cfg.fit if spec else "none", "sharpen": cfg.sharpen,
        "texture": (tex_f if tex_f in ("grain", "grain-color") else Path(tex_f).name) if tex_f else None,
        "texture_mode": tex_mode, "texture_strength": cfg.texture_strength if tex_f else None,
        "print_size_cm": (f"{round(max(spec.width_in,spec.height_in)*2.54,1)} x "
                          f"{round(min(spec.width_in,spec.height_in)*2.54,1)}" if spec else None),
        "print_fix": cfg.print_fix_substrate if cfg.print_fix else None,
        "print_quality": asdict(pq) if pq else None,
        "pdf": pdf_facts,
    }
    return dst, delivery


def write_spec_sheet(final: Path, src: Path, src_meta: ImageMeta, out_meta: ImageMeta,
                     delivery: dict, pr: "PrintReport", provenance: dict) -> Path:
    """Human-readable delivery note for the print shop, next to the file."""
    lines = [
        "PRINT DELIVERY SPEC", "=" * 60,
        f"File:             {final.name}",
        f"Dimensions:       {delivery['trim_px']} px trim" + (
            f", {delivery['file_px']} px incl. bleed" if delivery["bleed_px"] else ""),
        f"Print size:       {delivery['print_size_cm'] + ' cm' if delivery['print_size_cm'] else 'not specified'}"
        f" at {delivery['ppi']} PPI" + (f"  -> {pr.grade.upper()}" if pr and pr.grade != "unspecified" else ""),
        (f"Bleed:            {delivery['bleed_mm']} mm per side ({delivery['bleed_px']} px)"
         if delivery["bleed_px"] else "Bleed:            none"),
        f"Colour:           {delivery['color_profile']} -- ICC {'embedded' if delivery['icc_embedded'] else 'NOT embedded'}, {delivery['bit_depth']}",
        f"Format:           {delivery['format']}" + (", LZW, single layer" if delivery["format"] == "TIF" else "")
        + ((f" {delivery['pdf']['pdf_version']}, single page, {delivery['pdf']['image']}; MediaBox = BleedBox = file incl. bleed, "
            f"TrimBox = trim; {delivery['pdf']['colour']}") if delivery.get("pdf") else ""),
        (f"Page:             {delivery['pdf']['page_cm']} cm incl. bleed ({delivery['pdf']['page_pt']} pt), trim "
         f"{delivery['pdf']['trim_cm']} cm; image placed at {delivery['ppi']} PPI, not resampled"
         if delivery.get("pdf") else f"Resolution tag:   {delivery['ppi']} dpi (XResolution/YResolution)"),
        f"Fit:              {delivery['fit']}" + ("  (aspect matched to sheet)" if delivery["fit"] in ("crop", "pad") else ""),
        (f"Texture:          {delivery['texture']} ({delivery['texture_mode']}, strength {delivery['texture_strength']})"
         if delivery.get("texture") else "Texture:          none"),
        f"SHA-256:          {out_meta.sha256}",
        (f"Pixels SHA-256:   {delivery['pdf']['pixels_sha256']} (decoded image data, verified after writing)"
         if delivery.get("pdf") else None),
        f"Source:           {src.name} ({src_meta.width}x{src_meta.height} px, sha256 {src_meta.sha256[:16]}...)",
        f"Pipeline:         upscale_pipeline {__version__}; models: {', '.join(provenance.get('models_used', []))}",
        f"Generated:        {provenance.get('created_utc')}",
        "",
        "Notes: RGB workflow -- convert to the press/output profile at the RIP. Do not resample.",
    ]
    lines = [line for line in lines if line is not None]
    if pr and pr.recommendation:
        lines.append(f"Grading: {pr.recommendation}")
    pq = delivery.get("print_quality")
    if pq:
        lines.append(f"Print quality: {pq['grade'].upper()} for {pq['substrate']} ({pq['ink_limit']}% ink limit); "
                     f"print-fix {'applied' if delivery.get('print_fix') else 'not applied'}. "
                     f"Peak ink {pq['tac_p999']}% ({pq['tac_over_limit_pct']}% of image over the limit), "
                     f"black floor {pq['clip_black_pct']}%, neutral RGB black {pq['neutral_black_pct']}%, "
                     f"banding {pq['band_stepped_pct']}% of the image in {pq['band_step_mm']} mm steps"
                     + (f" (score {pq['band_score']}/10)." if pq.get("band_score") is not None else "."))
        lines.extend(f"  ! {flag}" for flag in pq["flags"])
    sheet = final.with_name(final.stem + "_SPEC.txt")
    sheet.write_text("\n".join(lines) + "\n", encoding="ascii", errors="replace")
    return sheet


def verify_output(final: Path, src_meta: ImageMeta, cfg: PipelineConfig, spec: Optional[PrintSpec] = None,
                  delivery: Optional[dict] = None) -> ImageMeta:
    """Re-open the written file and assert: integrity, trim size vs target, aspect (vs the source, or vs the sheet
    under fit=crop/pad), delivered PPI vs the requested print PPI, ICC presence and the dpi tag. A PDF is parsed
    and its image decoded and hashed instead (verify_pdf)."""
    is_pdf = final.suffix.lower() == ".pdf"
    if is_pdf:
        meta = verify_pdf(final, delivery)
    else:
        with Image.open(final) as im:
            im.verify()
        meta = read_meta(final)
    trim_w, trim_h = (tuple(map(int, delivery["trim_px"].split("x"))) if delivery else (meta.width, meta.height))
    trim_long, trim_short = max(trim_w, trim_h), max(1, min(trim_w, trim_h))
    fitted = bool(spec and cfg.fit in ("crop", "pad"))
    # crop shortens the long edge to the sheet ratio and pad grows the canvas, so only an un-fitted trim (or a
    # pad) must reach the target and only an un-fitted trim must hit it exactly; the PPI check below covers crop
    if not (spec and cfg.fit == "crop") and trim_long < cfg.target_long_edge:
        raise VerificationError(f"trim long edge {trim_long} < {cfg.target_long_edge}")
    if cfg.exact and not fitted and trim_long != cfg.target_long_edge:
        raise VerificationError(f"trim long edge {trim_long} != exact {cfg.target_long_edge}")
    a_img = trim_long / trim_short
    if fitted:
        a_sheet = max(spec.width_in, spec.height_in) / min(spec.width_in, spec.height_in)
        if abs(a_img - a_sheet) / a_sheet > 0.005:
            raise VerificationError(f"fit={cfg.fit} but aspect {a_img:.4f} != sheet {a_sheet:.4f}")
    else:
        a_src = src_meta.long_edge / max(1, min(src_meta.width, src_meta.height))
        if abs(a_img - a_src) / a_src > 0.005:
            raise VerificationError(f"aspect drift vs source: {a_src:.4f} -> {a_img:.4f}")
    if spec and cfg.print_ppi and delivered_ppi(trim_w, trim_h, spec) < cfg.print_ppi - 0.5:
        raise VerificationError(f"delivered {delivered_ppi(trim_w, trim_h, spec)} PPI < requested {cfg.print_ppi}")
    if delivery and not is_pdf:
        with Image.open(final) as im:
            if delivery["icc_embedded"] and not im.info.get("icc_profile"):
                raise VerificationError("ICC profile was not embedded in the delivered file")
            dpi = im.info.get("dpi")
            if dpi and abs(float(dpi[0]) - delivery["ppi"]) > 1.0:
                raise VerificationError(f"dpi tag {dpi} != {delivery['ppi']}")
    if final.stat().st_size < 4096:
        raise VerificationError("final file implausibly small")
    return meta


# =============================================================================
# Orchestrator
# =============================================================================
@dataclass
class ImageResult:
    source: str
    status: str                       # ok | skipped | failed
    final_path: Optional[str] = None
    input_dims: Optional[str] = None
    output_dims: Optional[str] = None
    api_passes: int = 0
    local_passes: int = 0
    models_used: list[str] = field(default_factory=list)
    est_cost_usd: float = 0.0
    seconds: float = 0.0
    quality_flags: list[str] = field(default_factory=list)
    passes: list[dict] = field(default_factory=list)
    error: Optional[str] = None
    print_report: Optional[dict] = None
    output_sha256: Optional[str] = None
    delivery: Optional[dict] = None
    spec_sheet: Optional[str] = None
    source_sha256: Optional[str] = None   # with delivery_key: the idempotency index for sheet-named outputs
    delivery_key: Optional[str] = None


def delivery_key(cfg: PipelineConfig) -> str:
    """Hash of the parameters that change the delivered file (not the model route). A re-run with the same source
    bytes and the same key is skipped; a different sheet / fit / format / texture is a new delivery."""
    parts = (cfg.target_long_edge, cfg.exact, cfg.preset, cfg.output_format, cfg.fit, cfg.bleed_mm, cfg.print_size,
             cfg.print_ppi, cfg.sharpen, cfg.icc_target, cfg.texture_file, cfg.texture_mode, cfg.texture_strength)
    if cfg.print_fix:                       # only when on, so deliveries made before 1.4 keep their key
        parts += ("print-fix", cfg.print_fix_substrate)
    return hashlib.sha256(json.dumps(parts, default=str).encode("utf-8")).hexdigest()[:12]


def previous_delivery(src: Path, src_meta: ImageMeta, cfg: PipelineConfig) -> Optional[Path]:
    """Final file of an earlier successful run of the same source bytes with the same delivery key, if its report is
    still next to it. Printshop names are sheet-derived (no source hash), so the report is their index."""
    report = cfg.out_dir / f"{_stem(src)}_report.json"
    if not report.is_file():
        return None
    try:
        prev = json.loads(report.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if prev.get("status") not in ("ok", "skipped") or prev.get("source_sha256") != src_meta.sha256 \
            or prev.get("delivery_key") != delivery_key(cfg) or not prev.get("final_path"):
        return None
    final = Path(prev["final_path"])
    return final if final.is_file() else None


def process_image(src: Path, cfg: PipelineConfig, runner: ReplicateRunner) -> ImageResult:
    t0 = time.monotonic()
    res = ImageResult(source=str(src), status="failed")
    try:
        src_meta, current = validate_input(src, cfg)
        res.input_dims = f"{src_meta.width}x{src_meta.height}"
        _print_spec = PrintSpec.from_string(cfg.print_size) if cfg.print_size else None
        if _print_spec and cfg.print_ppi:
            need = required_long_edge(src_meta, _print_spec, cfg.print_ppi, cfg.fit)
            if need != cfg.target_long_edge:
                LOG.info("[target] %s: sheet %s at %g PPI (fit=%s) -> %d px", src.name,
                         cfg.print_size, cfg.print_ppi, cfg.fit, need)
                cfg = replace(cfg, target_long_edge=need)
        stem_dir = current.parent

        # idempotency: skip if a final for this exact source hash (same delivery parameters) already exists.
        # Default-preset names carry the hash; printshop names are sheet-derived, so their report is checked too.
        res.source_sha256, res.delivery_key = src_meta.sha256, delivery_key(cfg)
        existing = (list(cfg.out_dir.glob(f"{_stem(src)}_{cfg.target_long_edge}px_*_{src_meta.sha256[:8]}.*"))
                    if cfg.out_dir.exists() else [])
        prior = previous_delivery(src, src_meta, cfg)
        if prior and prior not in existing:
            existing.insert(0, prior)
        if existing and not cfg.force:
            res.status, res.final_path = "skipped", str(existing[0])
            LOG.info("[skip] %s already delivered: %s", src.name, existing[0].name)
            return res

        # Stage 2 -- optional face restoration at native resolution
        if cfg.face_restore:
            current, info = run_face_restore(runner, current, cfg, label=f"{src.name} face")
            res.models_used.append(info["model"])
            res.est_cost_usd += MODELS["codeformer"].est_cost_usd
            res.passes.append({"stage": "face_restore", **info})

        first = select_profile(cfg.model, src_meta, cfg)
        plan = plan_passes(src_meta.long_edge, cfg.target_long_edge, first.max_scale, cfg.max_passes, cfg.overshoot)
        LOG.info("[plan] %s: %dpx -> %dpx, projected factors %s (%d pass%s)", src.name, src_meta.long_edge,
                 cfg.target_long_edge, plan, len(plan), "" if len(plan) == 1 else "es")

        # Stage 3 -- dynamic progressive loop
        n_api, n_local, no_progress = 0, 0, 0
        while True:
            meta = read_meta(current)
            if meta.long_edge >= cfg.target_long_edge:
                if n_api + n_local == 0:
                    res.passes.append({"stage": "already_at_target", "in": f"{meta.width}x{meta.height}"})
                break
            if n_api >= cfg.max_passes:
                raise SafeguardTripped(f"max_passes={cfg.max_passes} reached at {meta.long_edge}px")
            if time.monotonic() - t0 > cfg.budget_seconds:
                raise SafeguardTripped(f"budget of {cfg.budget_seconds}s exceeded")

            remaining = cfg.target_long_edge / meta.long_edge
            profile_key = cfg.model
            if cfg.final_model and remaining * (1 + cfg.overshoot) <= MODELS[cfg.final_model].max_scale:
                profile_key = cfg.final_model          # hybrid: last pass on the texture model
            profile = select_profile(profile_key, meta, cfg)
            scale = choose_scale(profile, remaining, cfg.overshoot)
            pass_no = n_api + n_local + 1
            dst = stem_dir / f"pass{pass_no}_{profile.key}_x{scale:.2f}.png"
            label = f"{src.name} pass{pass_no}"

            is_api = not (scale < cfg.min_api_scale and not profile.allowed_scales)
            if not is_api:
                LOG.info("[%s] remaining x%.3f is below min_api_scale -> local Lanczos", label, remaining)
                local_resize(current, dst, remaining * (1 + cfg.overshoot))
                n_local += 1
                info = {"model": "local-lanczos", "scale_requested": round(remaining, 3)}
            else:
                LOG.info("[%s] %dx%d -> x%.3f via %s (need x%.3f)", label, meta.width, meta.height,
                         scale, profile.key, remaining)
                _, info = run_pass(runner, profile, current, dst, scale, cfg, label=label)
                n_api += 1
                res.est_cost_usd += profile.est_cost_usd * max(1, info.get("tiles", 1))
                if profile.owner_name not in res.models_used:
                    res.models_used.append(profile.owner_name)

            new_meta = read_meta(dst)
            LOG.info("[%s] result %dx%d (%.1f MP)", label, new_meta.width, new_meta.height, new_meta.megapixels)
            grew_enough = new_meta.long_edge >= meta.long_edge * (1.05 if is_api else 1.0 + 1e-9)
            if not grew_enough:                                          # model ignored the factor
                no_progress += 1
                if no_progress >= 2:
                    raise SafeguardTripped("no progress on two consecutive passes")
                LOG.warning("[%s] no meaningful growth (%d -> %d px); retrying", label, meta.long_edge, new_meta.long_edge)
                continue

            q = QualityTracker.compare(current, dst, cfg)
            LOG.info("[%s] quality: sharpness x%.2f, round-trip PSNR %.1f dB, colour drift %.1f%s",
                     label, q["sharpness_ratio"], q["round_trip_psnr_db"], q["color_drift"],
                     (" FLAGS: " + "; ".join(q["flags"])) if q["flags"] else "")
            res.passes.append({"stage": f"pass{pass_no}", "in": f"{meta.width}x{meta.height}",
                               "out": f"{new_meta.width}x{new_meta.height}", **info, "quality": q})
            res.quality_flags.extend(f"pass{pass_no}: {f}" for f in q["flags"])
            if q["flags"] and cfg.quality_policy == "abort":
                raise PipelineError("quality policy=abort: " + "; ".join(q["flags"]))
            current = dst

        # Stage 4 -- finalize + verify
        provenance = {
            "pipeline": f"upscale_pipeline/{__version__}",
            "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": src.name, "source_sha256": src_meta.sha256, "source_dims": res.input_dims,
            "target_long_edge": cfg.target_long_edge, "exact": cfg.exact,
            "models_used": res.models_used or ["local"],
            "texture": cfg.texture_file or None,
            "print_fix": cfg.print_fix_substrate if cfg.print_fix else None,
            "passes": [{k: v for k, v in p.items() if k != "quality"} for p in res.passes],
            "quality_flags": res.quality_flags,
        }
        final, delivery = finalize(current, src, src_meta, cfg, provenance, _print_spec)
        out_meta = verify_output(final, src_meta, cfg, _print_spec, delivery)
        trim_w, trim_h = map(int, delivery["trim_px"].split("x"))
        pr = check_print(ImageMeta(str(final), trim_w, trim_h, out_meta.mode, out_meta.format, out_meta.sha256), _print_spec)
        res.print_report = asdict(pr) if pr else None
        res.output_sha256, res.delivery = out_meta.sha256, delivery
        if cfg.preset == "printshop":
            res.spec_sheet = str(write_spec_sheet(final, src, src_meta, out_meta, delivery, pr, provenance))
        res.status, res.final_path = "ok", str(final)
        res.output_dims = f"{out_meta.width}x{out_meta.height}"
        res.api_passes, res.local_passes = n_api, n_local
        LOG.info("[done] %s -> %s (%s, %d API pass%s, ~$%.3f)", src.name, final.name, res.output_dims,
                 n_api, "" if n_api == 1 else "es", res.est_cost_usd)
    except PipelineError as exc:
        res.error = f"{type(exc).__name__}: {exc}"
        if isinstance(exc, PrintQualityRefused):     # the refusal reason travels with the report and the status file
            res.delivery = {"print_fix": cfg.print_fix_substrate if cfg.print_fix else None,
                            "print_quality": asdict(exc.report)}
        LOG.error("[fail] %s: %s", src.name, res.error)
    except Exception as exc:  # noqa: BLE001 - never let one image kill the batch
        res.error = f"Unexpected {type(exc).__name__}: {exc}"
        LOG.exception("[fail] %s: unexpected error", src.name)
    finally:
        res.seconds = round(time.monotonic() - t0, 1)
    return res


def write_report(res: ImageResult, cfg: PipelineConfig) -> None:
    cfg.out_dir.mkdir(parents=True, exist_ok=True)
    stem = _stem(Path(res.source))
    report = cfg.out_dir / f"{stem}_report.json"
    if not (res.status == "skipped" and report.exists()):   # a skip keeps the delivery's full report (the skip index)
        report.write_text(json.dumps(asdict(res), indent=2), encoding="utf-8")
    with (cfg.out_dir / "manifest.jsonl").open("a", encoding="utf-8") as fh:
        row = {k: v for k, v in asdict(res).items() if k != "passes"}
        fh.write(json.dumps(row) + "\n")


def write_batch_status(results: list[ImageResult], total: int, cfg: PipelineConfig, started_utc: str) -> Path:
    """Live progress file for the Print Quality Auditor's batch monitor: rewritten (atomically) after every
    image, so a viewer watching it follows the run. Per-image details stay in the reports; this is the summary."""
    cfg.out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for r in results:
        d = r.delivery or {}
        rows.append({"name": Path(r.source).name, "status": r.status, "seconds": r.seconds,
                     "api_passes": r.api_passes, "est_cost_usd": round(r.est_cost_usd, 4),
                     "final": Path(r.final_path).name if r.final_path else None,
                     "print_size_cm": d.get("print_size_cm"), "ppi": d.get("ppi"),
                     "grade": (r.print_report or {}).get("grade"), "print_quality": d.get("print_quality"),
                     "quality_flags": r.quality_flags, "error": r.error})
    pq_grades = [(row["print_quality"] or {}).get("grade") for row in rows]
    status = {
        "pipeline": f"upscale_pipeline/{__version__}", "started_utc": started_utc,
        "updated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "out_dir": str(cfg.out_dir.resolve()), "preset": cfg.preset, "print_size": cfg.print_size,
        "print_ppi": cfg.print_ppi, "print_fix": cfg.print_fix_substrate if cfg.print_fix else None,
        "print_quality_policy": cfg.print_quality_policy,
        "total": total, "done": len(results),
        "ok": sum(r.status == "ok" for r in results), "skipped": sum(r.status == "skipped" for r in results),
        "failed": sum(r.status == "failed" for r in results),
        "critical": pq_grades.count("critical"), "caveats": pq_grades.count("caveats"),
        "est_cost_usd": round(sum(r.est_cost_usd for r in results), 4),
        "images": rows,
    }
    path = cfg.out_dir / "batch_status.json"
    tmp = path.with_name("batch_status.json.tmp")
    # A reader that holds the file open without delete sharing (a Python script, an editor) makes the atomic
    # replace fail on Windows with PermissionError; the progress file must never take the batch down with it.
    try:
        tmp.write_text(json.dumps(status, indent=1), encoding="utf-8")
        for attempt in range(5):
            try:
                tmp.replace(path)
                break
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.2 * (attempt + 1))
    except OSError as exc:
        LOG.warning("[status] could not update %s (%s); the batch continues", path.name, exc)
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
    return path


# =============================================================================
# Environment (.env) + delivery webhook
# =============================================================================
def load_dotenv(path: Path) -> int:
    """Minimal KEY=VALUE loader (no dependency). Never overrides variables already in the environment."""
    if not path.is_file():
        return 0
    parsed: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8-sig").splitlines():      # -sig: tolerate a Notepad BOM
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key, val = key.strip(), val.strip()
        if val[:1] in ('"', "'") and val.count(val[0]) >= 2:            # quoted value: keep inner text verbatim
            val = val[1:val.index(val[0], 1)]
        else:                                                           # bare value: strip trailing "# comment"
            val = val.split(" #", 1)[0].rstrip()
        if key:
            if key in parsed:
                LOG.warning(".env: %s defined twice, using the last value (%r)", key, val)
            parsed[key] = val                                           # LAST occurrence in the file wins
    loaded = 0
    for key, val in parsed.items():
        if key not in os.environ:                                       # existing environment wins over .env
            os.environ[key] = val
            loaded += 1
    return loaded


def env(name: str, default: Any = None, cast: Callable[[str], Any] = str) -> Any:
    val = os.environ.get(name, "")
    if val.strip() == "":
        return default
    try:
        return cast(val)
    except (TypeError, ValueError):
        LOG.warning("ignoring invalid %s=%r", name, val)
        return default


def notify_webhook(row: dict, url: str, secret: str = "") -> None:
    """Best-effort POST of the manifest row (status, final_path, dims, cost, flags). Failures never stop the batch."""
    body = json.dumps(row, separators=(",", ":")).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": f"upscale_pipeline/{__version__}"}
    if secret:
        import hmac
        headers["X-Upscale-Signature"] = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    for attempt in (1, 2):
        try:
            r = httpx.post(url, content=body, headers=headers, timeout=10.0)
            r.raise_for_status()
            LOG.info("[webhook] delivered %s -> HTTP %s", Path(row["source"]).name, r.status_code)
            return
        except httpx.HTTPError as exc:
            LOG.warning("[webhook] attempt %d failed: %s", attempt, exc)
            time.sleep(2.0)


# =============================================================================
# CLI
# =============================================================================
def collect_inputs(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for p in paths:
        pp = Path(p)
        if pp.is_dir():
            files += sorted(f for f in pp.iterdir() if f.suffix.lower() in SUPPORTED_INPUT_EXT and f.is_file())
        else:
            files.append(pp)
    return files


def parse_extra(items: list[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for item in items or []:
        if "=" not in item:
            raise SystemExit(f"--extra expects key=value, got {item!r}")
        k, v = item.split("=", 1)
        try:
            out[k] = json.loads(v)
        except json.JSONDecodeError:
            out[k] = v
    return out


UPSCALER_KEYS = [k for k, p in MODELS.items() if p.kind == "upscaler"]


def build_parser() -> argparse.ArgumentParser:
    """CLI flags override .env (UPSCALE_*), which override the built-in defaults."""
    ap = argparse.ArgumentParser(description="Progressive 5K upscaling pipeline on Replicate")
    ap.add_argument("inputs", nargs="*", default=[], help="image files and/or directories (default: UPSCALE_INPUT_DIR)")
    ap.add_argument("--out", default=env("UPSCALE_OUTPUT_DIR", "output"), help="final deliverables directory")
    ap.add_argument("--work", default=env("UPSCALE_WORK_DIR", "work"), help="intermediate pass files (kept for audit)")
    ap.add_argument("--target", type=int, default=env("UPSCALE_TARGET_PX", 9000, int), help="target long edge in px (default 9000 = 150 cm @ 150 PPI)")
    ap.add_argument("--model", default=env("UPSCALE_MODEL", "auto"), choices=["auto", *UPSCALER_KEYS])
    ap.add_argument("--final-model", default=env("UPSCALE_FINAL_MODEL", None), choices=UPSCALER_KEYS,
                    help="use a different model for the last pass (e.g. clarity for texture)")
    ap.add_argument("--max-passes", type=int, default=env("UPSCALE_MAX_PASSES", 4, int), help="API passes per image before aborting (default 4)")
    ap.add_argument("--min-api-scale", type=float, default=env("UPSCALE_MIN_API_SCALE", 1.15, float),
                    help="a remaining enlargement below this factor is done locally (Lanczos, free) instead of a paid call "
                         "(default 1.15; 2 finishes existing 5120 px results to 150 cm @ 150 PPI without API calls)")
    ap.add_argument("--face-restore", action="store_true", default=env("UPSCALE_FACE_RESTORE", "0") == "1",
                    help="CodeFormer pre-pass at native resolution")
    ap.add_argument("--no-exact", dest="exact", action="store_false", default=env("UPSCALE_EXACT", "1") != "0",
                    help="allow > target instead of trimming to exact")
    ap.add_argument("--format", default=None, choices=["png", "jpg", "webp", "tiff", "pdf"],
                    help="output format: png, jpg, webp, tiff or pdf (default: UPSCALE_FORMAT, else tiff under "
                         "--preset printshop and png otherwise). pdf = one page at print size, lossless, ICC embedded, PDF/X-4 "
                         "output intent when --icc-target is the shop's printer profile")
    ap.add_argument("--jpeg-quality", type=int, default=env("UPSCALE_JPEG_QUALITY", 95, int))
    ap.add_argument("--quality-policy", default=env("UPSCALE_QUALITY_POLICY", "warn"), choices=["warn", "abort"])
    ap.add_argument("--budget-seconds", type=int, default=env("UPSCALE_BUDGET_SECONDS", 1800, int))
    ap.add_argument("--tiling", default=env("UPSCALE_TILING", "auto"), choices=["auto", "always", "off"],
                    help="split inputs above the model's MP limit into overlapping tiles (auto)")
    ap.add_argument("--tile-size", type=int, default=env("UPSCALE_TILE_SIZE", 1024, int), help="tile edge in source px")
    ap.add_argument("--tile-overlap", type=int, default=env("UPSCALE_TILE_OVERLAP", 48, int))
    ap.add_argument("--tile-margin", type=int, default=env("UPSCALE_TILE_MARGIN", 8, int),
                    help="source px trimmed from internal tile edges before blending")
    ap.add_argument("--tile-workers", type=int, default=env("UPSCALE_TILE_WORKERS", 4, int), help="concurrent tile calls")
    ap.add_argument("--plan", action="store_true", help="print the pass/tile/cost/print plan per image and exit (no API)")
    ap.add_argument("--print-size", default=env("UPSCALE_PRINT_SIZE", None),
                    help="target print size for PPI grading, e.g. '24x16in' or '60x40cm'")
    ap.add_argument("--preset", default=env("UPSCALE_PRESET", "default"), choices=["default", "printshop"],
                    help="printshop: TIFF-LZW, ICC + dpi tags, sheet-derived naming, spec sheet, no JSON in file")
    ap.add_argument("--print-ppi", type=float, default=env("UPSCALE_PRINT_PPI", None, float),
                    help="with --print-size: derive the pixel target from the sheet at this PPI (e.g. 150)")
    ap.add_argument("--fit", default=env("UPSCALE_FIT", "none"), choices=["none", "crop", "pad"],
                    help="match the sheet aspect: centred crop or white pad")
    ap.add_argument("--bleed-mm", type=float, default=env("UPSCALE_BLEED_MM", 0.0, float), help="mirrored bleed per side")
    ap.add_argument("--sharpen", action="store_true", default=env("UPSCALE_SHARPEN", "0") == "1",
                    help="mild unsharp mask after the final resize")
    ap.add_argument("--icc-target", default=env("UPSCALE_ICC_TARGET", None),
                    help="path to an .icc profile to convert into (default: keep the source profile / embed sRGB)")
    ap.add_argument("--texture", default=env("UPSCALE_TEXTURE", None), dest="texture_file",
                    help="blend a PNG/TIFF texture tile into the final image, or 'grain' / 'grain-color' for film grain")
    ap.add_argument("--texture-strength", type=float, default=env("UPSCALE_TEXTURE_STRENGTH", 0.18, float),
                    help="0..1 blend opacity / grain amplitude (default 0.18)")
    ap.add_argument("--texture-mode", default=env("UPSCALE_TEXTURE_MODE", "multiply"), choices=list(TEXTURE_MODES),
                    help="blend mode for a texture file; grain / grain-color ignore the file")
    ap.add_argument("--print-fix", action="store_true", default=env("UPSCALE_PRINT_FIX", "0") == "1",
                    help="fix the ink-limit, black-floor and banding risks the print-quality check flags (Stage 4)")
    ap.add_argument("--print-fix-substrate", default=env("UPSCALE_PRINT_FIX_SUBSTRATE", "canvas"),
                    choices=list(PRINT_QUALITY_SUBSTRATES),
                    help="substrate whose ink limit the fix and the re-check use (default canvas = 280%%)")
    ap.add_argument("--print-quality-policy", default=env("UPSCALE_PRINT_QUALITY_POLICY", "warn"),
                    choices=["warn", "abort"],
                    help="abort = do not deliver a file whose re-check is still critical after the fix (default warn)")
    ap.add_argument("--extra", action="append", default=[], help="model param passthrough, e.g. --extra creativity=0.25")
    ap.add_argument("--dry-run", action="store_true", help="simulate the API locally (loop/plumbing test)")
    ap.add_argument("--force", action="store_true", help="re-process even if a final already exists")
    ap.add_argument("-v", "--verbose", action="store_true")
    return ap


def print_plan(files: list[Path], cfg: PipelineConfig) -> int:
    """Dry estimate: passes, tiles, API calls, cost, output size and print grade per image. No API calls."""
    spec = PrintSpec.from_string(cfg.print_size) if cfg.print_size else None
    rows, total_cost, total_calls = [], 0.0, 0
    for f in files:
        try:
            with Image.open(f) as im:
                im = ImageOps.exif_transpose(im)
                w, h = im.size
        except (UnidentifiedImageError, OSError) as exc:
            rows.append((f.name, "unreadable", "-", "-", "-", 0, 0.0, f"{exc}"[:40]))
            continue
        meta = ImageMeta(str(f), w, h, "RGB", None, "")
        profile = select_profile(cfg.model, meta, cfg)
        target = required_long_edge(meta, spec, cfg.print_ppi, cfg.fit) if (spec and cfg.print_ppi) else cfg.target_long_edge
        plan = plan_passes(meta.long_edge, target, profile.max_scale, cfg.max_passes, cfg.overshoot)
        cur_w, cur_h, calls, cost, notes = w, h, 0, 0.0, []
        for i, factor in enumerate(plan, 1):
            mp = cur_w * cur_h / 1e6
            if factor < cfg.min_api_scale and not profile.allowed_scales:
                notes.append(f"p{i}:x{factor:.2f} local")
            else:
                tiled = cfg.tiling != "off" and profile.external_tiling_ok and (cfg.tiling == "always" or mp > profile.max_input_mp)
                n = len(plan_tiles(cur_w, cur_h, cfg.tile_size, cfg.tile_overlap)) if tiled else 1
                calls += n
                cost += profile.est_cost_usd * n
                notes.append(f"p{i}:x{factor:.2f} {profile.key}{f' {n} tiles' if tiled else ''}")
            cur_w, cur_h = round(cur_w * factor), round(cur_h * factor)
        reach = max(cur_w, cur_h) >= target
        if cfg.exact and reach:
            sc = target / max(cur_w, cur_h)
            cur_w, cur_h = round(cur_w * sc), round(cur_h * sc)
        out_meta = ImageMeta(str(f), cur_w, cur_h, "RGB", None, "")
        grade = PrintReport(out_meta.long_edge, min(cur_w, cur_h), spec).grade if spec else "-"
        total_cost += cost
        total_calls += calls
        rows.append((f.name, f"{w}x{h}", f"{cur_w}x{cur_h}", len(plan), grade, calls, cost,
                     ("; ".join(notes) if reach else "UNREACHABLE within max_passes")))
    print(f"\n{'source':30s} {'in':11s} {'out':11s} {'passes':>6s} {'print':>11s} {'calls':>5s} {'cost':>7s}  plan")
    for r in rows:
        print(f"{r[0][:30]:30s} {r[1]:11s} {r[2]:11s} {r[3]!s:>6s} {r[4]:>11s} {r[5]:>5d} {r[6]:7.3f}  {r[7]}")
    print(f"\n{len(rows)} image(s) | ~{total_calls} API calls | est ${total_cost:.3f} | target "
          f"{('sheet @ %g PPI' % cfg.print_ppi) if (spec and cfg.print_ppi) else str(cfg.target_long_edge) + 'px'} | "
          f"model {cfg.model} | tiling {cfg.tiling} ({cfg.tile_size}px) | print {cfg.print_size or '-'}"
          f"{(' | texture ' + cfg.texture_file) if cfg.texture_file else ''}")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    loaded = load_dotenv(Path(__file__).resolve().parent / ".env")      # before the parser reads its defaults
    ap = build_parser()
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, stream=sys.stdout,  # stdout: PowerShell
                        format="%(asctime)s %(levelname)-7s %(message)s", datefmt="%H:%M:%S")     # treats stderr as errors
    for noisy in ("httpx", "httpcore", "replicate"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    if loaded:
        LOG.info("loaded %d variable(s) from .env", loaded)
    # argparse does not validate env-supplied defaults against `choices`
    fmt_check = args.format or env("UPSCALE_FORMAT") or "png"
    if args.model not in ("auto", *UPSCALER_KEYS) or (args.final_model and args.final_model not in UPSCALER_KEYS) \
            or fmt_check not in ("png", "jpg", "webp", "tiff", "pdf") or args.quality_policy not in ("warn", "abort") \
            or args.preset not in ("default", "printshop") or args.fit not in ("none", "crop", "pad") \
            or args.tiling not in ("auto", "always", "off") or args.texture_mode not in TEXTURE_MODES \
            or args.print_fix_substrate not in PRINT_QUALITY_SUBSTRATES or args.print_quality_policy not in ("warn", "abort"):
        LOG.error("invalid UPSCALE_MODEL / UPSCALE_FINAL_MODEL / UPSCALE_FORMAT / UPSCALE_QUALITY_POLICY / "
                  "UPSCALE_PRESET / UPSCALE_FIT / UPSCALE_TILING / UPSCALE_TEXTURE_MODE / "
                  "UPSCALE_PRINT_FIX_SUBSTRATE / UPSCALE_PRINT_QUALITY_POLICY in .env")
        return 2
    if args.texture_mode in ("grain", "grain-color") and not args.texture_file:
        args.texture_file = args.texture_mode                # --texture-mode grain on its own means "add grain"
    if not args.inputs:
        default_in = env("UPSCALE_INPUT_DIR")
        if not default_in:
            ap.error("no inputs given and UPSCALE_INPUT_DIR is not set")
        args.inputs = [default_in]

    cfg = PipelineConfig(
        target_long_edge=args.target, max_passes=args.max_passes, model=args.model, final_model=args.final_model,
        min_api_scale=max(1.0, args.min_api_scale),
        face_restore=args.face_restore, exact=args.exact, jpeg_quality=args.jpeg_quality,
        quality_policy=args.quality_policy, budget_seconds=args.budget_seconds, dry_run=args.dry_run,
        force=args.force, pin_versions=os.environ.get("REPLICATE_PIN_VERSIONS", "1") != "0",
        print_size=getattr(args, 'print_size', None),
        tiling=args.tiling, tile_size=max(256, args.tile_size), tile_overlap=max(16, args.tile_overlap),
        tile_margin=max(0, args.tile_margin),
        tile_workers=max(1, args.tile_workers),
        preset=args.preset,
        print_ppi=args.print_ppi, fit=args.fit, bleed_mm=max(0.0, args.bleed_mm),
        sharpen=args.sharpen, icc_target=args.icc_target,
        texture_file=args.texture_file or None,
        texture_strength=max(0.0, min(1.0, args.texture_strength)),
        texture_mode=args.texture_mode,
        print_fix=args.print_fix, print_fix_substrate=args.print_fix_substrate,
        print_quality_policy=args.print_quality_policy,
        # CLI --format > UPSCALE_FORMAT > preset default (tiff for printshop, png otherwise)
        output_format=args.format or env("UPSCALE_FORMAT") or ("tiff" if args.preset == "printshop" else "png"),
        extra_inputs=parse_extra(args.extra), work_dir=Path(args.work), out_dir=Path(args.out),
    )
    files = collect_inputs(args.inputs)
    if not files:
        LOG.error("no input images found")
        return 2
    if cfg.print_size:
        try:
            PrintSpec.from_string(cfg.print_size)
        except (ValueError, IndexError):
            LOG.error("invalid --print-size / UPSCALE_PRINT_SIZE %r (use 150x100, 150x150, a1, 60x40cm, 24x16in)", cfg.print_size)
            return 2
    if cfg.print_ppi and not cfg.print_size:
        LOG.error("--print-ppi needs --print-size / UPSCALE_PRINT_SIZE")
        return 2
    if cfg.icc_target and not Path(cfg.icc_target).is_file():
        LOG.error("--icc-target file not found: %s", cfg.icc_target)
        return 2
    if cfg.texture_file and cfg.texture_file not in ("grain", "grain-color"):
        if not Path(cfg.texture_file).is_file():
            LOG.error("--texture file not found: %s (or use 'grain' / 'grain-color')", cfg.texture_file)
            return 2
        if cfg.texture_mode in ("grain", "grain-color"):
            LOG.warning("--texture-mode %s ignores the texture file %s (synthetic grain only)",
                        cfg.texture_mode, cfg.texture_file)
    if cfg.preset == "printshop" and not HAS_CMS:
        LOG.warning("Pillow has no littlecms: the source ICC is still embedded verbatim, but no sRGB profile can be generated")
    if args.plan:
        return print_plan(files, cfg)
    try:
        runner = ReplicateRunner(cfg)
    except PipelineError as exc:
        LOG.error("%s", exc)
        return 2

    LOG.info("upscale_pipeline %s | %d image(s) | target %dpx%s | model %s%s | exact=%s | preset=%s | tiling=%s/%dpx%s | %s",
             __version__, len(files), cfg.target_long_edge,
             f" (sheet {cfg.print_size} @ {cfg.print_ppi:g} PPI, fit={cfg.fit})" if (cfg.print_size and cfg.print_ppi) else "",
             cfg.model, f" -> {cfg.final_model}" if cfg.final_model else "", cfg.exact, cfg.preset, cfg.tiling, cfg.tile_size,
             (f" | texture={cfg.texture_file} ({cfg.texture_mode}, {cfg.texture_strength:g})" if cfg.texture_file else "")
             + (f" | local below x{cfg.min_api_scale:g}" if cfg.min_api_scale != PipelineConfig.min_api_scale else ""),
             "DRY-RUN" if cfg.dry_run else "LIVE")
    if cfg.print_fix or cfg.preset == "printshop":
        LOG.info("[print-quality] fix %s | re-check on every delivery, policy=%s | progress file: %s",
                 f"on ({cfg.print_fix_substrate}, {PRINT_QUALITY_SUBSTRATES[cfg.print_fix_substrate]}% ink limit)"
                 if cfg.print_fix else "OFF (--print-fix to enable)",
                 cfg.print_quality_policy, cfg.out_dir / "batch_status.json")
    webhook_url, webhook_secret = env("DELIVERY_WEBHOOK_URL", ""), env("DELIVERY_WEBHOOK_SECRET", "")
    started_utc = datetime.now(timezone.utc).isoformat(timespec="seconds")
    results = []
    write_batch_status(results, len(files), cfg, started_utc)          # 0/N: the monitor sees the run start
    for f in files:
        res = process_image(f, cfg, runner)
        write_report(res, cfg)
        if webhook_url:
            notify_webhook({k: v for k, v in asdict(res).items() if k != "passes"}, webhook_url, webhook_secret)
        results.append(res)
        write_batch_status(results, len(files), cfg, started_utc)

    ok = sum(r.status == "ok" for r in results)
    skipped = sum(r.status == "skipped" for r in results)
    failed = [r for r in results if r.status == "failed"]
    print("\n" + "-" * 78)
    print(f"{'source':34s} {'status':8s} {'in':11s} {'out':11s} {'api':>3s} {'cost':>7s}  flags")
    for r in results:
        pr = r.print_report or {}; grade = pr.get('grade',''); rec = pr.get('recommendation','')
        flag = f"  PRINT:{grade.upper()}" if grade not in ('photo-sharp','sharp','unspecified','') else ''
        pqg = ((r.delivery or {}).get("print_quality") or {}).get("grade", "")
        flag += f"  PQ:{pqg.upper()}" if pqg and pqg != "ok" else ""
        print(f"{Path(r.source).name[:34]:34s} {r.status:8s} {r.input_dims or '-':11s} {r.output_dims or '-':11s} "
              f"{r.api_passes:3d} {r.est_cost_usd:7.3f}  {len(r.quality_flags) or ''}{flag}{('  ' + r.error) if r.error else ''}")
        if rec: print(f"  {'':34s} {rec[:110]}")
    print("-" * 78)
    print(f"ok={ok} skipped={skipped} failed={len(failed)} est_cost=${sum(r.est_cost_usd for r in results):.3f} "
          f"| preset={cfg.preset} format={cfg.output_format} -> {cfg.out_dir.resolve()}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
```

### CLI reference

```
python upscale_pipeline.py [INPUT ...] --out OUT [--work WORK]     # no INPUT => UPSCALE_INPUT_DIR
  --target 9000            long edge target (9000 = 150 cm @ 150 PPI; 5120 = 5K)
  --model auto|real-esrgan|real-esrgan-a100|clarity|topaz|google
  --final-model clarity    different model for the last pass (hybrid)
  --max-passes 4           infinite-loop safeguard
  --face-restore           CodeFormer pre-pass at native resolution
  --no-exact               keep overshoot (>= 5120) instead of trimming to 5120
  --format png|jpg|webp|tiff   --jpeg-quality 95
  --quality-policy warn|abort
  --budget-seconds 1800    wall-clock cap per image
  --print-size 150x100     grade the delivered file for this sheet (150x100 | 150x150 | a1 | 60x40cm | 24x16in)
  --tiling auto|always|off --tile-size 1024 --tile-overlap 48 --tile-margin 8 --tile-workers 4
  --plan                   print passes / tiles / calls / cost / print grade per image and exit (no API)
  --preset printshop       print delivery: PDF (default) or TIFF-LZW, ICC embedded, size-derived name, _SPEC.txt, no JSON in file
  --format pdf|tiff|png|jpg|webp   pdf = one page at print size, lossless, ICC + PDF/X-4 output intent, TrimBox/BleedBox
  --print-ppi 150          derive the pixel target from --print-size at this PPI
  --fit none|crop|pad      match the sheet aspect     --bleed-mm 3     --sharpen     --icc-target file.icc
  --texture tile.png|grain|grain-color   --texture-mode multiply|overlay|soft-light|grain|grain-color   --texture-strength 0.18
  --min-api-scale 2        a remaining enlargement below x2 is finished locally, no API cost (default 1.15)
  --extra key=value        model passthrough, e.g. --extra creativity=0.25 --extra enhance_model="High Fidelity V2"
  --dry-run                simulate the API locally
  --force                  re-process even if a final with the same source hash exists
```

---

## 4. Error handling & edge cases

### Failure matrix

| Condition | Detection | Response | Where |
|---|---|---|---|
| **429 rate limit** on create (`600 req/min` account-wide; `6/min` with no payment method) | `ReplicateError.status == 429` | Sleep the server hint (`"resets in ~30s"`, `"available in 1 second"`) else exp backoff 2→60 s ± 20 % jitter; **8 attempts** | `ReplicateRunner._create_with_backoff` |
| 500/502/503/504 | status in set | Same backoff | same |
| Network error on create | `httpx.HTTPError` | Same backoff | same |
| **Client retry gap**: the official client's `RetryTransport` retries 429/503/504 **only for GET/HEAD/PUT/DELETE**; the POST that creates a prediction is never retried | — | Pipeline owns create-retry (above); polling GETs still benefit from the client's transport | design note |
| Cold start / queue (status `starting` for minutes) | Elapsed vs per-model `timeout_s` (420 s ESRGAN, 600 s Topaz/A100, 900 s Clarity) | `Prefer: wait=60` reduces polling; on deadline → `prediction.cancel()` → `PassTimeout` → pass retried (≤ 2) | `_wait_with_deadline` |
| Prediction `failed` (generic) | `status == "failed"`, `error`, tail of `logs` captured | Retry with 3 s × attempt delay, ≤ 2 retries, then image fails | `run_pass` |
| **GPU OOM** | Regex on error/logs (`out of memory`, `CUDA error`, …) | Escalate: single call → tiled → halve tile size (min 256 px) → enum step-down. Factor is never halved for 4× networks (they run at 4× internally regardless) | `run_pass` |
| Model ignored the factor | Output long edge grew < 5 % (API pass) | Retry once; second time → `SafeguardTripped` | `process_image` |
| **Infinite loop** | `api_passes ≥ max_passes` (**4**) | Abort image with the reached size in the error | `process_image` |
| Runaway time | Wall-clock > `budget_seconds` (**1800 s**) | Abort image | `process_image` |
| Output URL expired (`replicate.delivery` links live **1 hour**) | HTTP 4xx on download | Download happens immediately after `succeeded`; 4 attempts; URL never persisted | `_download_with_retry` |
| Corrupt / empty download | < 1 KB or PIL cannot open | Retry pass | `_download_with_retry`, `run_pass` |
| Non-retryable API error (401/402/404/422) | status outside retry set | Fail fast with detail (bad token, no billing, bad version, invalid input) | `_create_with_backoff` |
| Unexpected exception | catch-all | Logged with traceback, image marked failed, **batch continues**, exit code 1 | `process_image` |

### Quality degradation tracking

Computed locally after every pass on a 1024 px reference copy (no API cost). Values land in `<stem>_report.json` and, when flagged, in the summary table.

| Metric | Method | Threshold | Interpretation |
|---|---|---|---|
| `sharpness_ratio` | Variance of Laplacian, new / previous | **< 0.55** → over-smoothing; **> 3.5** → over-sharpening / halo | Real-ESRGAN typically 0.9–1.5; Clarity with `sharpen>0` can spike |
| `round_trip_psnr_db` | Downsample output to previous size, PSNR vs previous | **< 24 dB** → structural drift / hallucination | Deterministic upscalers score 35–50 dB; generative passes 26–34 dB at creativity ≤ 0.35 |
| `color_drift` | Mean per-channel shift (0–255) | **> 8** → colour cast introduced | SD-based upscalers drift most; Real-ESRGAN ≈ 0 |
| Policy | `--quality-policy warn` (default) records flags and delivers; `abort` fails the image at the first flagged pass | | |

### Other edge cases

| Case | Handling |
|---|---|
| Already ≥ 5120 px | No API call; Stage 4 trims to exact 5120 (or re-encodes as-is with `--no-exact`); report stage `already_at_target` |
| Remainder < 1.15× | Local Lanczos; still counted and reported (`local-lanczos`) |
| Alpha channel (RGBA / LA / palette transparency) | Preserved end-to-end on Real-ESRGAN (alpha supported); flattened onto white for Clarity/Topaz/Google/CodeFormer (`prepare_model_input`) |
| EXIF orientation | `ImageOps.exif_transpose` before measuring — dimensions are visual dimensions |
| CMYK / 16-bit / palette / greyscale | Converted to 8-bit RGB(A) in the working copy |
| Huge source (e.g. 100 MP TIFF) | Accepted (`MAX_IMAGE_PIXELS` raised to 400 MP); only local trim runs |
| Tiny source | below `target/4^max_passes` rejected; < 640 px warned |
| Enum factor models (Topaz, Google) | Smallest enum ≥ remainder; overshoot trimmed in Stage 4; cost note for Topaz per-MP billing |
| Aspect ratio | Verified within 0.5 % against the source after finalize |
| Duplicate work / resume | Final named with source `sha8`; existing final ⇒ `skipped` unless `--force` |
| Windows console | ASCII-only logs; UTF-8 file writes; paths via `pathlib` |
| Disk / RAM | Intermediates are lossless PNG (≈ 10–40 MB at 5K, 100–300 MB at 9000 px); tiled stitch uses a uint8 canvas ≈ 3 B/px at k× (≈ 0.3 GB for a 5200×3600 pass at k=2); `work\` is safe to purge after review |
| Concurrency | Sequential per process by default; run several `run_upscale.ps1 -Root <subfolder>` in parallel if needed — well under the 600 req/min create limit |
| Secrets | Token and webhook secret from environment or `.env` only; never in logs, reports, metadata or webhook payloads |
| Webhook endpoint down | 2 attempts, 10 s timeout, warning logged; image still delivered locally and recorded in `manifest.jsonl` |

---

## 5. Runbook

1. Put the images for a job into `C:\Users\andre\Upscaled\draft\`, check them with `.\prepare_job.ps1`, and move the ready ones into `input\` with `.\prepare_job.ps1 -Start`. README.md, *Preparing and running a job*, has the batch commands.
2. `.\run_upscale.ps1 -DryRun` → confirms plumbing, pass plans and naming with zero spend.
3. `.\run_upscale.ps1` → live run; watch for `FLAGS:` lines and the summary table.
4. Review `output\manifest.jsonl` (cost, passes, flags) and any `<stem>_report.json` with flags.
5. Re-run flagged images with a different route (`-Model topaz`, `-Final clarity`, `-Face`) and `-Force`.
6. Purge `work\` once deliverables are accepted.

## 6. Verification performed (2026-09-14)

- Model input schemas, pinned versions, hardware and pricing read from replicate.com for all six profiles.
- `replicate==1.0.7` client inspected: `predictions.create(model=|version=, input, wait=)`, `Prediction.reload/cancel/status/error/logs/metrics`, `FileOutput.url`, `ReplicateError.status/detail`; `RetryTransport` confirmed to retry idempotent verbs only.
- Replicate docs confirmed: 600 create-req/min, 429 body format, output files deleted after one hour.
- Offline dry-run executed on synthetic inputs covering: 1-pass, 2-pass, alpha, already-at-target, sub-1.15× local remainder, sub-80 px rejection, idempotent skip, JPEG/`--no-exact`, embedded metadata, reports.
- Unit checks with fakes: 429 backoff on create, OOM factor downshift (4→2), retry then success, non-retryable propagation, enum factor selection, pass planning.
- `.env` surface: auto-load with inline comments, `UPSCALE_*` defaults, CLI-over-env precedence, invalid value → exit 2, input-dir fallback, and the HMAC-signed delivery webhook verified against a local receiver.
- v1.2 print-shop delivery: ICC captured from a tagged JPEG and re-embedded in TIFF-LZW (588-byte sRGB, dpi tag 150.0, LZW confirmed on re-open); `--icc-target` conversion path; sheet-derived targets (3:2 image → 8859 px, square image on 150×100 → crop to 8859×5906, square on 150×150 with pad → 8859×8859); 3 mm bleed = 18 px per side; manifest `output_sha256` equals the file hash; `_SPEC.txt` generated; default preset still embeds JSON provenance in PNG.
- v1.1 tiling: grid coverage on 5 geometries (full coverage, ≤ 4-way overlaps, no slivers); stitched-vs-reference **PSNR 138 dB / max diff 0** for fractional (×1.73), integer (×2) and RGBA (×1.5) cases; OOM escalation single → 1024 px tiles → 512 px tiles with a fake runner; end-to-end dry-run 1300×900 → 9000×6231 in 2 passes (1 + 24 calls, est $0.05) graded SHARP at 150×100 cm; `--plan` on 6 test images.

## 7. Verification performed (2026-09-15, v1.3.1 integration)

- Delivered bundles `upscale_v1_2.zip` (1.2.0) and `upscale_v1_3.zip` (1.3.0) diffed against each other and against the
  installed 1.0.0; `requirements.txt`, `run_upscale.ps1`, `README.md` and `.env.example` identical between the two bundles.
- Offline dry-run suite on six synthetic sources (3:2 landscape, 2:3 portrait, square, 3:1 panorama, RGBA, ICC-tagged JPEG)
  under `--preset printshop --print-size 150x100 --print-ppi 40 --bleed-mm 3` with `--fit none`, `crop` and `pad`:
  1.2.0 failed 2 / 5 / 1 of the six, 1.3.0 failed 0 (with no verification) / 5 / 2 and cropped the portrait to landscape;
  1.3.1 delivers all six in every mode with the expected trim sizes, `40.0 dpi` tags, sheet-ratio aspects and names.
- `--plan` on the same set reports the sheet-derived targets (14 calls / $0.028), matching the real run.
- Texture modes multiply / overlay / soft-light (tile) and grain / grain-color on RGB and RGBA sources: TIFF-LZW with
  ICC and dpi intact; pixel deltas as expected for the blend (multiply darkens, overlay/soft-light lighten this tile,
  grain is zero-mean). `--texture-mode grain` alone applies grain; a file plus a grain mode warns; a missing file exits 2.
- Idempotency: a second identical run skips all six (est. cost $0.000); a changed `--bleed-mm` re-delivers; `--force`
  re-delivers.
- Validation: `--print-ppi` without a sheet and a missing `--icc-target` exit 2 before any work (1.3.0 crashed per image).

## 8. Verification performed (2026-09-15, v1.3.2)

- `--plan` over the 266 first-generation 5K results of the 1.0 run, 150x100 cm @ 150 PPI: 7,740 calls / $15.48 at the
  default x1.15, 0 calls / $0.00 with `--min-api-scale 2`; the 266 originals from scratch: 3,027 calls / $6.05.
- Dry run on three real results (5120x5120, 5120x3612, 1955x5120) with `--preset printshop --print-size 150x100
  --print-ppi 150 --bleed-mm 3 --min-api-scale 2`: 0 API passes, local Lanczos pass, 150 dpi TIFF-LZW with ICC, 67-139 MB
  per file, about 50 MB of work files per image, verification passing.

## 9. Verification performed (2026-09-15, v1.3.3)

- Dry run with a name clash: the original `Batch 01 thedarkmaters art.jpg`, its 1.0 result and that result's
  double-upscaled copy in one batch. Names `Batch_01_thedarkmaters_art_20x150cm_150ppi.tif` for the original and
  `..._150ppi_2.tif` shared by the two pixel-identical copies, whose source hashes match. A second run skipped all four;
  `--force` rewrote the same names without creating `_3`.
- A landscape result delivered as `imgi_113_showimg_ime97_search_150x75cm_150ppi.tif`; spec sheet `File:` lines match.

## 10. Verification performed (2026-09-15, v1.3.4)

- Reproduced the defect with 1.3.3: run 1 delivered, run 2 skipped and rewrote the report as `skipped` without delivery
  details, run 3 delivered again and paid again.
- With 1.3.4 on that damaged folder, runs 3 and 4 skipped. In a fresh folder, runs 2 and 3 skipped with the report still
  `ok` and complete, `--force` delivered again, and run 5 skipped. The manifest gained one row per run.

## 11. Verification performed (2026-09-15, v1.4.1)

- Three synthetic sources (RGB, RGBA, ICC-tagged JPEG) delivered under the printshop preset as PDF and, with identical
  settings, as TIFF. pypdf (independent parser): one page; image 2373x1585, Flate, predictor 15; ICC `/N 3`; one output
  intent; XMP declares PDF/X-4; `/Trapped /False`; MediaBox 4271.4 x 2853.0 pt with TrimBox inset 9 pt (3 mm at 40
  PPI); BleedBox = MediaBox, ArtBox = TrimBox; decoded pixels identical to the TIFF delivery. A second PDF run skipped
  all three. Default preset with an RGBA source: flattened, provenance JSON in `/Subject`, no bleed boxes inset.
- `tiff_to_pdf.py` on two real batch-01 files: 1216x8895 in 7 s (37 MB -> 7 MB) and 8895x4466 in 17 s (129 MB ->
  26 MB); `read_pdf_delivery()` decoded both and the pixel hashes equal the TIFF pixels.

## 12. Verification performed (2026-09-15, v1.4.2)

- Two independent review agents (specification review; parser-level test with pypdf in strict mode) on the 1.4.1 writer:
  findings listed in `CHANGELOG.md` 1.4.2, all fixed.
- Offline tests of 1.4.2: sRGB source -> boxes MediaBox/BleedBox/TrimBox only, ICCBased N=3 (`mntr` sRGB v2.1), no output
  intent, no PDF/X marker, `/ID` strings equal; CMYK-profile source -> warning, sRGB assumed, recorded in the delivery;
  printer-class RGB profile via `--icc-target` -> output intent without RegistryName and PDF/X-4 marker; corrupt length
  and truncated stream -> `VerificationError` in 9 s and 5 s; `Straße` title identical in Info and XMP; transparent RGBA
  input -> white; a CMYK profile passed to `write_pdf()` -> `ValidationError`.

## 13. Verification performed (2026-09-15, tiff_to_pdf.py rewrite; pipeline still 1.4.2)

- Review of the previous converter through three lenses (correctness, efficiency/memory, robustness); a second agent
  tried to refute each finding and reproduced the confirmed ones on synthetic TIFFs. Findings and fixes: `CHANGELOG.md`.
- `test_tiff_to_pdf.py`: 51 tests on synthetic TIFFs up to 1100 px -- conversion of RGB/L/P/RGBA (flattened on white),
  resolution in inches and centimetres, spec-sheet and assumed bleed, refusals (no tag, unit-less, non-square, page over
  the PDF limit, CMYK, 16-bit, multi-page, orientation, wrong spec-sheet size, unreadable or oversized bleed), re-runs
  (skip, `--force`, TIFF newer, spec sheet rewritten, recorded hash different, truncated PDF, `--dry-run` writes
  nothing), safety (failed verification keeps the previous PDF, crash after writing and inside a compression thread
  leave no files, briefly and permanently locked PDF, locked spec sheet finished on the next run, leftovers of dead runs
  removed and live ones kept), folders (`--out-dir` clashes, worker and thread counts give identical bytes, duplicates,
  empty folder), options, and `write_pdf(threads=N)` on band-edge heights (1, 2, 511-513, 1024, 1027 rows); parity: the
  previous converter and the new one at `--threads 1` write byte-identical files.
- Real deliveries: dry run over `output` and `output\print_batch_01` skipped 214 of 214 (all spec-sheet hashes match their
  PDFs) and wrote nothing. The new `read_pdf_delivery()` reproduced the recorded pixel hash of 95 real PDFs (54
  converted from TIFF, 41 pipeline-native up to 8859 px wide) and rejected a truncated file, a flipped byte and a
  shortened stream.
- Four real TIFFs (8895x4466, 5942x5942, 4466x8895, 5942x5942): old and new PDFs decode to identical pixels; sizes within
  0.001%; image stream at `--threads 1` byte-identical to the old converter's; Windows.Data.Pdf renders the multi-core PDF
  (full page and 1:1 crop) pixel-identical to the old one. Wall time for the four, start-up included, with 1-1.6 GB RAM
  free: 60.6 s old, 55.7 s new at one thread, 27.2 s new automatic (one file at a time, 8 compression threads); peak
  private memory 675 -> 741 MB. Verification decode alone: 1.7-2.1 s -> 1.0 s per file.
- Final review of the finished code (two agents, every finding reproduced): six problems fixed and covered by tests
  (`CHANGELOG.md`); confirmed: 2,208 threaded-stream layouts decode correctly and identically across thread counts,
  `threads=1` is byte-identical to the previous writer, exceptions and an early close leave no threads or `.part`
  files. After the fixes: 51 tests pass, the dry run still skips 214 of 214, 11 real PDFs re-decode to their recorded
  hashes, and a real PDF whose `/Length` is 1-1000 bytes too long returns in under 1 s with the same pixels.
