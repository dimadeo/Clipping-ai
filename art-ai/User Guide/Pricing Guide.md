# Pricing Guide

## What you see

Open Review. For an unchecked image, click **Check resolution & suggest price**. The pricing panel shows the suggested digital-download price, a range, full-image print capacity in centimetres and inches, and the dated listings used as comparisons.

The selling-price field remains editable. **Use suggested…** copies the suggestion into that field; it does not approve or publish anything. Changing the title, price or visual score clears the approval tick. Existing approved prices are preserved, including manual overrides.

In Approved / Shopify queue, **Compare with today’s pricing guide · saved price unchanged** shows a read-only suggestion using the existing measured dimensions and the current dated market sample. Opening it does not reprice the product or refresh the source listings.

**Recheck resolution & price** now opens the result automatically and keeps the measured pixels and suggested price visible beside the approved price.

If a Midjourney link cannot be downloaded, the check stops before pricing. Under that pending artwork, expand **Upload original file**, choose its original PNG or JPG, then click **Upload original & check**. The system saves an unchanged private copy and measures it. Use the real original, not a screenshot. Uploads are limited to 40 MB and 64 megapixels. Approved and rejected items cannot be replaced through this control; their decisions and backups are protected.

## Pixels, not megabytes

Print width in inches = pixel width divided by PPI. Multiply inches by 2.54 for centimetres. The same calculation applies to height. The guide uses 300 PPI as a consistent reference, not a guarantee of print quality.

A 3000 × 4500 pixel image corresponds to 25.4 × 38.1 cm at 300 PPI. Cropping changes the usable pixels. Compression, file format and metadata can change the file size in MB without increasing visible detail.

Upscaling can increase pixel dimensions without recovering original detail. The system cannot yet verify native resolution or judge sharpness automatically: inspect the original and, for large prints, test the print output. Do not advertise a larger format solely because a file has more pixels.

## How the draft price is calculated

The guide takes the median asking price from the current comparison sample, then applies the factor below. These are proposed store pricing rules, not measured premiums paid by buyers. The shorter printed side determines the tier, so rotating an image does not change its price.

| Shorter side at 300 PPI | Guide tier | Factor |
| --- | --- | --- |
| Under 12 cm | Small | 0.60 |
| 12 to under 20 cm | Compact | 0.80 |
| 20 to under 30 cm | Standard | 1.00 |
| 30 to under 50 cm | Large | 1.25 |
| 50 cm or more | Extra-large | 1.50 |

The result is rounded to the nearest whole USD, with a $1 minimum. The displayed range uses the lowest and highest sample prices multiplied by the same factor. It is not a statistical confidence interval. These rules can be revised before adopting a store-wide pricing policy.

## Market evidence

The initial sample was checked on 12 September 2026. It includes three separate sellers of single digital artwork designs. Some provide several ratio files of the same design; those are not collections of different artworks.

| Seller and listing | Observed USD price | Package |
| --- | --- | --- |
| [Syneva — Line: Reverie No. 2](https://syneva.art/products/line-reverie-no-2) | $10.00 | One design, multiple ratios |
| [MagnoliaMoonArt — Sea Turtle](https://www.magnoliamoonart.com/products/sea-turtle-printable-art) | $5.00 | One design, six JPGs |
| [Art Instantly — Abstract Coastal Landscape](https://artinstantly.com/products/abstract-coastal-print-landscape-painting-printable-wall-art-abstract-seascape-beachy-decor-digital-print-from-art-instantly-2) | $14.99 | One painting, three ratio files |

Prices were cross-checked with each shop's public product data. Syneva and MagnoliaMoonArt had older prices in the web-reader snapshots; the guide uses the live product data. The sample median is $10.00, not the market value of your artwork.

These are advertised asking prices, not verified sales. The small sample does not establish demand, collector value, rarity, artistic merit, brand value or comparable licensing rights. It is not matched to each artwork's subject or artistic style. Seller-advertised print sizes have not been independently validated; we do not infer their pixel dimensions from those claims. Your final price may be above or below this guide.

## Freshness and approval

The guide recalculates locally; it does not browse or spend API credits on every click. Market observations are manually curated and dated. Evidence older than 90 days is excluded. At least three valid USD listings from two sellers must remain; otherwise the suggestion is unavailable and you can enter a manual price. Refreshing a file's resolution does not refresh the market observations.

Approval saves your chosen price and a snapshot of the pricing advice with the inspected artwork. Rechecking unchanged approved files does not replace your price. A changed file requires a new inspection and approval.

## Digital files versus printed products

This guide prices a digital download only. Printing, framing, shipping, taxes and supplier margins need a separate physical-product calculation. It does not price licences, exclusivity or artwork collections automatically.

Shopify's regular product fields hold the listing and preview. The approved customer download belongs in the Digital Products app attached to that listing. Automatic Shopify upload and delivery verification remain separate, unfinished integration steps.
