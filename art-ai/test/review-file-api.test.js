import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { once } from 'node:events';
import sharp from 'sharp';
import { createApplication } from '../src/server.js';
import { suggestArtworkPrice } from '../src/artwork-pricing.js';

const ARTWORK_ID = 'fixture:0';
const SOURCE_URL = 'https://cdn.midjourney.com/7b49d314-c40f-4c7b-aedc-a4b671541be5/0_0.png';
const FILE_ROUTE = '/api/production-review/' + encodeURIComponent(ARTWORK_ID) + '/file';

async function setup(t, adminToken = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmas-review-file-api-'));
  const selectedArtPath = path.join(root, 'selected.json');
  const productionReviewPath = path.join(root, 'reviews.json');
  const productionReviewFileRoot = path.join(root, 'private-originals');
  fs.writeFileSync(selectedArtPath, JSON.stringify({
    collection: 'Fixture',
    selections: [{ promptId: 'fixture', title: 'Original', artworks: [{ label: 'Original', assetUrl: SOURCE_URL }] }],
  }));

  const transport = globalThis.fetch.bind(globalThis);
  const remoteFetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected outbound image request: this fixture must use its imported original.');
  });
  const paidCalls = [];
  const flux = {
    key: '', list: () => [], async tick() {},
    create(input) { paidCalls.push(input); throw new Error('Unexpected paid generation'); },
    createBatch(input) { paidCalls.push(input); throw new Error('Unexpected paid generation'); },
  };
  const { server } = createApplication({
    config: { creationExecutor: 'midjourney', adminToken, openaiApiKey: '', creativeModel: 'test-only' },
    journal: { records: new Map() }, queue: { pending: [] }, catalog: new Map(),
    creativeAgent: {}, creativeOrchestrator: {}, flux,
    pictureRoot: path.join(root, 'pictures'), pictureDraftPath: path.join(root, 'picture-drafts.json'),
    batchDraftPath: path.join(root, 'batch.json'), productionReviewPath,
    fluxPath: path.join(root, 'flux.json'), upscalePath: path.join(root, 'upscale.json'),
    productionReviewAssetRoot: path.join(root, 'assets'), productionReviewFileRoot,
    selectedArtPath, portraitCollectionPath: path.join(root, 'portraits.json'),
    approvalPath: path.join(root, 'approvals.json'), autonomousPromptPath: path.join(root, 'auto.json'),
    autonomousControlPath: path.join(root, 'control.json'),
  });
  t.after(async () => {
    server.closeIdleConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(remoteFetch.mock.calls.length, 0, 'Import and review must not download the remote source');
    assert.equal(paidCalls.length, 0, 'Import and review must not request paid generation');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, options = {}) => transport(base + route, { ...options, signal: AbortSignal.timeout(10000) });
  const png = await sharp({ create: { width: 192, height: 256, channels: 3, background: '#537381' } }).png().toBuffer();
  const upload = (bytes = png, headers = {}) => request(FILE_ROUTE, {
    method: 'POST', headers: { 'content-type': 'image/png', 'x-file-name': encodeURIComponent('Original étude.png'), ...headers }, body: bytes,
  });
  const post = (route, input, headers = {}) => request(route, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(input),
  });
  const listed = async (headers = {}) => {
    const response = await request('/api/production-review', { headers });
    assert.equal(response.status, 200);
    const { artworks } = await response.json();
    return artworks.find(artwork => artwork.id === ARTWORK_ID);
  };
  return { root, productionReviewPath, productionReviewFileRoot, png, request, upload, post, listed };
}

test('raw original upload checks pixels and price, serves exact bytes, and protects an explicit approval', async t => {
  const app = await setup(t);
  const before = await app.listed();
  assert.equal(before.status, 'awaiting_quality_check');
  assert.equal(before.reviewImageUrl, undefined);

  const response = await app.upload();
  assert.equal(response.status, 201);
  const record = await response.json();
  const hash = crypto.createHash('sha256').update(app.png).digest('hex');
  assert.equal(record.hash, hash);
  assert.equal(record.sourceUrl, SOURCE_URL);
  assert.equal(record.localFile.name, 'Original étude.png');
  assert.equal(record.localFile.bytes, app.png.length);
  assert.equal(record.localFile.hash, hash);
  assert.equal(record.status, 'awaiting_human_review');
  assert.equal(record.visualReview.status, 'pending');
  assert.equal(record.quality.width, 192);
  assert.equal(record.quality.height, 256);
  assert.deepEqual(record.pricing, suggestArtworkPrice({ width: 192, height: 256 }));
  assert.equal(record.pricing.requiresHumanApproval, true);
  assert.equal(record.approval, undefined);
  assert.equal(record.product, undefined);
  assert.equal(record.archive, undefined);
  assert.deepEqual(fs.readFileSync(path.join(app.productionReviewFileRoot, record.localFile.fileName)), app.png);

  const artwork = await app.listed();
  assert.equal(artwork.assetUrl, SOURCE_URL);
  assert.equal(artwork.reviewImageUrl, FILE_ROUTE);
  assert.equal(artwork.title, 'Original');
  assert.deepEqual(artwork.quality, record.quality);
  const image = await app.request(artwork.reviewImageUrl);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('cache-control'), 'no-store');
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), app.png);

  const decision = await app.post('/api/production-review/' + encodeURIComponent(ARTWORK_ID) + '/decide', {
    decision: 'approved', hash, price: 69, visualScore: 8, visualConfirmed: true,
  });
  assert.equal(decision.status, 200);
  const approved = await decision.json();
  assert.equal(approved.approval.price, '69.00');
  assert.equal(approved.product.price, '69.00');
  assert.equal(approved.product.publicationStatus, 'blocked_connection');
  assert.equal(approved.archive.hash, hash);
  const saved = fs.readFileSync(app.productionReviewPath, 'utf8');

  const replacement = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#b5846c' } }).png().toBuffer();
  assert.equal((await app.upload(replacement)).status, 409);
  assert.equal(fs.readFileSync(app.productionReviewPath, 'utf8'), saved);
  const unchanged = await app.listed();
  assert.equal(unchanged.hash, hash);
  assert.equal(unchanged.approval.price, '69.00');
  assert.equal(unchanged.product.price, '69.00');
  assert.deepEqual(Buffer.from(await (await app.request(FILE_ROUTE)).arrayBuffer()), app.png);
});

test('JPEG originals are returned without resizing or recompression', async t => {
  const app = await setup(t);
  const jpeg = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#84705e' } }).jpeg().toBuffer();
  const response = await app.upload(jpeg, { 'content-type': 'image/jpeg', 'x-file-name': encodeURIComponent('Original.jpg') });
  assert.equal(response.status, 201);
  const record = await response.json();
  assert.equal(record.quality.width, 320);
  assert.equal(record.quality.height, 240);
  assert.equal(record.localFile.name, 'Original.jpg');
  const image = await app.request(FILE_ROUTE);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), jpeg);
});

test('original upload enforces origin, MIME type, file validity and the 40 MiB limit', async t => {
  const app = await setup(t);
  assert.equal((await app.upload(app.png, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await app.upload(app.png, { origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await app.upload(app.png, { 'content-type': 'image/svg+xml' })).status, 415);
  assert.equal((await app.upload(app.png, { 'content-type': 'application/json' })).status, 415);
  assert.equal((await app.upload(Buffer.from('not a PNG'))).status, 400);
  assert.equal((await app.upload(app.png.subarray(0, 24))).status, 400);
  assert.equal((await app.upload(Buffer.alloc(0))).status, 400);
  assert.equal((await app.upload(Buffer.alloc(40 * 1024 * 1024 + 1))).status, 413);
  const artwork = await app.listed();
  assert.equal(artwork.status, 'awaiting_quality_check');
  assert.equal(artwork.reviewImageUrl, undefined);
  assert.equal(artwork.localFile, undefined);
  assert.equal(fs.existsSync(app.productionReviewPath), false);
  assert.equal(fs.existsSync(app.productionReviewFileRoot), false);
});

test('private originals require configured admin authentication for upload and image access', async t => {
  const app = await setup(t, 'mock-admin');
  const authorization = { authorization: 'Bearer mock-admin' };
  assert.equal((await app.upload()).status, 401);
  assert.equal((await app.request(FILE_ROUTE)).status, 401);
  assert.equal((await app.upload(app.png, authorization)).status, 201);
  const artwork = await app.listed(authorization);
  assert.equal(artwork.reviewImageUrl, FILE_ROUTE);
  assert.equal((await app.request(artwork.reviewImageUrl)).status, 401);
  assert.equal((await app.request(artwork.reviewImageUrl, { headers: { authorization: 'Bearer incorrect' } })).status, 401);
  const image = await app.request(artwork.reviewImageUrl, { headers: authorization });
  assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), app.png);
});
