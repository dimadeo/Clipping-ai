# Print quality audit: all delivered PDFs

Generated 2026-09-15 by running the Print Quality Auditor's own `analysis.js` and `grade.js` in the browser on the
current delivery of every printed image: 221 PDFs.

| Folder | PDFs audited |
|---|---|
| `output\` (pipeline 1.4.0 with the print fix, TIFF converted to PDF) | 164 |
| `output\print_batch_01\`, only the 7 images never re-delivered with the print fix | 7 |
| `output\print_batch_02\` (pipeline 1.4.2, print fix) | 10 |
| `output\print_batch_03\` (pipeline 1.4.2, print fix) | 40 |

Not audited: the 43 older copies in `print_batch_01` whose images were re-delivered in `output\` (see item 2 below),
and the single 50x50 cm test in `output\custom_prints`. Per-file results: `all_deliveries_audit_2026-09-15.csv`.

Settings per file, as the dashboard would use them: print size from the file name, fit set to full bleed, viewing
distance 1.6 times the long side (60 to 400 cm), substrate canvas / fine-art inkjet with a 280% ink limit. Tier C is
the actual job. Scores: 9 or more production ready, 7 to 8.9 acceptable with caveats, below 7 critical.

## File integrity: no corrupt files

| Check | Result |
|---|---|
| PDFs decoded by the dashboard | 221 of 221, no errors |
| Spec sheet's recorded PDF SHA-256 matches the file on disk | 214 of 214 TIFF/PDF pairs |
| Decoded pixels match the hash recorded at delivery | 95 of 95 checked (54 TIFF-converted, 41 pipeline-native) |
| `print_batch_01\imgi_120_..._100x100cm_150ppi.pdf`, decoded independently | bit-for-bit identical to its TIFF; Windows' own PDF engine renders it correctly |
| Leftover partial files (`.part`) | none |

Nothing needs to be re-made because of a broken file. The scores below are about how the images will print.

## Summary

| | |
|---|---|
| Files audited | 221 |
| Tier C score, median | 4.4 |
| Tier C score, range | 3.5 to 5.8 |
| Production ready, 9 or more | 0 |
| Acceptable with caveats, 7 to 8.9 | 0 |
| Critical failure, below 7 | 221 |
| Effective PPI | 38 for 201 files, 50 for 15, 60 for 5 |

## Main score limiter

| Bottleneck | Files |
|---|---|
| Effective resolution | 195 |
| Stroke contrast in glare | 20 |
| Shadow gradient banding | 6 |

## Checks across all files (Tier C)

| Check | Median | Worst | Critical | Caveat | Pass |
|---|---|---|---|---|---|
| Effective resolution | 1.9 | 1.9 | 221 | 0 | 0 |
| Pixels at viewing distance | 8.3 | 7.4 | 0 | 164 | 57 |
| Line-weight compliance | 10 | 9.4 | 0 | 0 | 221 |
| Shadow gradient banding | 3.9 | 3.0 | 181 | 37 | 3 |
| Ink coverage (TAC) | 10 | 2.0 | 5 | 2 | 214 |
| Shadow clipping | 10 | 9.3 | 0 | 0 | 221 |
| Reversed detail on shadows | 10 | 9.5 | 0 | 0 | 221 |
| Stroke contrast in glare | 10 | 1.0 | 20 | 0 | 201 |
| Transparency & halos | 10 | 8.2 | 0 | 3 | 218 |
| Black build & registration | 10 | 8.8 | 0 | 6 | 215 |

Every file is limited by resolution. The 5K results were made from small web images (220-550 px), so roughly a
quarter of their pixels carry real detail: about 38 effective PPI at 100-150 cm. No finishing step changes that; only a
larger original or a smaller print size does (at 50x50 cm the same file is 150 PPI). The 50 files in batches 2 and 3
have no ink or white-border problems; the print fix is holding.

## Files that need attention (the "bugged" list)

No file has been moved. These are the files that differ from the rest in a way worth acting on, most urgent first.

### 1. Delivered without the print fix: ink over the limit (7 files, `output\print_batch_01` only)

These were printed before pipeline 1.4.0 and never re-delivered, so they are the only files with ink above 280%. Five
are critical for ink. Re-delivering them with the print fix costs nothing (local finishing, no API calls).

| File | Ink (TAC) score | Also |
|---|---|---|
| imgi_416_showimg_cmu39_desktop_100x100cm_150ppi.pdf | 2.0 | stroke contrast 1.1 |
| imgi_419_showimg_cmu33_desktop_100x100cm_150ppi.pdf | 2.9 | stroke contrast 1.0 |
| imgi_418_showimg_cmu31_desktop_100x100cm_150ppi.pdf | 3.4 | stroke contrast 1.0 |
| imgi_417_showimg_cmu22_desktop_100x100cm_150ppi.pdf | 4.1 | |
| imgi_422_showimg_pbl28_desktop_100x113cm_150ppi.pdf | 6.3 | stroke contrast 1.0 |
| imgi_395_showimg_ylm13_desktop_100x100cm_150ppi.pdf | 7.1 | |
| imgi_435_showimg_nha08_desktop_100x100cm_150ppi.pdf | 8.0 | banding is the main limiter |

### 2. Two versions of the same print under the same name (43 files)

43 names exist in both `output\` (print-fixed, pipeline 1.4.0) and `output\print_batch_01\` (older, no print fix),
with different pixels. Sending a file from `print_batch_01` sends the older version. Example: the
`print_batch_01\imgi_120_showimg_mcs01_search_100x100cm_150ppi.pdf` checked today is the 1.3.2 file; the print-fixed
one is `output\imgi_120_showimg_mcs01_search_100x100cm_150ppi.pdf`.

### 3. White border baked into the image (3 files, `output\`)

The artwork has a flat white frame from the web source, which prints as a white box around the picture.

- imgi_116_showimg_ime109_search_100x100cm_150ppi.pdf (the file from this morning's corrupted-looking screenshot;
  the file itself decodes correctly)
- imgi_211_showimg_nha02_search_100x109cm_150ppi.pdf
- imgi_263_showimg_ime117_desktop_150x75cm_150ppi.pdf

### 4. Dark linework that disappears under shop lighting (20 files)

Strong strokes fall below 4.5:1 contrast under retail lighting (score 1.0). A property of the artwork, not a file
fault; it matters most for pieces hung under spotlights or behind glass.

- `output\`: Batch_01_thedarkmaters_art_20x150cm, imgi_173_showimg_cgo109_search_80x150cm,
  imgi_183_showimg_hhl86_search_55x150cm, imgi_197_showimg_pbl37_search_53x150cm, imgi_201_showimg_pbl09_search_50x150cm,
  imgi_264_showimg_ime154_desktop_100x100cm, imgi_269_showimg_mcs01_desktop_100x100cm,
  imgi_281_showimg_ldr73_desktop_100x133cm, imgi_282_showimg_ldr40_desktop_100x129cm
- `print_batch_01\`: imgi_416, imgi_418, imgi_419, imgi_422 (also in item 1)
- `print_batch_02\`: imgi_301_showimg_wpa260_desktop_100x100cm, imgi_303_showimg_wpa264_desktop_100x133cm
- `print_batch_03\`: imgi_391_showimg_bse20_desktop_100x128cm, imgi_393_showimg_ylm22_desktop_100x100cm,
  imgi_400_showimg_cgo109_desktop_80x150cm, imgi_403_showimg_cgo51_desktop_100x113cm,
  imgi_409_showimg_hhl86_desktop_55x150cm

### 5. Banding is the main limiter (6 files)

`output\`: imgi_172_showimg_cgo146_search_95x150cm, imgi_200_showimg_pbl33_search_57x150cm,
imgi_276_showimg_gve52_desktop_100x141cm, imgi_295_showimg_gua44_desktop_100x100cm; `print_batch_01\`:
imgi_435_showimg_nha08_desktop_100x100cm; `print_batch_03\`: imgi_399_showimg_cgo146_desktop_95x150cm. Stepped dark
gradients are common across the whole set (critical in 181 files); in these six they cost more than resolution does.
