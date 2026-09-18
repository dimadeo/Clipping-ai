import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestArtworkPrice, sizeLadder } from '../src/artwork-pricing.js';

const NOW = '2026-09-12T12:00:00.000Z';
const samples = [10, 20, 30].map((priceUsd, i) => ({
  title: `Single printable ${i + 1}`, seller: i < 2 ? 'Seller A' : 'Seller B',
  url: `https://example.com/art/${i + 1}`, priceUsd, priceType: 'regular',
  productKind: 'single-digital-download', includedFiles: 'One image',
  printSizeNote: 'See listing', licenseNote: 'Personal use', checkedAt: '2026-09-12',
}));
const price = (dimensions, overrides = {}) => suggestArtworkPrice(dimensions, { samples, now: NOW, ...overrides });
const ladder = (dimensions, overrides = {}) => sizeLadder(dimensions, { samples, now: NOW, ...overrides });
const standard = { width: 3000, height: 4000 };

test('suggests a transparent median-based download price and full-ratio print dimensions', () => {
  const result = price(standard);
  assert.equal(result.status, 'suggested');
  assert.equal(result.amount, '20.00');
  assert.equal(result.currency, 'USD');
  assert.equal(result.method, 'resolution-market-v1');
  assert.equal(result.tier, 'standard');
  assert.equal(result.factor, 1);
  assert.deepEqual(result.range, { low: '10.00', high: '30.00' });
  assert.deepEqual(result.printAt300, { widthCm: 25.4, heightCm: 33.9, widthIn: 10, heightIn: 13.33 });
  assert.deepEqual(result.printAt150, { widthCm: 50.8, heightCm: 67.7, widthIn: 20, heightIn: 26.67 });
  assert.equal(result.market.medianUsd, 20);
  assert.equal(result.market.sampleCount, 3);
  assert.equal(result.market.sellerCount, 2);
  assert.equal(result.market.confidence, 'limited');
  assert.equal(result.requiresHumanApproval, true);
  assert.match(result.basis, /median \$20\.00 × 1/);
  assert.ok(result.caveats.some(note => /draft retail rules/.test(note)));
  assert.ok(result.caveats.some(note => /not an AI appraisal/.test(note)));
  assert.ok(result.caveats.some(note => /upscaling is unverified/.test(note)));
  assert.ok(result.caveats.some(note => /150 PPI.*not a print-quality promise/.test(note)));
});

test('every tier boundary uses the unrounded short edge at 300 PPI and prices increase monotonically', () => {
  const tiers = [
    { cm: 12, before: 'small', after: 'compact', factor: 0.8, amount: '16.00' },
    { cm: 20, before: 'compact', after: 'standard', factor: 1, amount: '20.00' },
    { cm: 30, before: 'standard', after: 'large', factor: 1.25, amount: '25.00' },
    { cm: 50, before: 'large', after: 'extra-large', factor: 1.5, amount: '30.00' },
  ];
  let previousAmount = 0;
  for (const boundary of tiers) {
    const pixels = Math.ceil(boundary.cm / 2.54 * 300);
    const before = price({ width: pixels - 1, height: pixels * 2 });
    const at = price({ width: pixels, height: pixels * 2 });
    assert.equal(before.tier, boundary.before);
    assert.equal(at.tier, boundary.after);
    assert.equal(at.factor, boundary.factor);
    assert.equal(at.amount, boundary.amount);
    assert.ok(Number(before.amount) >= previousAmount);
    assert.ok(Number(at.amount) >= Number(before.amount));
    previousAmount = Number(at.amount);
  }
  assert.equal(price({ width: 1122, height: 1402 }).amount, '12.00');
  assert.equal(price({ width: 1122, height: 10000 }).tier, 'small');
});

test('rotation does not change price and file size in MB does not affect the suggestion', () => {
  const portrait = price({ width: 1122, height: 1402, fileSizeMb: 0.3, bytes: 300000 });
  const landscape = price({ width: 1402, height: 1122, fileSizeMb: 39, bytes: 39000000 });
  assert.equal(portrait.amount, landscape.amount);
  assert.equal(portrait.tier, landscape.tier);
  assert.deepEqual(portrait.range, landscape.range);
  assert.equal(portrait.printAt300.widthCm, landscape.printAt300.heightCm);
  assert.equal(portrait.printAt300.heightCm, landscape.printAt300.widthCm);
  assert.deepEqual(price({ ...standard, fileSizeMb: 1 }), price({ ...standard, fileSizeMb: 39 }));
});

test('invalid or missing measured dimensions never generate an amount', () => {
  for (const dimensions of [undefined, null, {}, { width: 0, height: 2000 }, { width: -1, height: 2000 },
    { width: 1.5, height: 2000 }, { width: '1200', height: 2000 }, { width: Infinity, height: 2000 },
    { width: NaN, height: 2000 }, { width: Number.MAX_SAFE_INTEGER + 1, height: 2000 }]) {
    const result = price(dimensions);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.amount, null);
    assert.equal(result.printAt300, null);
    assert.equal(result.printAt150, null);
    assert.match(result.basis, /measured pixel dimensions/);
  }
});

test('requires at least three valid current listings from at least two sellers', () => {
  for (const fixtures of [[], null, samples.slice(0, 2), samples.map(sample => ({ ...sample, seller: 'Same seller' }))]) {
    const result = price(standard, { samples: fixtures });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.amount, null);
    assert.deepEqual(result.range, { low: null, high: null });
  }
  const duplicate = [samples[0], { ...samples[0], url: samples[0].url + '#details' }, samples[2]];
  assert.equal(price(standard, { samples: duplicate }).status, 'unavailable');
});

test('excludes old and future observations; a date exactly 90 days old remains usable', () => {
  const dated = date => samples.map(sample => ({ ...sample, checkedAt: date }));
  const cutoff = price(standard, { samples: dated('2026-06-14') });
  assert.equal(cutoff.status, 'suggested');
  assert.equal(cutoff.market.stale, false);
  const old = price(standard, { samples: dated('2026-06-13') });
  assert.equal(old.status, 'unavailable');
  assert.equal(old.market.stale, true);
  assert.equal(old.market.sampleCount, 0);
  assert.equal(price(standard, { samples: dated('2026-09-13') }).status, 'unavailable');
  assert.equal(price(standard, { now: 'invalid date' }).status, 'unavailable');
});

test('rejects invalid prices, currencies, product kinds, price types, source URLs, and dates', () => {
  const invalidChanges = [
    { priceUsd: 0 }, { priceUsd: -10 }, { priceUsd: NaN }, { priceUsd: Infinity }, { priceUsd: '10' },
    { currency: 'GBP' }, { productKind: 'bundle' }, { productKind: 'physical-print' },
    { priceType: 'from' }, { url: 'http://example.com/art' }, { url: 'not a URL' },
    { url: 'https://user:password@example.com/art' }, { checkedAt: '2026-02-30' },
    { checkedAt: '2026-09-12T00:00:00Z' }, { checkedAt: '' }, { seller: ' ' }, { title: '' },
  ];
  for (const changes of invalidChanges) {
    assert.equal(price(standard, { samples: [samples[0], samples[1], { ...samples[2], ...changes }] }).status, 'unavailable');
  }
  const sale = samples.map(sample => ({ ...sample, currency: 'USD', priceType: 'sale' }));
  assert.equal(price(standard, { samples: sale }).status, 'suggested');
});

test('median resists an outlier while the displayed observed range remains honest', () => {
  const outlier = samples.map((sample, i) => ({ ...sample, priceUsd: i === 2 ? 1000000 : sample.priceUsd }));
  const result = price(standard, { samples: outlier });
  assert.equal(result.amount, '20.00');
  assert.deepEqual(result.range, { low: '10.00', high: '1000000.00' });
  const invalidExtra = [...samples, { ...samples[2], url: 'https://example.com/negative', priceUsd: -1000 }];
  assert.equal(price(standard, { samples: invalidExtra }).amount, '20.00');
});

test('even samples use the middle-pair median and retail rounding has a one-dollar floor', () => {
  const even = [...samples, { ...samples[2], url: 'https://example.com/four', priceUsd: 40 }];
  assert.equal(price(standard, { samples: even }).amount, '25.00');
  const fractional = samples.map(sample => ({ ...sample, priceUsd: sample.priceUsd / 100 }));
  const result = price({ width: 1, height: 1 }, { samples: fractional });
  assert.equal(result.amount, '1.00');
  assert.deepEqual(result.range, { low: '1.00', high: '1.00' });
  assert.equal(price(standard, { samples: samples.map(sample => ({ ...sample, priceUsd: 10.5 })) }).amount, '11.00');
});

test('does not mutate source data or dimensions while producing suggestions', () => {
  const frozenSamples = samples.map(sample => Object.freeze({ ...sample }));
  const result = price(Object.freeze({ ...standard }), { samples: Object.freeze(frozenSamples) });
  assert.equal(result.amount, '20.00');
  assert.notEqual(result.market.sources[0], frozenSamples[0]);
});

test('sizeLadder prices every catalogue size sharing the artwork\'s own ratio, marking sizes the master cannot reach', () => {
  const result = ladder(standard); // 3000x4000 = 3:4, 12 MP; the only 3:4 catalogue size, 30x40 cm, needs 16.75 MP
  assert.equal(result.status, 'suggested');
  assert.equal(result.nativeRatio, '3:4');
  assert.equal(result.sizes.length, 1);
  assert.deepEqual(result.sizes[0], {
    size: '30 × 40 cm', widthCm: 30, heightCm: 40, tier: 'large', label: 'Large',
    priceUsd: '25.00', available: false, reason: 'The master has 12.0 MP; this size needs 16.7 MP at 300 DPI.',
  });
});

test('sizeLadder marks a size available once the master genuinely reaches its 300 DPI pixel count', () => {
  const bigMaster = { width: 3600, height: 4800 }; // still 3:4, 17.28 MP clears the 16.75 MP the 30x40 cm print needs
  const result = ladder(bigMaster);
  assert.equal(result.sizes.length, 1);
  assert.equal(result.sizes[0].available, true);
  assert.equal(result.sizes[0].reason, null);
  assert.equal(result.sizes[0].priceUsd, '25.00');
});

test('sizeLadder returns a real multi-size ladder in ascending order for a ratio with several catalogue sizes', () => {
  const master = { width: 8000, height: 12000 }; // 2:3, 96 MP: clears 60x90cm (75.3 MP) but not 80x120 or 100x150
  const result = ladder(master);
  assert.equal(result.nativeRatio, '2:3');
  assert.deepEqual(result.sizes.map(s => s.size), ['60 × 90 cm', '80 × 120 cm', '100 × 150 cm']);
  assert.deepEqual(result.sizes.map(s => s.available), [true, false, false]);
  // The pre-existing tier table has no ceiling above 50 cm, so every 2:3 size here lands in the same
  // 'extra-large' tier and therefore the same price — the ladder reuses that table faithfully, it does not redesign it.
  assert.deepEqual(result.sizes.map(s => s.tier), ['extra-large', 'extra-large', 'extra-large']);
  assert.deepEqual(new Set(result.sizes.map(s => s.priceUsd)), new Set(['30.00']));
});

test('sizeLadder has no sizes for a ratio absent from the catalogue, and passes through an unavailable base price untouched', () => {
  const oddRatio = ladder({ width: 3333, height: 4001 }); // reduces to an exact ratio with no PRINT_SIZES match
  assert.equal(oddRatio.status, 'suggested');
  assert.deepEqual(oddRatio.sizes, []);
  const thin = { width: 3, height: 3 }; // fewer than 3 listings from 2 sellers once overridden below
  const noMarket = ladder(thin, { samples: samples.slice(0, 1) });
  assert.equal(noMarket.status, 'unavailable');
  assert.deepEqual(noMarket.sizes, []);
});
