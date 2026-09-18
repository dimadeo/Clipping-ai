# 5K / 9K Upscaling Pipeline (Replicate)

Progressive, tiled upscaling for large-format printing (150 cm sheets at 150 PPI by default) with Real-ESRGAN / Clarity / Topaz / Google via the Replicate API. Delivers print-shop-ready **PDF (one page at print size, lossless image, ICC profile embedded, trim and bleed boxes; PDF/X-4 output intent when the shop's printer profile is given with `--icc-target`) or TIFF-LZW with embedded ICC profile and dpi tag, plus a `_SPEC.txt` delivery note**; `--target 5120 --preset default` for plain 5K PNGs. Optional paper/canvas texture or film-grain overlay on the finished file (v1.3).
Full design, model rationale and failure handling: **BLUEPRINT.md**. Version history: **CHANGELOG.md**.

## Quick start (Windows)

```powershell
cd C:\Users\andre\Upscaled
copy .env.example .env          # paste REPLICATE_API_TOKEN
.\run_upscale.ps1 -Plan         # passes, tiles, API calls, cost and print grade per image; no API
.\run_upscale.ps1 -DryRun       # offline test, no API calls
.\run_upscale.ps1               # live: input\ -> output\
```

`run_upscale.ps1` creates `.venv`, installs `requirements.txt`, loads `.env`, and runs `upscale_pipeline.py` on `input\` writing to `output\` (intermediates in `work\`).

## Configuration (`.env`)

| Group | Keys |
|---|---|
| Executor (Replicate) | `REPLICATE_API_TOKEN`, `REPLICATE_PIN_VERSIONS`, `REPLICATE_POLL_INTERVAL` |
| Storage (local folders) | `UPSCALE_INPUT_DIR`, `UPSCALE_OUTPUT_DIR`, `UPSCALE_WORK_DIR` |
| Pipeline defaults | `UPSCALE_MODEL`, `UPSCALE_FINAL_MODEL`, `UPSCALE_TARGET_PX` (9000), `UPSCALE_MAX_PASSES`, `UPSCALE_MIN_API_SCALE`, `UPSCALE_EXACT`, `UPSCALE_FORMAT`, `UPSCALE_JPEG_QUALITY`, `UPSCALE_FACE_RESTORE`, `UPSCALE_QUALITY_POLICY`, `UPSCALE_BUDGET_SECONDS`, `UPSCALE_PRINT_SIZE` |
| Tiling | `UPSCALE_TILING`, `UPSCALE_TILE_SIZE`, `UPSCALE_TILE_OVERLAP`, `UPSCALE_TILE_MARGIN`, `UPSCALE_TILE_WORKERS` |
| Print-shop delivery | `UPSCALE_PRESET`, `UPSCALE_PRINT_PPI`, `UPSCALE_FIT`, `UPSCALE_BLEED_MM`, `UPSCALE_SHARPEN`, `UPSCALE_ICC_TARGET` |
| Print-quality fix + re-check (v1.4) | `UPSCALE_PRINT_FIX` (1 = fix ink limit, black floor and banding), `UPSCALE_PRINT_FIX_SUBSTRATE` (coated / uncoated / canvas / vinyl / textile), `UPSCALE_PRINT_QUALITY_POLICY` (warn / abort) |
| Texture / grain (optional) | `UPSCALE_TEXTURE` (tile file, or `grain` / `grain-color`), `UPSCALE_TEXTURE_MODE` (multiply / overlay / soft-light), `UPSCALE_TEXTURE_STRENGTH` (0..1) |
| Delivery (optional) | `DELIVERY_WEBHOOK_URL`, `DELIVERY_WEBHOOK_SECRET` — one signed JSON row per finished image |

Precedence: CLI flag > environment > `.env` > built-in default. Every key is documented in `.env.example`.

## Common routes

| Goal | Command |
|---|---|
| Plan first (passes, tiles, cost, print grade; no API) | `.\run_upscale.ps1 -Plan` |
| Print-shop delivery (from `.env`: 150x100 sheet @150 PPI, PDF, 3 mm bleed) | `.\run_upscale.ps1` |
| Same as TIFF instead of PDF | `.\run_upscale.ps1 -Format tiff` |
| PDF for prints already delivered as TIFF (no upscaling, a few seconds per file on all cores; safe to re-run: up-to-date files are skipped, `--dry-run` shows what would be converted and why, `--force` redoes them) | `.\.venv\Scripts\python.exe tiff_to_pdf.py output\print_batch_01` |
| Check that the TIFF-to-PDF converter still works (51 tests on tiny synthetic files, about 25 s) | `.\.venv\Scripts\python.exe -m unittest test_tiff_to_pdf` |
| Same, square sheet with white padding | `.\.venv\Scripts\python.exe upscale_pipeline.py --print-size 150x150 --fit pad` |
| Convert into the shop's profile | `... --icc-target AdobeRGB1998.icc` |
| Plain 5K PNG (no print handling) | `... --preset default --target 5120 --print-size ""` |
| Paper / canvas texture on the finished print | `.\run_upscale.ps1 -Texture textures\paper.png -TextureMode soft-light -TextureStrength 0.25` |
| Film grain (no texture file needed) | `.\run_upscale.ps1 -Texture grain -TextureStrength 0.2` (or `grain-color`) |
| Portraits | `.\run_upscale.ps1 -Face` |
| Generative detail on the last pass | `.\run_upscale.ps1 -Final clarity` |
| Topaz, JPEG out | `.\run_upscale.ps1 -Model topaz -Format jpg` |
| Keep overshoot (>= target, no trim) | `.\run_upscale.ps1 -NoExact` |
| Re-process delivered files | `.\run_upscale.ps1 -Force` |
| Reuse already-upscaled files (e.g. old `*_5K_*.png` results in `input\`) with no API cost | `.\run_upscale.ps1 -Plan -MinApiScale 2`, then `.\run_upscale.ps1 -MinApiScale 2` |
| Fix what the Print Quality Auditor flags (ink over the limit, RGB black, banding) and re-check every file | `.\run_upscale.ps1 -MinApiScale 2 -PrintFix` (substrate from `.env`, default canvas) |
| Refuse to deliver a file that is still critical after the fix | `... -PrintFix -PrintQualityPolicy abort` |
| Follow a running batch in the dashboard | open the Print Quality Auditor, **Follow a batch**, pick `output\print_batch_NN\batch_status.json` |

Direct CLI (reads `.env` for folders/defaults): `.\.venv\Scripts\python.exe upscale_pipeline.py` — add `--dry-run` for an offline test, `--plan` for the estimate, `--help` for every flag.

Re-running the batch is safe: an image whose source bytes and delivery parameters (sheet, fit, format, bleed, texture…) already produced a file in `output\` is skipped, so no API calls are repeated. Change a parameter, or pass `-Force`, to re-deliver.

## Preparing and running a job

1. Put the images for the job in `draft\`.
2. Check them. Every file is listed as ready or not ready with the reason, together with API calls, cost and a rough time and disk estimate. The same list is saved as `draft\_job_preview.txt`.
   ```powershell
   .\prepare_job.ps1
   ```
   Not ready means one of these: already in `input\` by original name or with identical pixels under another name, already printed, a larger version of the same image is in `draft\`, a 5K result upscaled a second time, an unsupported type such as SVG, or a file that cannot be opened.
3. Move the ready images into `input\`. Images that need paid API passes stay in `draft\` unless you add `-AllowCost`, and already printed images stay unless you add `-IncludePrinted`. Every move is logged in `draft\_moved_to_input.csv`.
   ```powershell
   .\prepare_job.ps1 -Start
   ```
4. Print `input\` in batches of 50, about 15 to 20 minutes and 8.5 GB each at 150 PPI. In one PowerShell window, set the batch number, pick the next 50 unprinted images, check that the cost line says `~0 API calls | est $0.000` unless you moved paid images, then run the batch:
   ```powershell
   $n = "02"
   # Identify remaining undelivered images from input. For each report in all output
   # folders (root, print_batch_*, etc), record the original name of its source file.
   # Then list input files whose original name hasn't been delivered yet.
   $n = "02"
   $batch = @(.\.venv\Scripts\python.exe -c @'
import json
from pathlib import Path
from upscale_pipeline import _display_stem

# Match auditor_server.workflow() logic: count only reports with delivery records
delivered = set()
out = Path("output")
for folder in [out] + sorted(d for d in out.iterdir() if d.is_dir()):
    for r in folder.glob("*_report.json"):
        try:
            j = json.loads(r.read_text(encoding="utf-8"))
            # Only count reports with ok/skipped status, a final_path, and a delivery record
            if not j or j.get("status") not in ("ok", "skipped") or not j.get("final_path"):
                continue
            final = Path(j["final_path"])
            if not final.exists():
                final = folder / final.name
            # Count only PDF/TIFF deliveries with delivery records (rule out old PNG reports)
            if not final.exists() or not j.get("delivery") or final.suffix.lower() not in (".pdf", ".tif", ".tiff"):
                continue
            # Record the source file stem (original name, tags removed)
            src = Path(j.get("source", "")).name
            if src:
                stem = _display_stem(Path(src))
                delivered.add(stem)
        except: pass

input_dir = Path("input")
remaining = []
for f in sorted(input_dir.iterdir()):
    if f.is_file() and f.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"}:
        if _display_stem(f) not in delivered:
            remaining.append(f)

print(f"left to print: {len(remaining)} | this batch: {min(50, len(remaining))}")
for f in remaining[:50]:
    print(str(f))
'@)

   $status = $batch[0]
   $batch = $batch | Select-Object -Skip 1 | Get-Item
   $status
   .\.venv\Scripts\python.exe upscale_pipeline.py --plan --min-api-scale 2 $batch.FullName
   .\.venv\Scripts\python.exe upscale_pipeline.py --min-api-scale 2 --out "output\print_batch_$n" --work "work\print_batch_$n" $batch.FullName
   ```
   Always keep `--min-api-scale 2`. After checking a batch, delete its `work\print_batch_NN` folder, and move finished print files off C: when space runs low.
5. While the batch runs, open the [Print Quality Auditor](https://claude.ai/artifact/BxN4SXQyh3HDtxGUKdrm6Z), switch to **Follow a batch** and pick `output\print_batch_NN\batch_status.json`. The page re-reads it every 3 seconds (or pick it again in a browser that cannot watch files) and shows progress, cost and each file's print-quality re-check. With `UPSCALE_PRINT_FIX=1` in `.env` (the default since 1.4) every file gets the ink-limit, black-floor and banding fix before the check; a file still critical after the fix is flagged `PQ:CRITICAL` in the summary and, with `--print-quality-policy abort`, not delivered. Batch 01 was printed before 1.4; re-run it with the same command to re-deliver it with the fix at no API cost (print-shop deliveries are indexed by their report, so a changed fix setting re-delivers; default-preset files are indexed by name and need `-Force`).

## Outputs

- `output\<original name>_100x100cm_150ppi.pdf` — print file, named with the size it actually prints at: one page, MediaBox = the file incl. bleed, TrimBox = the trim, image lossless (Flate), ICC profile embedded (PDF/X-4 output intent with the shop's printer profile). `-Format tiff` gives the same pixels as TIFF-LZW with ICC + dpi tag. `..._SPEC.txt` — delivery note with pixel size, page and trim size, colour profile, SHA-256 of the file and of the pixels, fit and texture used
- `output\<name>_9000px_<W>x<H>_<model>_<sha8>.png` — default-preset deliverable with embedded provenance
- `output\<name>_report.json` — per-pass dims, model/version, tiles, quality metrics, flags, print grade, delivery details incl. the print-quality re-check (`delivery.print_quality`: ink peak and over-limit area, black floor, neutral black, banding step size, flags, grade ok / caveats / critical)
- `output\manifest.jsonl` — batch log (status, passes, est. cost, seconds)
- `output\batch_status.json` — live batch summary for the dashboard's batch monitor, rewritten after every image
