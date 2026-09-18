# Print quality audit: batch 01

Generated 2026-09-15 07:58 by running the Print Quality Auditor's own analysis.js and grade.js in the browser on every file of `Upscaled\output\print_batch_01`. These are the batch-01 files delivered before pipeline 1.4.0, so they have no print fix.

Settings per file, as the dashboard would use them: print size from the file name, fit set to full bleed, viewing distance 1.6 times the long side (60 to 400 cm), substrate canvas / fine-art inkjet with a 280% ink limit. Tier C is the actual job. Scores: 9 or more production ready, 7 to 8.9 acceptable with caveats, below 7 critical.

## Summary

| | |
|---|---|
| Files audited | 50 of 50 |
| Tier C score, median | 4.4 |
| Tier C score, range | 3.5 to 5.4 |
| Production ready, 9 or more | 0 |
| Acceptable with caveats, 7 to 8.9 | 0 |
| Critical failure, below 7 | 50 |
| Effective PPI, median | 38 |
| Real detail, median | 25% of pixels |
| Ink over 280%, median | 4.89% of area |
| Pure RGB black, median | 1.16% of area |
| Stepped dark gradients, median | 12.2% of area |

## Main score limiter

| Bottleneck | Files |
|---|---|
| Effective resolution | 43 |
| Stroke contrast in glare | 6 |
| Shadow gradient banding | 1 |

## Checks across the batch (Tier C)

| Check | Median | Worst | Critical | Caveat | Pass |
|---|---|---|---|---|---|
| Effective resolution | 1.9 | 1.9 | 50 | 0 | 0 |
| Pixels at viewing distance | 8.5 | 7.4 | 0 | 39 | 11 |
| Line-weight compliance | 10.0 | 9.9 | 0 | 0 | 50 |
| Shadow gradient banding | 3.0 | 3.0 | 43 | 7 | 0 |
| Ink coverage (TAC) | 6.9 | 2.0 | 25 | 19 | 6 |
| Shadow clipping | 10.0 | 6.2 | 2 | 0 | 48 |
| Reversed detail on shadows | 9.5 | 9.5 | 0 | 0 | 50 |
| Stroke contrast in glare | 10.0 | 1.0 | 6 | 0 | 44 |
| Transparency & halos | 10.0 | 10.0 | 0 | 0 | 50 |
| Black build & registration | 9.4 | 8.8 | 0 | 23 | 27 |

## Checklist items raised

| Item | Files | Critical | Caveat |
|---|---|---|---|
| The file is softer than its pixel count | 50 | 50 | 0 |
| Don't reuse this file for cards or flyers at full bleed | 50 | 0 | 50 |
| Break up the stepped shadow gradients | 50 | 43 | 7 |
| Bring total ink under 280% | 48 | 25 | 23 |
| Rebuild neutral RGB black before separation | 33 | 0 | 33 |
| Rebuild the raster for 100 Ã— 100 cm | 24 | 24 | 0 |
| Hairlines would break up at card size | 16 | 0 | 16 |
| Raise stroke contrast for lit environments | 6 | 0 | 6 |
| Rebuild the raster for 133 Ã— 100 cm | 5 | 5 | 0 |
| Rebuild the raster for 150 Ã— 75 cm | 4 | 4 | 0 |
| Reopen crushed shadow detail | 2 | 0 | 2 |
| Rebuild the raster for 100 Ã— 141 cm | 2 | 2 | 0 |
| Rebuild the raster for 100 Ã— 133 cm | 2 | 2 | 0 |
| Rebuild the raster for 100 Ã— 129 cm | 2 | 2 | 0 |
| Rebuild the raster for 150 Ã— 100 cm | 2 | 2 | 0 |
| Rebuild the raster for 150 Ã— 94 cm | 2 | 2 | 0 |
| Rebuild the raster for 142 Ã— 100 cm | 2 | 2 | 0 |
| Rebuild the raster for 20 Ã— 150 cm | 1 | 1 | 0 |
| Rebuild the raster for 75 Ã— 150 cm | 1 | 1 | 0 |
| Rebuild the raster for 100 Ã— 125 cm | 1 | 1 | 0 |
| Rebuild the raster for 150 Ã— 90 cm | 1 | 1 | 0 |
| Rebuild the raster for 100 Ã— 113 cm | 1 | 1 | 0 |

## Before and after the 1.4.0 print fix (40 of the 50 files re-delivered so far)

The running `--print-fix` job re-delivers the same images into the output root. The auditor was run on those files too, with the same settings.

| Check | Median before | Median after | Improved | Same | Worse |
|---|---|---|---|---|---|
| Tier C score | 4.4 | 4.4 | 6 | 34 | 0 |
| Effective resolution | 1.9 | 1.9 | 0 | 40 | 0 |
| Shadow gradient banding | 3.0 | 4.3 | 14 | 24 | 2 |
| Ink coverage (TAC) | 7.2 | 10.0 | 38 | 2 | 0 |
| Black build & registration | 9.4 | 10.0 | 33 | 7 | 0 |
| Shadow clipping | 10.0 | 10.0 | 16 | 24 | 0 |
| Stroke contrast in glare | 10.0 | 10.0 | 0 | 40 | 0 |
| Ink over 280%, % of area | 4.39 | 0.00 | | | |
| Pure RGB black, % of area | 1.06 | 0.00 | | | |
| Stepped dark gradients, % of area | 18.20 | 21.05 | | | |
| Pixels at the black floor, % | 0.36 | 0.00 | | | |
| Effective PPI | 38.00 | 38.00 | | | |

Verdicts before: {'Critical failure': 40}. After: {'Critical failure': 40}.

The last column is the pipeline's own re-check of the fixed file, written into the report and status file by 1.4.0.

| File | Tier C before | Tier C after | Bottleneck after | Pipeline re-check |
|---|---|---|---|---|
| Batch_01_thedarkmaters_art_20x150cm_150ppi.tif | 3.5 | 3.5 | Stroke contrast in glare | caveats (banding 8.0, ink over 0.0%, RGB black 0.0%) |
| imgi_10_top20-220x220-saa_100x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | caveats (banding 8.2, ink over 0.0%, RGB black 0.0%) |
| imgi_113_showimg_ime97_search_150x75cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | caveats (banding 8.9, ink over 0.0%, RGB black 0.0%) |
| imgi_114_showimg_ime117_search_150x75cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | ok (banding 9.2, ink over 0.0%, RGB black 0.0%) |
| imgi_115_showimg_ime154_search_100x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | caveats (banding 8.8, ink over 0.0%, RGB black 0.0%) |
| imgi_116_showimg_ime109_search_100x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | ok (banding 9.1, ink over 0.0%, RGB black 0.0%) |
| imgi_117_showimg_ime83_search_75x150cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | ok (banding 9.1, ink over 0.0%, RGB black 0.0%) |
| imgi_118_showimg_ime105_search_100x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | ok (banding 9.1, ink over 0.0%, RGB black 0.0%) |
| imgi_11_top20-220x220-wpa_100x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | caveats (banding 8.9, ink over 0.0%, RGB black 0.0%) |
| imgi_120_showimg_mcs01_search_100x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | critical (banding 3.9, ink over 0.0%, RGB black 0.0%) |
| imgi_121_showimg_mcs41_search_100x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | critical (banding 3.2, ink over 0.0%, RGB black 0.0%) |
| imgi_122_showimg_mcs16_search_100x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | critical (banding 3.0, ink over 0.0%, RGB black 0.0%) |
| imgi_123_showimg_mcs38_search_100x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | caveats (banding 8.3, ink over 0.0%, RGB black 0.0%) |
| imgi_124_showimg_mcs46_search_100x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | critical (banding 3.0, ink over 0.0%, RGB black 0.0%) |
| imgi_125_showimg_mcs10_search_100x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | caveats (banding 8.9, ink over 0.0%, RGB black 0.0%) |
| imgi_127_showimg_gve52_search_100x141cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | ok (banding 9.2, ink over 0.0%, RGB black 0.0%) |
| imgi_129_showimg_wuh93_search_133x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | critical (banding 3.1, ink over 0.0%, RGB black 0.0%) |
| imgi_12_top20-220x220-bse_100x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | critical (banding 6.0, ink over 0.0%, RGB black 0.0%) |
| imgi_130_showimg_wuh73_search_133x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | critical (banding 3.7, ink over 0.0%, RGB black 0.0%) |
| imgi_131_showimg_wuh116_search_133x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | caveats (banding 8.0, ink over 0.0%, RGB black 0.0%) |
| imgi_133_showimg_ldr73_search_100x133cm_150ppi.tif | 4.3 | 4.4 | Effective resolution | caveats (banding 8.6, ink over 0.0%, RGB black 0.0%) |
| imgi_134_showimg_ldr40_search_100x129cm_150ppi.tif | 4.3 | 4.4 | Effective resolution | caveats (banding 8.3, ink over 0.0%, RGB black 0.0%) |
| imgi_135_showimg_ldr109_search_150x100cm_150ppi.tif | 4.3 | 4.4 | Effective resolution | caveats (banding 7.9, ink over 0.0%, RGB black 0.0%) |
| imgi_136_showimg_ldr13_search_150x94cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | caveats (banding 8.0, ink over 0.0%, RGB black 0.0%) |
| imgi_137_showimg_ldr80_search_150x100cm_150ppi.tif | 4.3 | 4.4 | Effective resolution | critical (banding 3.0, ink over 0.0%, RGB black 0.0%) |
| imgi_138_showimg_ldr49_search_100x129cm_150ppi.tif | 4.3 | 4.4 | Effective resolution | caveats (banding 8.9, ink over 0.0%, RGB black 0.0%) |
| imgi_13_top20-220x220-yle_100x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | caveats (banding 8.6, ink over 0.0%, RGB black 0.0%) |
| imgi_140_showimg_mcn55_search_100x133cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | caveats (banding 7.7, ink over 0.0%, RGB black 0.0%) |
| imgi_141_showimg_mcn68_search_100x125cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | caveats (banding 8.6, ink over 0.0%, RGB black 0.0%) |
| imgi_142_showimg_mcn16_search_150x90cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | critical (banding 6.4, ink over 0.0%, RGB black 0.0%) |
| imgi_143_showimg_mcn25_search_142x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | ok (banding 9.2, ink over 0.0%, RGB black 0.0%) |
| imgi_144_showimg_mcn43_search_100x141cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | caveats (banding 7.3, ink over 0.0%, RGB black 0.0%) |
| imgi_145_showimg_mcn10_search_142x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | caveats (banding 8.5, ink over 0.0%, RGB black 0.0%) |
| imgi_147_showimg_gua53_search_150x75cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | caveats (banding 8.9, ink over 0.0%, RGB black 0.0%) |
| imgi_148_showimg_gua44_search_100x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | critical (banding 3.0, ink over 0.0%, RGB black 0.0%) |
| imgi_149_showimg_gua35_search_150x75cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | critical (banding 4.4, ink over 0.0%, RGB black 0.0%) |
| imgi_14_top20-220x220-cgo_100x100cm_150ppi.tif | 4.2 | 4.4 | Effective resolution | caveats (banding 8.9, ink over 0.0%, RGB black 0.0%) |
| imgi_150_showimg_gua41_search_133x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | critical (banding 5.5, ink over 0.0%, RGB black 0.0%) |
| imgi_151_showimg_gua07_search_133x100cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | critical (banding 3.0, ink over 0.0%, RGB black 0.0%) |
| imgi_152_showimg_gua56_search_150x94cm_150ppi.tif | 4.4 | 4.4 | Effective resolution | caveats (banding 8.3, ink over 0.0%, RGB black 0.0%) |

## Reading the numbers

- Every file is capped at 4.4 by the effective-resolution check alone (real detail is about 25% of the pixel count, 38 effective PPI). The score formula never exceeds the worst check plus 2.5, so ink, black and banding fixes cannot lift a file above 4.4 while the sources stay 220-550 px. That is a property of the originals, not of the pipeline.
- The 1.4.0 print fix removes the ink-limit and rich-black findings completely (0% of area over 280%, 0% RGB black) and raises the banding score from 3.0 to 4.3, which the auditor still grades critical. The auditor scans a copy downscaled to 3000 px, where the fix's dither averages out and the tone steps reappear; the pipeline's own re-check scans full-resolution rows and grades the same files 8-9. The two measure different things, so treat the banding line as unresolved until a print is inspected.
- 'Stroke contrast in glare' at 1.0 on six files is the auditor's type-legibility test firing on high-contrast edges in artwork that has no type; it can be ignored for these images.

## Every file, lowest score first

| File | Print cm | Tier C | Verdict | Bottleneck | Eff. PPI | Detail | Ink over 280% | RGB black | Banding |
|---|---|---|---|---|---|---|---|---|---|
| Batch_01_thedarkmaters_art_20x150cm_150ppi.tif | 20x150 | 3.5 | Critical failure | Stroke contrast in glare | 60 | 40% | 11.63% | 5.88% | 14.2% (5.5 mm) |
| imgi_264_showimg_ime154_desktop_100x100cm_150ppi.tif | 100x100 | 3.5 | Critical failure | Stroke contrast in glare | 38 | 25% | 2.34% | 1.03% | 2.3% (5 mm) |
| imgi_416_showimg_cmu39_desktop_100x100cm_150ppi.tif | 100x100 | 3.5 | Critical failure | Stroke contrast in glare | 50 | 33% | 30.41% | 16.42% | 13.3% (33.7 mm) |
| imgi_418_showimg_cmu31_desktop_100x100cm_150ppi.tif | 100x100 | 3.5 | Critical failure | Stroke contrast in glare | 38 | 25% | 22.62% | 14.29% | 9.6% (61.7 mm) |
| imgi_419_showimg_cmu33_desktop_100x100cm_150ppi.tif | 100x100 | 3.5 | Critical failure | Stroke contrast in glare | 38 | 25% | 25.02% | 16.11% | 11.2% (21.3 mm) |
| imgi_422_showimg_pbl28_desktop_100x113cm_150ppi.tif | 100x113 | 3.5 | Critical failure | Stroke contrast in glare | 38 | 25% | 8.11% | 2.28% | 6.5% (5.3 mm) |
| imgi_14_top20-220x220-cgo_100x100cm_150ppi.tif | 100x100 | 4.2 | Critical failure | Effective resolution | 38 | 25% | 74.41% | 74.75% | 8.3% (9 mm) |
| imgi_133_showimg_ldr73_search_100x133cm_150ppi.tif | 100x133 | 4.3 | Critical failure | Effective resolution | 38 | 25% | 34.54% | 18.97% | 52.6% (21.3 mm) |
| imgi_134_showimg_ldr40_search_100x129cm_150ppi.tif | 100x129 | 4.3 | Critical failure | Effective resolution | 38 | 25% | 50.06% | 46.43% | 36.1% (25.4 mm) |
| imgi_135_showimg_ldr109_search_150x100cm_150ppi.tif | 150x100 | 4.3 | Critical failure | Effective resolution | 38 | 25% | 32.19% | 33.23% | 28.5% (20.5 mm) |
| imgi_137_showimg_ldr80_search_150x100cm_150ppi.tif | 150x100 | 4.3 | Critical failure | Effective resolution | 38 | 25% | 33.24% | 33.97% | 32.6% (23.5 mm) |
| imgi_138_showimg_ldr49_search_100x129cm_150ppi.tif | 100x129 | 4.3 | Critical failure | Effective resolution | 38 | 25% | 58.25% | 15.52% | 64.3% (42.1 mm) |
| imgi_10_top20-220x220-saa_100x100cm_150ppi.tif | 100x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 4.45% | 1.03% | 19.1% (5.7 mm) |
| imgi_113_showimg_ime97_search_150x75cm_150ppi.tif | 150x75 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 2.80% | 0.60% | 5.5% (3.5 mm) |
| imgi_114_showimg_ime117_search_150x75cm_150ppi.tif | 150x75 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 34.45% | 17.93% | 22.3% (6 mm) |
| imgi_115_showimg_ime154_search_100x100cm_150ppi.tif | 100x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 24.37% | 22.91% | 3.1% (3 mm) |
| imgi_116_showimg_ime109_search_100x100cm_150ppi.tif | 100x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 2.83% | 0.46% | 8.6% (2.7 mm) |
| imgi_117_showimg_ime83_search_75x150cm_150ppi.tif | 75x150 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 2.29% | 0.48% | 3.3% (3.5 mm) |
| imgi_118_showimg_ime105_search_100x100cm_150ppi.tif | 100x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 1.23% | 0.12% | 9.8% (3.7 mm) |
| imgi_11_top20-220x220-wpa_100x100cm_150ppi.tif | 100x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 4.34% | 0.96% | 10.2% (3 mm) |
| imgi_120_showimg_mcs01_search_100x100cm_150ppi.tif | 100x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 17.73% | 10.52% | 39.9% (14 mm) |
| imgi_121_showimg_mcs41_search_100x100cm_150ppi.tif | 100x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 3.07% | 0.50% | 48.2% (14.3 mm) |
| imgi_122_showimg_mcs16_search_100x100cm_150ppi.tif | 100x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 10.35% | 6.23% | 30.4% (14.3 mm) |
| imgi_123_showimg_mcs38_search_100x100cm_150ppi.tif | 100x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 5.31% | 2.07% | 55.0% (7.3 mm) |
| imgi_124_showimg_mcs46_search_100x100cm_150ppi.tif | 100x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 1.54% | 0.11% | 54.0% (28 mm) |
| imgi_125_showimg_mcs10_search_100x100cm_150ppi.tif | 100x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 9.05% | 1.50% | 37.7% (43.7 mm) |
| imgi_127_showimg_gve52_search_100x141cm_150ppi.tif | 100x141 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 16.49% | 16.94% | 1.1% (480.8 mm) |
| imgi_129_showimg_wuh93_search_133x100cm_150ppi.tif | 133x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 0.15% | 0.03% | 3.5% (11.6 mm) |
| imgi_12_top20-220x220-bse_100x100cm_150ppi.tif | 100x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 0.07% | 0.00% | 6.1% (5 mm) |
| imgi_130_showimg_wuh73_search_133x100cm_150ppi.tif | 133x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 0.12% | 0.01% | 3.8% (8.9 mm) |
| imgi_131_showimg_wuh116_search_133x100cm_150ppi.tif | 133x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 0.02% | 0.00% | 0.6% (5.8 mm) |
| imgi_136_showimg_ldr13_search_150x94cm_150ppi.tif | 150x94 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 13.63% | 14.52% | 28.2% (10.5 mm) |
| imgi_13_top20-220x220-yle_100x100cm_150ppi.tif | 100x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 6.02% | 1.71% | 13.5% (3.3 mm) |
| imgi_140_showimg_mcn55_search_100x133cm_150ppi.tif | 100x133 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 1.83% | 0.36% | 22.4% (6.2 mm) |
| imgi_141_showimg_mcn68_search_100x125cm_150ppi.tif | 100x125 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 0.13% | 0.02% | 5.2% (3.3 mm) |
| imgi_142_showimg_mcn16_search_150x90cm_150ppi.tif | 150x90 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 1.87% | 0.24% | 10.2% (10 mm) |
| imgi_143_showimg_mcn25_search_142x100cm_150ppi.tif | 142x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 7.81% | 0.72% | 4.0% (3.3 mm) |
| imgi_144_showimg_mcn43_search_100x141cm_150ppi.tif | 100x141 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 0.15% | 0.00% | 30.4% (14.1 mm) |
| imgi_145_showimg_mcn10_search_142x100cm_150ppi.tif | 142x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 5.50% | 0.82% | 9.9% (5.2 mm) |
| imgi_147_showimg_gua53_search_150x75cm_150ppi.tif | 150x75 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 2.14% | 1.23% | 24.4% (11.0 mm) |
| imgi_148_showimg_gua44_search_100x100cm_150ppi.tif | 100x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 4.01% | 2.08% | 17.3% (29.3 mm) |
| imgi_149_showimg_gua35_search_150x75cm_150ppi.tif | 150x75 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 2.89% | 1.08% | 21.7% (16.0 mm) |
| imgi_150_showimg_gua41_search_133x100cm_150ppi.tif | 133x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 6.76% | 2.44% | 59.1% (45.8 mm) |
| imgi_151_showimg_gua07_search_133x100cm_150ppi.tif | 133x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 0.73% | 0.12% | 6.8% (12.0 mm) |
| imgi_152_showimg_gua56_search_150x94cm_150ppi.tif | 150x94 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 3.13% | 0.41% | 23.0% (37.6 mm) |
| imgi_192_showimg_cmu22_search_100x100cm_150ppi.tif | 100x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 18.63% | 9.40% | 6.8% (3 mm) |
| imgi_265_showimg_ime109_desktop_100x100cm_150ppi.tif | 100x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 2.97% | 0.45% | 6.6% (3.3 mm) |
| imgi_395_showimg_ylm13_desktop_100x100cm_150ppi.tif | 100x100 | 4.4 | Critical failure | Effective resolution | 38 | 25% | 4.47% | 0.61% | 7.8% (9 mm) |
| imgi_417_showimg_cmu22_desktop_100x100cm_150ppi.tif | 100x100 | 5.3 | Critical failure | Effective resolution | 50 | 33% | 19.07% | 10.10% | 4.3% (5.3 mm) |
| imgi_435_showimg_nha08_desktop_100x100cm_150ppi.tif | 100x100 | 5.4 | Critical failure | Shadow gradient banding | 50 | 33% | 2.23% | 0.01% | 20.4% (15.3 mm) |

Note: the dashboard shows the embedded profile name of these TIFFs as unreadable characters; Pillow reads it as sRGB. This is a display issue in the auditor's profile parser and does not affect any score.
