import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { ProductionReview } from '../src/production-review.js';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const image = (format = 'png', width = 120, height = 160) => sharp({ create: { width, height, channels: 3, background: '#128a96' } })[format]().toBuffer();
const approval = digest => ({ decision: 'approved', hash: digest, price: 69, visualScore: 8, visualConfirmed: true });

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmas-review-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = { id: 'midjourney:original/one', title: 'Recovered artwork', assetUrl: 'https://cdn.midjourney.com/99999999-9999-4999-8999-999999999999/0_0.png' };
  let calls = 0;
  const options = { file: path.join(root, 'reviews.json'), sources: () => [source],
    fetchImage: async () => { calls++; return { ok: false }; }, pricingSamples: [] };
  return { root, source, options, review: new ProductionReview(options), fetchCalls: () => calls };
}

test('a recovered original is stored byte for byte and supplies pixels, pricing and the private preview', async t => {
  const { review, source, options, root, fetchCalls } = fixture(t);
  await assert.rejects(review.inspect(source.id), /download failed/);
  assert.equal(fetchCalls(), 1);
  const original = await image();
  const record = await review.attachFile(source.id, original, { name: 'original.png', contentType: 'application/octet-stream' });
  assert.equal(record.status, 'awaiting_human_review');
  assert.equal(record.hash, hash(original));
  assert.equal(record.sourceUrl, source.assetUrl);
  assert.equal(record.localFile.sourceUrl, source.assetUrl);
  assert.equal(record.localFile.width, 120);
  assert.equal(record.localFile.height, 160);
  assert.equal(record.quality.width, 120);
  assert.equal(record.quality.height, 160);
  assert.equal(record.pricing.method, 'resolution-market-v1');
  assert.equal(record.fileChanged, false);
  assert.match(record.localFile.fileName, /^[a-f0-9]{16}-[a-f0-9]{64}\.png$/);
  assert.deepEqual(fs.readFileSync(path.join(root, 'review-files', record.localFile.fileName)), original);
  const listed = review.list()[0];
  assert.equal(listed.assetUrl, source.assetUrl);
  assert.equal(listed.reviewImageUrl, '/api/production-review/' + encodeURIComponent(source.id) + '/file');
  assert.equal(JSON.stringify(listed).includes(root), false);
  assert.deepEqual(review.fileImage(source.id), { bytes: original, contentType: 'image/png' });
  assert.deepEqual(await review.bytes(source), original);
  assert.equal(fetchCalls(), 1, 'a bound original never retries the failed remote download');
  assert.deepEqual(new ProductionReview(options).fileImage(source.id).bytes, original);
});

test('inspection, a manual 69 price and approval backups remain bound to the exact uploaded bytes', async t => {
  const { review, source, options, root, fetchCalls } = fixture(t);
  const original = await image('jpeg');
  const attached = await review.attachFile(source.id, original, { name: 'download.png', contentType: 'image/png' });
  assert.match(attached.localFile.fileName, /\.jpg$/);
  assert.equal(review.fileImage(source.id).contentType, 'image/jpeg');
  const checked = await review.inspect(source.id);
  assert.deepEqual(checked.localFile, attached.localFile);
  assert.equal(checked.fileChanged, false);
  const approved = await review.decide(source.id, approval(checked.hash));
  assert.equal(approved.product.price, '69.00');
  assert.equal(approved.approval.hash, hash(original));
  assert.deepEqual(fs.readFileSync(path.join(root, 'Approved', approved.archive.fileName)), original);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Approved', approved.archive.fileName + '.json')));
  assert.deepEqual(manifest.decision.localFile, attached.localFile);
  assert.equal(manifest.sourceUrl, source.assetUrl);
  const rechecked = await new ProductionReview(options).inspect(source.id);
  assert.equal(rechecked.product.price, '69.00');
  assert.deepEqual(rechecked.localFile, attached.localFile);
  assert.equal((await review.archiveDecisions()).alreadyBackedUp, 1);
  assert.equal(fetchCalls(), 0);
});

test('approved and rejected records refuse imports and preserve saved decisions, prices and files', async t => {
  for (const decision of ['approved', 'rejected']) {
    const { review, source, options, root } = fixture(t);
    const first = await review.attachFile(source.id, await image(), { name: 'original.png' });
    await review.decide(source.id, decision === 'approved' ? approval(first.hash) : { decision, hash: first.hash });
    delete review.records[source.id].localFile; // Existing decisions can predate original-file recovery.
    review.save();
    const recordBefore = structuredClone(review.records[source.id]);
    const savedBefore = fs.readFileSync(options.file, 'utf8');
    const filesBefore = fs.readdirSync(path.join(root, 'review-files'));
    await assert.rejects(review.attachFile(source.id, await image('jpeg'), { name: 'replacement.jpg' }), error => error.statusCode === 409 && /pending/.test(error.message));
    assert.deepEqual(review.records[source.id], recordBefore);
    assert.equal(fs.readFileSync(options.file, 'utf8'), savedBefore);
    assert.deepEqual(fs.readdirSync(path.join(root, 'review-files')), filesBefore);
    source.assetUrl = 'https://cdn.midjourney.com/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/0_0.png';
    await assert.rejects(review.attachFile(source.id, await image(), { name: 'original.png' }), error => error.statusCode === 409);
    assert.deepEqual(review.records[source.id], recordBefore);
  }
});

test('same pending bytes preserve review state; a changed pending original receives fresh measurements', async t => {
  const { review, source } = fixture(t);
  const original = await image();
  const first = await review.attachFile(source.id, original, { name: 'original.png' });
  review.records[source.id].visualReview.note = 'Keep this human note';
  const same = await review.attachFile(source.id, original, { name: 'renamed.png' });
  assert.equal(same.fileChanged, false);
  assert.equal(same.hash, first.hash);
  assert.equal(same.visualReview.note, 'Keep this human note');
  const changed = await review.attachFile(source.id, await image('png', 240, 320), { name: 'larger.png' });
  assert.equal(changed.fileChanged, true);
  assert.notEqual(changed.hash, first.hash);
  assert.equal(changed.quality.width, 240);
  assert.equal(changed.localFile.hash, changed.hash);
  assert.notEqual(changed.visualReview.note, same.visualReview.note);
});

test('invalid or damaged uploads leave the existing pending review and original unchanged', async t => {
  const { review, source, options, root } = fixture(t);
  const first = await review.attachFile(source.id, await image(), { name: 'original.png' });
  const snapshot = structuredClone(first), saved = fs.readFileSync(options.file, 'utf8');
  const original = await image();
  const invalidUploads = [
    [Buffer.alloc(0), 'empty.png'],
    [Buffer.from('not an image'), 'fake.png'],
    [original.subarray(0, 30), 'broken.png'],
    [original.subarray(0, original.length - 20), 'broken-pixels.png'],
    [await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } }).webp().toBuffer(), 'disguised.png'],
    [original, '../private.png'],
    [original, '..\\private.png'],
    [original, 'C:\\private.png'],
    [original, '\u0000'],
  ];
  for (const [bytes, name] of invalidUploads) {
    await assert.rejects(review.attachFile(source.id, bytes, { name }), error => error.statusCode === 400);
    assert.deepEqual(review.records[source.id], snapshot);
    assert.equal(fs.readFileSync(options.file, 'utf8'), saved);
  }
  assert.deepEqual(fs.readdirSync(path.join(root, 'review-files')), [first.localFile.fileName]);
  const renamed = await review.attachFile(source.id, original, { name: 'a'.repeat(240) + '.png' });
  assert.equal(renamed.localFile.name.length, 200);
});

test('upload limits reject more than 40 MiB or 64 megapixels before a review is created', async t => {
  const { review, source, options, root } = fixture(t);
  await assert.rejects(review.attachFile(source.id, Buffer.alloc(40 * 1024 * 1024 + 1), { name: 'huge.png' }), error => error.statusCode === 413 && /40 MiB/.test(error.message));
  const tooManyPixels = await image('png', 8001, 8000);
  await assert.rejects(review.attachFile(source.id, tooManyPixels, { name: 'huge.png' }), error => error.statusCode === 413 && /64 megapixel/.test(error.message));
  assert.equal(review.records[source.id], undefined);
  assert.equal(fs.existsSync(options.file), false);
  assert.equal(fs.existsSync(path.join(root, 'review-files')), false);
});

test('damaged private files and altered bindings fail closed without remote fallback or decision changes', async t => {
  const { review, source, options, root, fetchCalls } = fixture(t);
  const original = await image();
  const attached = await review.attachFile(source.id, original, { name: 'original.png' });
  const stored = fs.readFileSync(options.file, 'utf8');
  const damaged = Buffer.from(original); damaged[damaged.length - 1] ^= 1;
  fs.writeFileSync(path.join(root, 'review-files', attached.localFile.fileName), damaged);
  assert.throws(() => review.fileImage(source.id), /integrity/);
  await assert.rejects(review.inspect(source.id), /integrity/);
  await assert.rejects(review.decide(source.id, approval(attached.hash)), /integrity/);
  await assert.rejects(review.attachFile(source.id, original, { name: 'again.png' }), /integrity/);
  assert.equal(fs.readFileSync(options.file, 'utf8'), stored);
  assert.equal(fetchCalls(), 0);
  review.records[source.id].localFile.fileName = '../private.png';
  assert.equal(review.list()[0].reviewImageUrl, undefined);
  assert.throws(() => review.fileImage(source.id), /bound/);
  await assert.rejects(review.bytes(source), /integrity/);
  assert.equal(fetchCalls(), 0);
});

test('changing the source URL disables the former uploaded override and preview', async t => {
  const { review, source, fetchCalls } = fixture(t);
  await review.attachFile(source.id, await image(), { name: 'original.png' });
  source.assetUrl = 'https://cdn.midjourney.com/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/0_0.png';
  assert.equal(review.list()[0].reviewImageUrl, undefined);
  assert.equal(review.list()[0].status, 'awaiting_quality_check');
  assert.throws(() => review.fileImage(source.id), /bound/);
  await assert.rejects(review.bytes(source), /download failed/);
  assert.equal(fetchCalls(), 1);
});

test('private file reads reject a symlink escaping the private root', async t => {
  const { review, source, root } = fixture(t);
  const original = await image();
  const attached = await review.attachFile(source.id, original, { name: 'original.png' });
  const outside = path.join(root, 'outside.png'), file = path.join(root, 'review-files', attached.localFile.fileName);
  fs.writeFileSync(outside, original);
  fs.unlinkSync(file);
  try { fs.symlinkSync(outside, file); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Symlink creation is not permitted on this Windows account'); return; } throw error; }
  assert.throws(() => review.fileImage(source.id), /path/);
  await assert.rejects(review.bytes(source), /path/);
});
