import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProductionReview, reviewZone } from '../src/production-review.js';

const NOW = '2026-09-12T12:00:00.000Z';
const samples = [10, 20, 30].map((priceUsd, i) => ({
  title: `Download ${i + 1}`, seller: i < 2 ? 'Seller A' : 'Seller B',
  url: `https://example.com/listing/${i + 1}`, priceUsd, priceType: 'regular',
  productKind: 'single-digital-download', checkedAt: '2026-09-12',
}));
const legacyPricing = { amount: '18.00', currency: 'USD', basis: 'Existing local catalogue draft price; editable proposal, not a new market valuation.' };
const approval = (hash, price = 69) => ({ decision: 'approved', hash, price, visualScore: 8, visualConfirmed: true });

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmas-pricing-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assetRoot = path.join(root, 'assets'); fs.mkdirSync(assetRoot);
  const image = path.join(assetRoot, 'image.png');
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(1122, 16); bytes.writeUInt32BE(1402, 20);
  fs.writeFileSync(image, bytes);
  const options = {
    file: path.join(root, 'reviews.json'), assetRoot,
    sources: () => [{ id: 'one', title: 'Review example', assetUrl: '/assets/image.png' }],
    pricingSamples: samples, pricingNow: NOW,
  };
  return { root, image, bytes, options, review: new ProductionReview(options) };
}

test('new inspections suggest a price from measured pixels; changed pending bytes update the tier', async t => {
  const { review, image, bytes } = fixture(t);
  const first = await review.inspect('one');
  assert.equal(first.pricing.amount, '12.00');
  assert.equal(first.pricing.tier, 'small');
  bytes.writeUInt32BE(3000, 16); bytes.writeUInt32BE(4000, 20);
  fs.writeFileSync(image, bytes);
  const changed = await review.inspect('one');
  assert.equal(changed.fileChanged, true);
  assert.equal(changed.pricing.amount, '20.00');
  assert.equal(changed.pricing.tier, 'standard');
  assert.equal(reviewZone(changed), 'pending');
});

test('listing an old pending review refreshes its suggestion without changing memory or disk', async t => {
  const { review, options } = fixture(t);
  await review.inspect('one');
  review.records.one.pricing = { ...legacyPricing }; review.save();
  const storedBefore = fs.readFileSync(options.file, 'utf8');
  const listed = review.list()[0];
  assert.equal(listed.pricing.amount, '12.00');
  assert.equal(listed.pricing.method, 'resolution-market-v1');
  assert.deepEqual(review.records.one.pricing, legacyPricing);
  assert.equal(fs.readFileSync(options.file, 'utf8'), storedBefore);
  assert.equal(new ProductionReview(options).list()[0].pricing.amount, '12.00');
});

test('unchanged pending inspections replace the former fixed-price advice and persist it', async t => {
  const { review, options } = fixture(t);
  const first = await review.inspect('one');
  review.records.one.pricing = { ...legacyPricing }; review.save();
  const updated = await review.inspect('one');
  assert.equal(updated.hash, first.hash);
  assert.equal(updated.fileChanged, false);
  assert.equal(updated.pricing.amount, '12.00');
  assert.equal(new ProductionReview(options).records.one.pricing.method, 'resolution-market-v1');
});

test('approved prices of 18 and 69 and all their old pricing advice survive list, recheck and restart', async t => {
  for (const amount of [18, 69]) {
    const { review, options } = fixture(t);
    const first = await review.inspect('one');
    await review.decide('one', approval(first.hash, amount));
    review.records.one.pricing = { ...legacyPricing, amount: amount.toFixed(2), auditField: 'preserve this' };
    review.save();
    const savedPricing = structuredClone(review.records.one.pricing);
    const savedApproval = structuredClone(review.records.one.approval);
    review.pricingSamples = samples.map(sample => ({ ...sample, priceUsd: sample.priceUsd * 10 }));
    assert.deepEqual(review.list()[0].pricing, savedPricing);
    const rechecked = await review.inspect('one');
    assert.deepEqual(rechecked.pricing, savedPricing);
    assert.deepEqual(rechecked.approval, savedApproval);
    assert.equal(rechecked.product.price, amount.toFixed(2));
    const restored = new ProductionReview(options).list()[0];
    assert.deepEqual(restored.pricing, savedPricing);
    assert.deepEqual(restored.approval, savedApproval);
    assert.equal(restored.product.price, amount.toFixed(2));
  }
});

test('approved artworks expose a current comparison guide without changing any saved decision or file', async t => {
  const { review, options } = fixture(t);
  const first = await review.inspect('one');
  await review.decide('one', approval(first.hash, 69));
  review.records.one.pricing = { ...legacyPricing };
  review.save();
  const storedRecord = structuredClone(review.records.one);
  const storedFile = fs.readFileSync(options.file, 'utf8');
  review.pricingSamples = samples.map(sample => ({ ...sample, priceUsd: sample.priceUsd * 2 }));
  const listed = review.list()[0];
  assert.equal(listed.currentPriceGuide.method, 'resolution-market-v1');
  assert.equal(listed.currentPriceGuide.amount, '24.00');
  assert.equal(listed.product.price, '69.00');
  assert.equal(listed.approval.price, '69.00');
  assert.deepEqual(listed.pricing, legacyPricing);
  assert.deepEqual(listed.approval, storedRecord.approval);
  assert.deepEqual(review.records.one, storedRecord);
  assert.equal(fs.readFileSync(options.file, 'utf8'), storedFile);
  assert.equal(new ProductionReview(options).records.one.currentPriceGuide, undefined);
});

test('current comparison guides are limited to approved records matching the source and containing dimensions', async t => {
  const { review } = fixture(t);
  const first = await review.inspect('one');
  assert.equal(review.list()[0].currentPriceGuide, undefined);
  await review.decide('one', approval(first.hash));
  assert.ok(review.list()[0].currentPriceGuide);
  review.records.one.sourceUrl = '/assets/replacement.png';
  assert.equal(review.list()[0].currentPriceGuide, undefined);
  review.records.one.sourceUrl = '/assets/image.png';
  const quality = review.records.one.quality;
  delete review.records.one.quality;
  assert.equal(review.list()[0].currentPriceGuide, undefined);
  review.records.one.quality = quality;
  await review.decide('one', { decision: 'rejected', hash: first.hash });
  assert.equal(review.list()[0].currentPriceGuide, undefined);
});

test('approval recalculates final advice, preserves the manual 69 price, and archives both snapshots', async t => {
  const { root, review, options } = fixture(t);
  const first = await review.inspect('one');
  assert.equal(first.pricing.amount, '12.00');
  review.pricingSamples = samples.map(sample => ({ ...sample, priceUsd: sample.priceUsd * 2 }));
  const result = await review.decide('one', approval(first.hash));
  assert.equal(result.pricing.amount, '24.00');
  assert.equal(result.approval.price, '69.00');
  assert.equal(result.product.price, '69.00');
  assert.deepEqual(result.approval.pricingSuggestion, result.pricing);
  assert.notEqual(result.approval.pricingSuggestion, result.pricing);
  assert.equal(result.product.publicationStatus, 'blocked_connection');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Approved', result.archive.fileName + '.json'), 'utf8'));
  assert.equal(manifest.decision.pricing.amount, '24.00');
  assert.equal(manifest.decision.approval.pricingSuggestion.amount, '24.00');
  assert.equal(manifest.decision.product.price, '69.00');
  review.pricingNow = '2027-01-01T00:00:00.000Z';
  assert.equal((await review.inspect('one')).pricing.amount, '24.00');
  assert.equal(review.list()[0].pricing.amount, '24.00');
  const restored = new ProductionReview({ ...options, pricingNow: review.pricingNow }).list()[0];
  assert.equal(restored.product.price, '69.00');
  assert.equal(restored.pricing.amount, '24.00');
  assert.equal(restored.approval.pricingSuggestion.amount, '24.00');
});

test('rejected records preserve prior pricing and do not create an approval or a product', async t => {
  const { review, options } = fixture(t);
  const first = await review.inspect('one');
  review.records.one.pricing = { ...legacyPricing };
  review.pricingSamples = [];
  const rejected = await review.decide('one', { decision: 'rejected', hash: first.hash });
  assert.deepEqual(rejected.pricing, legacyPricing);
  assert.equal(rejected.product, null);
  assert.equal(rejected.approval, null);
  assert.equal(rejected.workflow.stage, 'rejected_archive');
  assert.deepEqual(review.list()[0].pricing, legacyPricing);
  assert.deepEqual((await review.inspect('one')).pricing, legacyPricing);
  assert.deepEqual(new ProductionReview(options).list()[0].pricing, legacyPricing);
});

test('unavailable market advice still allows an explicit human selling price', async t => {
  const { review } = fixture(t);
  review.pricingSamples = [];
  const first = await review.inspect('one');
  assert.equal(first.pricing.status, 'unavailable');
  assert.equal(first.pricing.amount, null);
  const decided = await review.decide('one', approval(first.hash));
  assert.equal(decided.pricing.amount, null);
  assert.equal(decided.product.price, '69.00');
  assert.equal(decided.approval.price, '69.00');
});

test('pending suggestions expire as time advances while list remains a read-only operation', async t => {
  const { review, options } = fixture(t);
  let now = NOW; review.pricingNow = () => now;
  await review.inspect('one');
  const stored = fs.readFileSync(options.file, 'utf8');
  now = '2026-12-12T12:00:00.000Z';
  const current = review.list()[0];
  assert.equal(current.pricing.status, 'unavailable');
  assert.equal(current.pricing.market.stale, true);
  assert.equal(current.pricing.amount, null);
  assert.equal(fs.readFileSync(options.file, 'utf8'), stored);
});
