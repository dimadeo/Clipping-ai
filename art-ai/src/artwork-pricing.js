import { MARKET_COMPARABLES } from './pricing-market.js';
import { PRINT_SIZES } from './print-sizes.js';
import { requiredPixels } from './print-targets.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_DAYS = 90;
const METHOD = 'resolution-market-v1';
const TIERS = [
  { minimumCm: 50, tier: 'extra-large', label: 'Extra-large', factor: 1.5 },
  { minimumCm: 30, tier: 'large', label: 'Large', factor: 1.25 },
  { minimumCm: 20, tier: 'standard', label: 'Standard', factor: 1 },
  { minimumCm: 12, tier: 'compact', label: 'Compact', factor: 0.8 },
  { minimumCm: 0, tier: 'small', label: 'Small', factor: 0.6 },
];
const CAVEATS = [
  'This is a rule-based digital-download price suggestion, not an AI appraisal or an artistic-quality assessment.',
  'Size tiers and multipliers are draft retail rules, not market-proven pricing differences.',
  'The market sample is limited; listing prices are observations, not evidence of sales or willingness to pay.',
  'Print dimensions use the entire image at its original aspect ratio. Cropping or borders change the result.',
  'Pixel dimensions do not establish sharpness, native resolution, or whether the file was upscaled; upscaling is unverified.',
  'The 150 PPI figures are a size preview, not a print-quality promise. Printing and framing costs are excluded.',
  'File size in MB is not used. Included files, print sizes, seller reputation, promotions, and licence terms may differ.',
  'Human approval is required. This suggestion does not publish a product or change an approved selling price.',
];

function checkedDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(value + 'T00:00:00.000Z');
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return null;
  return timestamp;
}

function validSample(sample) {
  if (!sample || sample.productKind !== 'single-digital-download' ||
      (sample.currency !== undefined && sample.currency !== 'USD') ||
      !['regular', 'sale'].includes(sample.priceType) ||
      typeof sample.priceUsd !== 'number' || !Number.isFinite(sample.priceUsd) || sample.priceUsd <= 0 ||
      typeof sample.title !== 'string' || !sample.title.trim() ||
      typeof sample.seller !== 'string' || !sample.seller.trim() || checkedDay(sample.checkedAt) === null) return false;
  try {
    const url = new URL(sample.url);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

function marketSnapshot(samples, now) {
  const timestamp = new Date(now).getTime();
  const today = Number.isFinite(timestamp) ? Math.floor(timestamp / DAY_MS) * DAY_MS : NaN;
  const sources = [], seen = new Set();
  let stale = false;
  for (const sample of Array.isArray(samples) ? samples : []) {
    if (!validSample(sample)) continue;
    const age = (today - checkedDay(sample.checkedAt)) / DAY_MS;
    if (!Number.isFinite(age) || age < 0) continue;
    if (age > MAX_AGE_DAYS) { stale = true; continue; }
    // Repeated URLs are one observation even if their fragments differ.
    const url = new URL(sample.url); url.hash = '';
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    sources.push({ ...sample });
  }
  const prices = sources.map(sample => sample.priceUsd).sort((a, b) => a - b);
  const middle = Math.floor(prices.length / 2);
  const medianUsd = prices.length ? (prices.length % 2 ? prices[middle] : prices[middle - 1] / 2 + prices[middle] / 2) : null;
  const sellerCount = new Set(sources.map(sample => sample.seller.trim().toLowerCase())).size;
  return {
    checkedAt: sources.length ? sources.map(sample => sample.checkedAt).sort()[0] : null,
    sources, medianUsd, lowUsd: prices[0] ?? null, highUsd: prices.at(-1) ?? null,
    stale, confidence: 'limited', sampleCount: sources.length, sellerCount,
  };
}

function printSize(width, height, ppi) {
  return {
    widthCm: +(width / ppi * 2.54).toFixed(1),
    heightCm: +(height / ppi * 2.54).toFixed(1),
    widthIn: +(width / ppi).toFixed(2),
    heightIn: +(height / ppi).toFixed(2),
  };
}

const retailAmount = amount => Math.max(1, Math.round(amount)).toFixed(2);

/** A transparent estimate from measured pixels and dated listing observations. No network calls. */
export function suggestArtworkPrice(dimensions, { samples = MARKET_COMPARABLES, now = new Date() } = {}) {
  const market = marketSnapshot(samples, now);
  const result = {
    amount: null, currency: 'USD', status: 'unavailable', method: METHOD,
    tier: null, label: null, printAt300: null, printAt150: null, factor: null,
    market, range: { low: null, high: null }, caveats: [...CAVEATS], requiresHumanApproval: true,
  };
  if (market.stale) result.caveats.push('Market observations older than 90 days were excluded. Refresh their prices before using them.');
  const { width, height } = dimensions || {};
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    return { ...result, basis: 'Price suggestion unavailable: valid measured pixel dimensions are required.' };
  }
  const tier = TIERS.find(candidate => Math.min(width, height) / 300 * 2.54 >= candidate.minimumCm);
  Object.assign(result, {
    tier: tier.tier, label: tier.label, factor: tier.factor,
    printAt300: printSize(width, height, 300), printAt150: printSize(width, height, 150),
  });
  if (market.sampleCount < 3 || market.sellerCount < 2) {
    return { ...result, basis: 'Price suggestion unavailable: at least three current single-download USD listings from two sellers are required (checked within 90 days, with no future dates).' };
  }
  if (![market.medianUsd, market.lowUsd, market.highUsd].every(price => Number.isFinite(price * tier.factor))) {
    return { ...result, basis: 'Price suggestion unavailable: market prices cannot be calculated reliably.' };
  }
  return {
    ...result, amount: retailAmount(market.medianUsd * tier.factor), status: 'suggested',
    range: { low: retailAmount(market.lowUsd * tier.factor), high: retailAmount(market.highUsd * tier.factor) },
    basis: `${market.sampleCount} current single-download USD listings from ${market.sellerCount} sellers; median $${market.medianUsd.toFixed(2)} × ${tier.factor} (${tier.label} draft size rule), rounded to the nearest dollar with a $1 minimum.`,
  };
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const ratioOf = (w, h) => { const d = gcd(w, h); return `${w / d}:${h / d}`; };

/**
 * A price for every catalogue size sharing the artwork's own aspect ratio, using the same
 * market anchor as suggestArtworkPrice but each size's OWN tier factor, not the master's.
 * A size is offered only when the master's pixel count genuinely reaches 300 DPI for it;
 * matches the codebase's stance that upscaling and sharpness are never assumed, only measured.
 */
export function sizeLadder(dimensions, options = {}) {
  const anchor = suggestArtworkPrice(dimensions, options);
  const { width, height } = dimensions || {};
  if (anchor.status !== 'suggested' || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    return { ...anchor, sizes: [] };
  }
  const nativeRatio = ratioOf(width, height);
  const havePixels = width * height;
  const sizes = PRINT_SIZES
    .filter(size => size.ratio === nativeRatio)
    .map(size => {
      const tier = TIERS.find(candidate => Math.min(size.widthCm, size.heightCm) >= candidate.minimumCm);
      const needPixels = requiredPixels(size.widthCm, size.heightCm);
      const available = havePixels >= needPixels;
      return {
        size: size.size, widthCm: size.widthCm, heightCm: size.heightCm, tier: tier.tier, label: tier.label,
        priceUsd: retailAmount(Number(anchor.market.medianUsd) * tier.factor),
        available,
        reason: available ? null : `The master has ${(havePixels / 1e6).toFixed(1)} MP; this size needs ${(needPixels / 1e6).toFixed(1)} MP at 300 DPI.`,
      };
    })
    .sort((a, b) => a.widthCm * a.heightCm - b.widthCm * b.heightCm);
  return { ...anchor, nativeRatio, sizes };
}
