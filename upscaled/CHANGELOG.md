# Changelog — upscale_pipeline

## Fixed stalled-batch detection and job-selection script (2026-09-15, pipeline still 1.4.2)

- **README.md, step 4 "Preparing and running a job"**: The PowerShell snippet selected images to print only from
  `output\print_batch_*\*_report.json`, missing 164 images delivered to the output root and any other subfolders, so it
  would re-select already-printed images for a new batch (wasting ~15-20 min and 8 GB). Replaced with a corrected
  script that reads reports from all output folders (root and `print_batch_*`), computes each source file's display stem
  (original name with result tags removed), and checks which input files have not yet been delivered. On 2026-09-15, the
  corrected logic correctly identifies 45 remaining images of 266 (221 already delivered).
- **auditor_server.py, batch stalling detection**: The dashboard marked `output (root)` as "stalled" because
  `batch_status.json` said done=164, total=266. But those remaining images were not missing — they had been printed in
  `print_batch_02/03` by later batch runs. The stalled detection now only flags a batch when: it has a recent status file
  (updated in the last 5 min), done < total, AND undelivered images still exist in the input folder. Old batch status
  files are no longer wrongly marked as stalled; a batch showing complete is just complete.
- **local.js, batch-failure advice**: Updated the text for stalled batches to clarify: "Re-run the same batch command;
  any images already delivered to other batches are skipped." The implication was "finish that batch"; now it says what
  to actually do (re-run the command).

## Dashboard counted 0 delivered images (2026-09-15, pipeline still 1.4.2)

- The workflow section of the Print Quality Auditor showed "0 delivered, 266 to print" although 221 images were
  delivered. `auditor_server.py` looked each report's `final_path` up as written: an absolute path from before the
  project moved (`Downloads\Upscaled\...`), or a path relative to the project folder that the server, started from
  another folder, could not resolve. All 265 delivered files sit next to their reports, so the server now falls back to
  the report's own folder. Verified by running the workflow check from an unrelated folder: 221 delivered, 45 remaining,
  221 of them with a PDF, 265 PDFs in 5 folders. The restarted dashboard shows 221 delivered, 45 to print.

## tiff_to_pdf.py rewritten; faster PDF writing and checking (2026-09-15, pipeline still 1.4.2)

- The delivered PDFs were not the problem: `print_batch_01\imgi_120_..._100x100cm_150ppi.pdf`, decoded independently,
  is bit-for-bit its TIFF and renders correctly in Windows' own PDF engine; all 214 spec sheets record the exact PDF next
  to them; 95 real PDFs re-decoded to their recorded pixel hashes. The converter itself had real defects, found by a
  three-lens review in which every finding was reproduced:
  - A PDF that failed verification was already at its final name (`write_pdf()` renamed it before `verify_pdf()` ran),
    and every later run skipped it as done, exit 0.
  - "Done" meant only "ends in `%%EOF`": a TIFF delivered again by the pipeline kept its old PDF, and a spec sheet the
    pipeline rewrote never got its `PDF delivery:` line back.
  - A TIFF without resolution tags was converted at 1 PPI (Pillow reports 1 dpi), a multi-metre page that verification
    accepted. Unit-less, non-square and centimetre resolutions were not handled either.
  - `--out-dir` silently skipped or overwrote same-named TIFFs from different folders.
  - A viewer, indexer or antivirus holding the file at rename time failed the file and threw the work away; the spec
    sheet was rewritten in place as ASCII (a crash could truncate it, non-ASCII notes were lost); temporary files of a
    killed run were never cleaned up; Ctrl+C lost the summary; a negative or oversized bleed gave an inverted TrimBox;
    CMYK and 16-bit TIFFs were converted with naive formulas; multi-page and rotated TIFFs silently used page 1 as stored.
- New `tiff_to_pdf.py`: writes under a temporary name, verifies, then renames, so the final name only ever holds a
  verified file and a failure leaves the previous PDF untouched. Skips a PDF only when it is complete, not older than
  its TIFF, has the TIFF's pixel size, and the spec sheet records exactly that file (SHA-256) and the size and date
  of the TIFF it was made from (lines written before this change fall back to the other checks). Reads resolution from the TIFF tags and refuses what
  it cannot place correctly (no or unit-less resolution, non-square pixels, a page over the PDF size limit, CMYK, 16-bit,
  several pages, an orientation tag, a spec sheet describing another size, an unreadable Bleed line, a bleed that does
  not fit). Refuses output-name clashes, retries locked files, updates the spec sheet atomically keeping every other
  byte and its line endings, removes leftovers of dead runs, and has `--dry-run`. `--workers` converts several files at
  once when free memory allows; `--threads` compresses each file on several cores. Ctrl+C finishes the files in progress;
  exit codes 0 / 1 / 2 (bad options) / 130 (interrupted). 51 tests in `test_tiff_to_pdf.py`.
- `upscale_pipeline.py` (still 1.4.2, no change to what the pipeline delivers):
  - `read_pdf_delivery()` undoes the PNG Up predictor row by row instead of `np.cumsum` down the columns, and inflates at
    most 256 rows per step: 1.7-4x faster verification, with memory bounded even for very compressible images.
  - `write_pdf(threads=N)`: with N > 1 the image bands are compressed in parallel (each band a raw deflate run primed
    with the previous band's last 32 KB and ended on a sync point, under one zlib header and Adler-32; the layout pigz
    uses). Same pixels and size, a standard stream any reader decodes. The default `threads=1` writes exactly the bytes
    it wrote before, so `finalize()` and existing deliveries are unchanged; the converter uses automatic threads.
- A final two-reviewer pass on the finished code found six more problems, each reproduced, all fixed and covered by
  tests: `read_pdf_delivery()` looped forever when bytes followed the zlib stream inside `/Length` (the old decoder
  accepted such files; it again stops at the end of the stream, and a real PDF with `/Length` 1-1000 bytes too long
  now returns in under 1 s with the same pixels); a TIFF copied over with an older file date kept its old PDF; a file
  name the console code page cannot show crashed a run logged to a file; read-only spec sheets or PDFs were retried
  for 8 s with a misleading "locked" message and converted again on every run; Ctrl+C while existing PDFs were checked
  ended with a traceback instead of exit 130; a name starting with a space was converted again on every run. The
  reviewers confirmed the rest, including 2,208 threaded-stream layouts and byte identity at `threads=1`.
- Verified: 51 unit tests on synthetic TIFFs, including byte parity with the previous converter at `--threads 1`;
  dry run over `output` and `output\print_batch_01`: 214 of 214 skipped, nothing written; the new decoder reproduced the
  recorded pixel hash of 95 real PDFs and rejected truncated, bit-flipped and shortened streams; 4 real TIFFs (35-40 MP):
  old and new PDFs decode to identical pixels, sizes within 0.001%, the `--threads 1` image stream is byte-identical to
  the old one, and Windows' PDF engine renders the multi-core PDF pixel-identical to the old file. Benchmark on those
  4 files (wall time incl. start-up, busy machine with 1-1.6 GB RAM free, so one file at a time): old 60.6 s, new with 1
  thread 55.7 s, new automatic (8 threads) 27.2 s; peak memory 675 MB -> 741 MB.
- Previous versions: `_archive\v1.4.2_before_tiff_to_pdf_rewrite\`.

## Moved off OneDrive (2026-09-15, pipeline still 1.4.2)

- The project folder moved from `C:\Users\andre\OneDrive\Desktop\Image Upscale Auditor` to
  `C:\Users\andre\Upscaled`, to make it fully local: OneDrive was disconnected (signed out, not syncing), and
  `C:\Users\andre\Desktop`/`Documents` both turned out to be OneDrive-redirected on this machine too (Known
  Folder Move), so the project root now sits directly under the user profile instead of any of them.
  Same-drive move (6 seconds for 50.7 GB — a rename, not a copy).
- Every reference updated: `.env`, `.env.example`, `run_upscale.ps1` and `prepare_job.ps1` `$Root` defaults,
  `.claude\launch.json`, and every path mentioned in `README.md`, `BLUEPRINT.md`, `FINAL_PREPRESS_ACTION_PLAN.txt`,
  `FINE_ART_PIPELINE_LOCKDOWN.md`, `Print Quality Auditor\INDEX.md` and `...\QUICK_REFERENCE_PRINT_SHOP_GUIDE.txt`
  (32 replacements total). `auditor_server.py` needed no change: it already finds its folders relative to its own
  location. Verified with `--plan`: no API calls, correct paths, no errors.
- Also cleared 115 stale Windows Recent-Items shortcuts (`%APPDATA%\Microsoft\Windows\Recent`) still pointing at
  the original `Downloads\Upscaled` location from before that move — the actual source of the repeated
  "Location is not available" error for `Downloads\Upscaled\output` (not the dashboard or any script).

## Location review after the move (2026-09-15, pipeline still 1.4.2)

- Swept the whole project for references to the pre-move location. `.env`, launcher `$Root` defaults, `auditor_server.py`
  and every other script already pointed here correctly; no stale `UPSCALE_*`/`REPLICATE_*` environment variables were
  set anywhere that would have silently overridden `.env`; no Desktop shortcuts pointed at the old path.
- `BLUEPRINT.md` still named the dashboard's source folder as `Downloads\Print Quality Auditor`; corrected to
  `Print Quality Auditor\` (this project's own subfolder).
- The dashboard's batch-file picker (`Print Quality Auditor\batch.js`) opened `showOpenFilePicker` with a fixed
  `id`, which makes Chrome permanently remember the folder it was last used in — the direct cause of the
  "Location is not available" error for `Downloads\Upscaled\output` after the move. Removed the `id`, so the
  picker no longer pins itself to one remembered folder and a future move can't break it the same way.
- The old `Downloads\Upscaled` folder is empty (0 bytes) except a `.claude\launch.json` left by a preview session —
  nothing left to lose, safe to delete; still on disk pending manual removal.

## write_pdf() writes atomically (2026-09-15, pipeline still 1.4.2)

- A PDF viewer showed a real file (`imgi_116_..._100x100cm_150ppi.pdf`, a 35-megapixel image) as severe
  channel-shifted noise. Independent verification found the file itself was correct: PyMuPDF (a fully separate
  rendering engine, installed fresh for this check) rendered it perfectly, and the pipeline's own `verify_pdf()`
  (which decodes and hashes the full image stream) accepted it. `write_pdf()` had been writing directly to the
  final filename across the several seconds a large image takes to stream out, so any reader that opened the file
  during that window — a browser tab, Explorer's thumbnailer, a backup tool, antivirus — would see a truncated,
  invalid stream and could render exactly this kind of corruption; once the write finished, the file was already
  fine, which is consistent with what was observed. `write_pdf()` now writes to `<name>.pdf.<pid>.part` and
  `os.replace()`s it onto the final name in one atomic rename only after the file is complete; any exception during
  the write (including a killed process) deletes the `.part` file instead of leaving anything at the final name.
  Verified: a normal write leaves no temp file and passes `verify_pdf()`; a simulated crash partway through the
  compression loop leaves neither the destination nor a `.part` file; the printshop PDF route through the full
  pipeline (`--dry-run`) still produces a valid file with no leftovers.
- If you see this again on a *freshly delivered* file, wait a few seconds and reopen it — you likely opened it
  before the write (or, previously, before this fix) finished. A file that still looks wrong after that is a real
  bug: keep it and report it rather than deleting it.

## tiff_to_pdf.py made idempotent; project merged and moved (2026-09-15, pipeline still 1.4.2)

- `tiff_to_pdf.py` had no idempotency check: re-running it over a folder redid every conversion (6-8 s each) and
  appended a duplicate `PDF delivery:` line to each `_SPEC.txt` every time. It now skips a TIFF whose PDF already
  exists and ends with a proper `%%EOF` trailer, replaces (never duplicates) the `PDF delivery:` line when it does
  write, and reports `converted / already done / failed` counts. `--force` redoes a file anyway. A PDF left
  truncated by an interrupted run has no trailer, so it is redone rather than mistaken for finished. Verified:
  second run skips in under 1 s; `--force` leaves exactly one spec line; a truncated PDF is reconverted.
- The project folder moved from `Downloads\Upscaled` to `C:\Users\andre\OneDrive\Desktop\Image Upscale Auditor`,
  and the dashboard (formerly the sibling `Downloads\Print Quality Auditor`) is now its `Print Quality Auditor\`
  subfolder. Its `auditor_server.py` / `run_auditor.ps1` locate the pipeline root as their parent folder. Every
  absolute path in `.env`, `.env.example`, the launchers and the docs was updated and verified.

## 1.4.2 (2026-09-15) — PDF delivery: fixes from the adversarial review

Two independent reviews of the 1.4.1 writer (a specification review and a parser-level test with pypdf) found:
- The page carried both a TrimBox and an ArtBox; PDF/X allows only one. The ArtBox is gone.
- The PDF/X output intent referenced a display-class (`mntr`) sRGB profile; PDF/X requires an output-device
  (`prtr`) profile. A PDF now declares PDF/X-4 and carries the output intent only when the embedded profile is a
  printer-class RGB profile, which is what `--icc-target <the shop's canvas/paper profile>` supplies. With the
  usual sRGB profile the file is a plain, fully colour-managed PDF 1.6 (ICCBased sRGB, no PDF/X claim), and the
  `_SPEC.txt` says so. `/RegistryName` is no longer asserted for unregistered condition names.
- A CMYK or grey source profile was embedded unchanged although the pixels are RGB (TIFF and PDF routes). The
  colour step now checks the profile header: a non-RGB source profile is replaced by sRGB with a warning and a
  note in the delivery record; `--icc-target` must be an RGB profile; `write_pdf()` refuses anything else.
- The XMP declared PDF/X-4 even without an output intent; the marker and the intent are now written together and
  verification refuses a file where they disagree.
- The trailer `/ID` strings differed on first write (ISO 32000 wants them equal); both are the document id now.
- A corrupted stream length made verification loop forever, and a truncated stream raised a bare `zlib.error`;
  both now raise `VerificationError` for that image only.
- Info `/Title` and XMP `dc:title` could disagree for non-ASCII names; both use the same ASCII-cleaned text, control
  characters are stripped, line ends are escaped, `/Subject` is capped at 32,000 bytes and mirrored as
  `dc:description`; `write_pdf()` composites transparent input over white.
- The default sRGB profile is now the sRGB IEC61966-2.1 v2 profile that Windows ships (stable bytes, accepted by
  every RIP) instead of the littlecms v4 built-in; TIFF deliveries get it too.
- Verified offline: an sRGB source gives a plain PDF (boxes MediaBox/BleedBox/TrimBox only, ICCBased N=3, no intent,
  no PDF/X marker, equal `/ID` strings); a source carrying a CMYK profile is delivered as sRGB with the warning; a
  printer-class RGB profile via `--icc-target` gives the output intent and the PDF/X-4 marker; a corrupt length and
  a truncated stream raise `VerificationError` within seconds; a `Straße` title agrees between Info and XMP; a fully
  transparent RGBA input prints white. pypdf parsed every file in strict mode.
- Note for pypdf-based checks of large deliveries: raise `zlib_maximum_output_length` and `image_maximum_buffer_size`
  (pypdf's defaults stop at 75 MB of raw image data, about 25 Mpx); the pipeline's own reader streams.

## 1.4.1 (2026-09-15) — PDF delivery

- New output format `pdf` (`--format pdf`, `UPSCALE_FORMAT=pdf`, launcher `-Format pdf`), now the default in `.env`:
  one page at the physical print size. MediaBox = BleedBox = the file incl. bleed, TrimBox = ArtBox = the trim;
  8-bit RGB image, Flate-compressed with the PNG "Up" predictor (lossless, typically 4-5x smaller than TIFF-LZW);
  ICCBased colour space with the same profile declared as a PDF/X output intent (`/S /GTS_PDFX`); XMP declaring
  PDF/X-4, `/Trapped /False`, Producer, dates and a document ID; PDF 1.6, written without any new dependency.
  The default preset puts the provenance JSON into the Info `/Subject`; the printshop preset keeps JSON out of the file.
- Verification of a PDF delivery parses the file back: header, xref, page count, MediaBox and TrimBox against the
  pixel size, PPI and bleed, ICC + output intent + PDF/X marker, and decodes the image stream to compare the SHA-256
  of the pixels with what was written. The `_SPEC.txt` gains `Page:` and `Pixels SHA-256:` lines.
- Format precedence changed: CLI `--format` > `UPSCALE_FORMAT` > preset default (tiff for printshop, png otherwise).
  Before, the printshop preset forced tiff unless `--format` was passed on the command line.
- New `tiff_to_pdf.py`: writes the PDF for print files already delivered as TIFF (same name with .pdf, the TIFF's
  resolution and ICC, the bleed recorded in its `_SPEC.txt`), verified the same way, in seconds per file and
  without API calls. A line naming the PDF is appended to the `_SPEC.txt` when the PDF is written next to the TIFF.
- Note: a PDF delivery is not certified PDF/X-4; it declares PDF/X-4 and satisfies the checks above. Run the shop's
  preflight (Acrobat: Print Production > Preflight > PDF/X-4) if they require certification. The Print Quality
  Auditor page does not read PDF; the pipeline's own print-quality re-check runs on the pixels before writing.
- Verified offline: three synthetic sources under the printshop preset as PDF and as TIFF with identical settings,
  decoded with an independent parser (pypdf): pages 1, ICC N=3, one output intent, XMP PDF/X-4, Trapped False,
  MediaBox/TrimBox/BleedBox/ArtBox as specified, decoded pixels identical to the TIFF delivery; a second run skipped
  all three; default preset with an RGBA source flattens and carries the provenance. Two real batch-01 TIFFs
  converted in 7 and 17 s, pixels identical, 37 MB -> 7 MB and 129 MB -> 26 MB.

## 1.4.0 (2026-09-15) — fix and re-check what the print-quality audit flags

The Print Quality Auditor (the dashboard at https://claude.ai/artifact/BxN4SXQyh3HDtxGUKdrm6Z) measured every
batch-01 print with the same three defects: simulated ink coverage up to 304% against a 280% canvas limit
(2–12% of each image over the limit), pure RGB black in the shadows (a four-plate rich black with registration
risk, up to 6% of the image) and 8-bit banding in soft dark gradients (16–22% of the image in 2–3 mm steps).
Its resolution finding (real detail about 25% of the pixel count, 38 effective PPI) is a property of the
220–550 px sources and is not changed by this release.

- New `--print-fix` (`UPSCALE_PRINT_FIX`, launcher `-PrintFix`): Stage 4 step after texture and before colour
  and bleed. A neutral toe lift, driven by a pixel's brightest channel and fading out by level 96, keeps the
  deepest shadow at the grey whose separation stays 3% under the substrate's ink limit (level 23 for 280%):
  pure RGB 0,0,0 and the crushed black floor go, saturated colours keep their hue, white and midtones are
  untouched. An edge-aware box smoothing plus triangular dither, confined to dark and lower-mid tones,
  breaks up the banding before the single re-quantisation. Float32 bands, fixed seed: re-runs are
  byte-identical. About 10-50 s per image at print size.
- New `--print-fix-substrate` (`UPSCALE_PRINT_FIX_SUBSTRATE`): coated 300%, uncoated 260%, canvas 280%
  (default), vinyl 300%, textile 250%. Same table as the auditor.
- Every print-shop delivery (and every `--print-fix` run) is re-checked before it is written: ink coverage,
  black floor and neutral black on a 2400 px area-averaged copy (box filter: sharp text cannot ring into false
  black), banding on 1200 full-resolution rows and columns (resizing hides banding), counting plateaus of at
  least 6 px (shorter runs occur by chance in dithered tone). With the sheet known, banding is graded with the
  auditor's Tier C score at its viewing distance (1.6 x the long side): below 9 is a caveat, below 7 critical.
  Result: `print_quality` in the report, manifest and `batch_status.json`, a `Print quality:` line plus `!`
  flags in `_SPEC.txt`, and `PQ:CAVEATS` / `PQ:CRITICAL` in the summary table.
- New `--print-quality-policy abort` (`UPSCALE_PRINT_QUALITY_POLICY`): a file whose re-check is still critical
  after the fix is not delivered (`PrintQualityRefused`, the batch continues); its report, manifest row and
  status row still carry the re-check, so the reason is visible. Default `warn` delivers and flags.
- New `output\<batch>\batch_status.json`, rewritten atomically after every image: totals, ok / skipped /
  failed, critical / caveats, cost, and one row per image with print size, PPI, grade, the print-quality
  re-check and errors. The auditor's new "Follow a batch" mode watches this file while a batch runs.
- `delivery_key` includes the fix only when it is on, so deliveries made before 1.4 are still recognised as
  delivered when the fix is off. With `--print-fix` on, an earlier print-shop delivery is re-delivered (batch 01
  costs nothing to redo: the 5120 px inputs finish locally with `--min-api-scale 2`). Default-preset files are
  found by the source hash in their name, so for them the fix, like any other delivery parameter, needs
  `--force` to re-deliver.
- `batch_status.json` is written with a retry and a warning instead of an exception when another program holds
  the file open (Windows refuses the atomic replace then), so a viewer can never stop the batch.
- The re-check composites a transparent (RGBA) image over white first, as the print does, instead of measuring
  the RGB hidden under the alpha.
- Verified offline on batch-01 prints with the pipeline's own functions and the full auditor port: peak ink
  302–304% → 277–278%, over-limit area 2.3–11.7% → 0%, crushed black 0.3–6.4% → 0%, neutral black
  0.5–5.9% → 0%, banding p90 step 2.7–4.2 mm → 1.7–3.1 mm (pipeline score 6.7–8.3 → 8.0–9.2). Auditor checks:
  ink 5.5–8.0 → 10, clipping and black build → 10, banding 7.8–9.1 → 8.7–9.5; Tier A for the square poster
  8.3 → 9.7. Tier C is unchanged (4.4 / 3.5) because its bottleneck is resolution. Mean pixel change 1–3
  levels, maximum 26, shadows only; pure red, white and a mid grey pass through unchanged, a dark blue
  (0,0,40) becomes (8,8,48) at 279% instead of 287%; a black-on-white text page stays `ok`. `--dry-run`s
  delivered RGB and RGBA sources end to end through both presets with the status file, spec sheets, reports
  and a correct skip on re-run.
- An adversarial code review (four lenses, three verifiers per finding) found and this release fixes: the
  per-channel toe lift tinting saturated colours, dither on paper white, Lanczos ringing in the re-check
  counting as black, chance dither runs counted as banding, banding thresholds not matching the auditor's
  grade, a refused file losing its re-check, and the batch-status write failing under a reader.

## Draft folder and job check (2026-09-15, pipeline still 1.3.4)

- New `draft\` folder with `prepare_job.ps1` and `prepare_job.py`: check a job before it starts, then move the ready
  images into `input\`.
- The check lists every file as ready or not ready with the reason: already in `input\` by original name or identical
  pixels, already printed, a larger version of the same image in `draft\`, a 5K result upscaled a second time, an
  unsupported type, or unreadable. API calls and cost come from the pipeline's own planner; time and disk are rough.
- `-Start` moves only ready images that cost nothing. `-AllowCost` adds paid ones and `-IncludePrinted` adds already
  printed ones. Moves are logged in `draft\_moved_to_input.csv`; pixel hashes of `input\` are cached in
  `work\_prepare_job_cache.json`.
- The batch commands in README.md now pick any supported image in `input\` that is not printed yet, so originals moved
  in from `draft\` are included.
- `input\` was cleaned to the 266 usable 5K results. The other 1,100 files are in `_removed_from_input\` with
  `move_log.csv`.
- Verified on a scratch job with all of these cases: the check classified 11 files correctly, `-Start` moved only the
  2 no-cost images, a second check recognised them in `input\`, and `-AllowCost` moved the paid one.

## 1.3.4 (2026-09-15) — re-runs never deliver a finished print again

- Fixed: when a print-shop image was skipped, its report was overwritten with the skip result, which dropped the
  delivery details. The skip check only accepted a finished report, so the following run delivered the image again
  and paid for any API passes again. Present since 1.3.1; default-preset files were not affected, because they are
  recognised by the hash in their file name.
- A skip now keeps the original report and only adds a manifest row. Reports already overwritten by 1.3.1 to 1.3.3
  still count as delivered.
- Verified with dry runs: a folder damaged by 1.3.3 was skipped on every later 1.3.4 run. In a fresh folder, repeated
  runs skipped, the report stayed complete, `--force` delivered again, and the next run skipped.

## 1.3.3 (2026-09-15) — readable print file names

- Print-shop files are named `<original name>_<W>x<H>cm_<ppi>ppi.tif`, for example
  `imgi_192_showimg_cmu22_search_100x100cm_150ppi.tif` instead of
  `imgi_192_showimg_cmu22_search_5K_5120x5120_real-esrgan-a100_03339bdc_PRINT_150x100cm_5906x5906px_150ppi_sRGB.tif`.
- The size in the name is what the image actually prints at (trim, width x height). The old name gave the sheet,
  150x100cm, even for a square that prints 100x100 cm.
- Tags added by earlier runs (`_5K_WxH_model_hash`, `_9000px_WxH_model_hash`) are dropped, so a re-used result keeps
  its original image name.
- If a different picture already has that name in the output folder, `_2`, `_3` ... is appended. The same picture
  delivered again overwrites its own file; the source hash is computed from the normalised pixels, so an identical
  copy under another file name counts as the same picture.
- Pixel size, sheet and colour profile are in `_SPEC.txt` only. Default-preset names and report names are unchanged,
  because the default names carry the source hash used for skipping.

## 1.3.2 (2026-09-15) — reuse earlier results without API cost

- New `--min-api-scale` (`UPSCALE_MIN_API_SCALE`, launcher `-MinApiScale`): a remaining enlargement below this factor is
  done locally with Lanczos instead of a paid call. Default 1.15, unchanged. The start-of-run line shows it when changed.
- Why: feeding the 266 existing 5120 px results of the 1.0 run back in for 150x100 cm @ 150 PPI planned 7,740 tiled API
  calls ($15.48), more than upscaling the originals again (3,027 calls, $6.05): the last x1.15-x1.73 step on a 26 MP
  image is split into about 36 tiles. With `--min-api-scale 2` the same batch plans 0 calls ($0.00).
- Local finishing adds no detail; it only brings the file to the sheet's PPI. Detail is limited by the original
  220-550 px sources either way.
- Verified offline: three real 5K results (square, landscape, portrait) with the print-shop settings deliver 150 dpi
  TIFF-LZW with ICC, 0 API passes, verification passing; `--plan` agrees with the run.

## 1.3.1 (2026-09-15) — integration of the delivered v1.2 / v1.3 bundles

Base: `upscale_v1_3.zip` (pipeline 1.3.0, texture/grain overlay). Reviewed against `upscale_v1_2.zip` and an offline
dry-run suite (landscape, portrait, square, panoramic, RGBA and ICC-tagged JPEG sources × fit none/crop/pad × texture
modes). The following defects in the delivered files were fixed before installation:

**Regressions that v1.3.0 introduced against v1.2.0**
- `--preset printshop` fell back to PNG instead of TIFF when `--format` / `UPSCALE_FORMAT` were unset (the
  `--format` CLI default had been changed). Restored: CLI `--format` > printshop preset (tiff) > `UPSCALE_FORMAT` > png.
- `fit_to_sheet()` used the long:short ratio to pick the orientation, so **portrait images were cropped or padded
  to a landscape sheet** (600×900 → 1575×1050 crop, 3544×2363 pad). The sheet now follows the image's orientation.
- `verify_output()` had lost the sheet-aspect check, the aspect-drift-vs-source check, the delivered-PPI check, the
  embedded-ICC check and the dpi-tag check. All restored.
- `main()` had lost the up-front validation of `--print-ppi` without `--print-size`, of a missing `--icc-target`
  file (which then crashed every image with an unexpected OSError), and the littlecms warning. Restored.
- `--plan` ignored the sheet-derived pixel target and estimated the 9000 px fallback instead (71 calls / $0.142
  for six test images versus the real 14 calls / $0.028). Restored.
- Dead code: ~75 orphan lines duplicating `finalize()` after `write_spec_sheet()`'s `return`, and every tiling /
  print-shop field declared twice in `PipelineConfig`. Removed.
- The `_SPEC.txt` "Fit:" line, the `bit_depth` RGBA/RGB distinction, the start-of-run and summary lines (target,
  exact, tile size, preset, format) and a number of explanatory comments were restored from 1.2.0.

**Defects present in both 1.2.0 and 1.3.0**
- `delivered_ppi()` took the *smaller* px/inch ratio; for `fit=none` with an aspect that differs from the sheet
  (a panorama or a square on 150×100) that wrote a wrong dpi tag and file name (20 ppi / 27 ppi instead of 40 ppi),
  which would open the file *larger* than the sheet, and in 1.2.0 also failed verification for every such image.
  It now uses the binding axis of a contained fit (the larger ratio); the print grade uses the same PPI.
- `fit=crop` on an image already at the sheet ratio lost one pixel to float rounding (2362.5 → 2362) and then failed
  the "trim < target" assertion; `fit=pad` on an image less elongated than the sheet grew the canvas past the
  target and failed the "exact" assertion. Crop rounds up; verification now exempts the fitted cases it covers by
  the aspect and PPI checks instead.
- The idempotent skip only recognised default-preset file names (which carry the source hash); print-shop
  deliveries were re-upscaled — and re-billed — on every re-run. Each `<stem>_report.json` now records
  `source_sha256` and a `delivery_key` (sheet, fit, format, bleed, texture…), and a matching report whose file still
  exists is skipped. `--force` overrides as before.

**Texture / grain overlay (new in 1.3.0), hardened**
- Blends are computed in 512-row bands: at the default 9000×6000 delivery the 1.3.0 code allocated several GB of
  float32 temporaries; it is now a few hundred MB. Grain uses fixed seeds, so re-runs are byte-identical.
- The texture file is validated up front (`exit 2` with a message instead of a per-image crash); `--texture-mode
  grain` / `grain-color` on their own now enable grain (previously silently did nothing); a file combined with a
  grain mode logs a warning that the file is ignored; `.env` values of `UPSCALE_TEXTURE_MODE`, `UPSCALE_PRESET`,
  `UPSCALE_FIT` and `UPSCALE_TILING` are validated like the other enums.
- The delivery record and `_SPEC.txt` show the texture file name (not the full path) and the *effective* mode.
- `UPSCALE_TEXTURE`, `UPSCALE_TEXTURE_MODE`, `UPSCALE_TEXTURE_STRENGTH` documented in `.env.example` and README;
  `run_upscale.ps1` gained `-Texture`, `-TextureMode`, `-TextureStrength` and `-Plan`.

Verified offline (dry-run, no API): all six synthetic sources deliver under fit none / crop / pad with correct
dimensions, dpi tags and file names; all five texture modes on RGB and RGBA sources; idempotent skip (second run
skips all six, a changed bleed re-delivers, `--force` re-delivers); invalid `--icc-target`, `--texture` and
`--print-ppi` combinations exit 2 up front; `--plan` matches the real sheet-derived targets.

## 1.3.0 (delivered 2026-09-15, `upscale_v1_3.zip`)
- Texture / grain overlay: `--texture <tile.png> | grain | grain-color`, `--texture-mode multiply | overlay |
  soft-light | grain | grain-color`, `--texture-strength 0..1`; applied in Stage 4 after the exact trim, sheet fit
  and sharpen, before colour conversion and bleed. Recorded in the provenance, the delivery record and `_SPEC.txt`.

## 1.2.0 (delivered 2026-09-15, `upscale_v1_2.zip`)
- Default target 9000 px (150 cm @ 150 PPI), `--max-passes 4`, `Image.MAX_IMAGE_PIXELS` 900 MP.
- v1.1 tiling: inputs above the model's MP limit are split into overlapping tiles, upscaled concurrently at an
  integer factor, margin-trimmed and feather-stitched, then Lanczos-resized to the fractional factor; OOM
  escalation single → tiled → smaller tiles; `auto` always routes to Real-ESRGAN x4plus (T4).
- Print suitability: `--print-size` (named sheets, cm, in) with PPI grading; `--plan` estimate.
- Print-shop delivery: `--preset printshop` (TIFF-LZW, ICC captured from the source and re-embedded or sRGB
  assumed, `--icc-target` conversion, dpi tag, `--fit none|crop|pad`, `--bleed-mm`, `--sharpen`, sheet-derived file
  name, `_SPEC.txt` with the output SHA-256, `--print-ppi` sheet-derived pixel target).
- `.env` loader: last duplicate key wins with a warning; launcher hardened for PowerShell 5.1 stderr handling.

## 1.0.0 (2026-09-14) — archived in `_archive/v1.0/`
- Progressive 5K (5120 px) pipeline on Replicate: validation, optional CodeFormer pre-pass, dynamic pass loop
  with OOM downshift and quality tracking, exact trim, provenance metadata, reports, manifest, webhook.
