import sharp from 'sharp';

/**
 * The anti-fakery guard. A plain resize produces pixels without detail, and pixel counts alone
 * would score it as a perfect print file. The only measurement that means anything is relative:
 * the candidate's high-frequency energy against a Lanczos stretch of the SAME source to the SAME
 * size. A stretch adds nothing above the source's own detail ceiling; a real upscaler does.
 * No statistic can tell new detail from good sharpening, so this never claims 'verified'.
 */

const LAPLACIAN = { width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] };
const SAMPLE_EDGE = 2048;
const NOTHING_ADDED_CEILING = 1.05;
const CLEAR_GAIN_FLOOR = 1.25;

async function greyRaw(bytes, { width, height } = {}) {
  const open = { limitInputPixels: false, failOn: 'warning' };
  let input = bytes, raw;
  if (width && height) {
    // Materialise the resize as RGB before greying. Chained in one pipeline, libvips greys first,
    // which is not what a real upscaler's RGB output goes through, and the baseline would diverge.
    const stretched = await sharp(bytes, open).resize({ width, height, kernel: sharp.kernel.lanczos3, fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    input = stretched.data; raw = { raw: { width: stretched.info.width, height: stretched.info.height, channels: stretched.info.channels } };
  }
  const { data, info } = await sharp(input, { ...open, ...raw }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Variance of the Laplacian over a centred sample window (a cheap, standard focus measure). */
export async function laplacianVariance(bytes, resizeTo) {
  const grey = await greyRaw(bytes, resizeTo);
  const edge = Math.min(SAMPLE_EDGE, grey.width, grey.height);
  const left = Math.floor((grey.width - edge) / 2), top = Math.floor((grey.height - edge) / 2);
  const { data } = await sharp(grey.data, { raw: { width: grey.width, height: grey.height, channels: 1 } })
    .extract({ left, top, width: edge, height: edge })
    .convolve(LAPLACIAN)
    .raw().toBuffer({ resolveWithObject: true });
  let sum = 0, sumSq = 0;
  for (let i = 0; i < data.length; i++) { const v = data[i]; sum += v; sumSq += v * v; }
  const n = data.length, mean = sum / n;
  return { variance: sumSq / n - mean * mean, sampleEdge: edge, width: grey.width, height: grey.height };
}

/**
 * Compare a candidate master against a Lanczos stretch of its own source at the same output size.
 * Returns the ratio and a verdict, and is explicit that a high ratio means 'more high-frequency
 * energy than a stretch', not 'genuine new detail'.
 */
export async function detailReport({ sourceBytes, candidateBytes }) {
  const candidate = await laplacianVariance(candidateBytes);
  const baseline = await laplacianVariance(sourceBytes, { width: candidate.width, height: candidate.height });
  const ratio = baseline.variance > 0 ? candidate.variance / baseline.variance : null;
  const verdict = ratio === null ? 'unmeasurable' : ratio <= NOTHING_ADDED_CEILING ? 'nothing_added' : ratio >= CLEAR_GAIN_FLOOR ? 'clear_gain' : 'marginal_gain';
  return {
    method: 'laplacian-variance-vs-lanczos-baseline',
    candidate: { width: candidate.width, height: candidate.height, variance: +candidate.variance.toFixed(3) },
    baseline: { width: baseline.width, height: baseline.height, variance: +baseline.variance.toFixed(3) },
    ratio: ratio === null ? null : +ratio.toFixed(3),
    verdict,
    detailVerified: false,
    caveat: 'Ratio compares high-frequency energy against a plain Lanczos stretch of the same source. A ratio near 1 proves the upscaler added nothing. A higher ratio does not distinguish real detail from sharpening; inspect the 1:1 crops before selling this as a print file.',
  };
}

/** 1:1 crops from the centre and one corner, for the reviewer to look at instead of trusting a number. */
export async function inspectionCrops(bytes, { edge = 800 } = {}) {
  const meta = await sharp(bytes, { limitInputPixels: false }).metadata();
  const size = Math.min(edge, meta.width, meta.height);
  const spots = [
    { name: 'centre', left: Math.floor((meta.width - size) / 2), top: Math.floor((meta.height - size) / 2) },
    { name: 'corner', left: Math.max(0, meta.width - size - 16), top: Math.max(0, meta.height - size - 16) },
  ];
  const crops = [];
  for (const spot of spots) {
    const png = await sharp(bytes, { limitInputPixels: false }).extract({ left: spot.left, top: spot.top, width: size, height: size }).png().toBuffer();
    crops.push({ name: spot.name, left: spot.left, top: spot.top, size, png });
  }
  return crops;
}
