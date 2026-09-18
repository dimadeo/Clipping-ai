// Pure arithmetic: what must an artwork become to be a genuine 300 PPI print file. No I/O.

export const PRINT_PPI = 300;
const CM_PER_INCH = 2.54;
const fail = (message) => { throw Object.assign(new Error(message), { statusCode: 400 }); };

export const pixelsForCm = (cm) => Math.ceil(cm / CM_PER_INCH * PRINT_PPI);

/** Pixel area required to print widthCm × heightCm at 300 PPI. */
export function requiredPixels(widthCm, heightCm) {
  if (![widthCm, heightCm].every((n) => Number.isFinite(n) && n > 0)) fail('Print size must be positive centimetres');
  return pixelsForCm(widthCm) * pixelsForCm(heightCm);
}

/**
 * Given a source (width, height) and the largest print size the listing promises, return the
 * upscale plan. Policy 'area' keeps the artwork's native ratio and scales until its pixel
 * count meets the promise; the honest print size at that ratio is reported alongside.
 * `factors` is the set the provider actually supports; the plan picks the smallest that suffices.
 */
export function planUpscale({ width, height, targetWidthCm, targetHeightCm, factors = [2, 4, 6] } = {}) {
  if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0)) fail('Source dimensions must be positive integers');
  const target = requiredPixels(targetWidthCm, targetHeightCm);
  const source = width * height;
  const exact = Math.sqrt(target / source);
  const supported = [...factors].filter((f) => Number.isFinite(f) && f > 1).sort((a, b) => a - b);
  if (!supported.length) fail('At least one upscale factor above 1 is required');
  const factor = supported.find((f) => f >= exact) ?? null;
  const chosen = factor ?? supported.at(-1);
  const outWidth = Math.round(width * chosen), outHeight = Math.round(height * chosen);
  return {
    policy: 'area',
    source: { width, height, megapixels: +(source / 1e6).toFixed(2) },
    target: { widthCm: targetWidthCm, heightCm: targetHeightCm, pixels: target, megapixels: +(target / 1e6).toFixed(2) },
    exactFactor: +exact.toFixed(3),
    factor: chosen,
    sufficient: factor !== null,
    output: { width: outWidth, height: outHeight, megapixels: +(outWidth * outHeight / 1e6).toFixed(2) },
    printsToCm: { width: +(outWidth / PRINT_PPI * CM_PER_INCH).toFixed(1), height: +(outHeight / PRINT_PPI * CM_PER_INCH).toFixed(1) },
    note: factor === null
      ? `Even ${chosen}x leaves this source short of ${targetWidthCm} × ${targetHeightCm} cm at ${PRINT_PPI} PPI. Generate a larger source or promise a smaller print.`
      : `${chosen}x meets the ${targetWidthCm} × ${targetHeightCm} cm promise at ${PRINT_PPI} PPI with the artwork's native ratio intact.`,
  };
}
