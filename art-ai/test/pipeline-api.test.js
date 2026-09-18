import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import sharp from 'sharp';
import { createApplication } from '../src/server.js';

const FIRST_ID = 'pipeline-fixture:0';
const SECOND_ID = 'pipeline-fixture:1';
const STAGE_IDS = ['brief', 'directions', 'generation-approval', 'provider', 'creation-queue', 'generation', 'originals', 'resolution', 'visual-review', 'pricing', 'product-approval', 'backups', 'product-fields', 'shopify', 'digital-delivery', 'publishing', 'monitoring'];
const SECRET_VALUES = ['pipeline-private-bfl-key', 'pipeline-private-admin-token', 'pipeline-private-shopify-secret', 'pipeline-private-model-alias', 'pipeline-private-response-value'];

async function setup(t, adminToken = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmas-pipeline-api-'));
  const assetRoot = path.join(root, 'assets'), selectedArtPath = path.join(root, 'selected.json'), productionReviewPath = path.join(root, 'reviews.json');
  fs.mkdirSync(assetRoot);
  const original = await sharp({ create: { width: 192, height: 256, channels: 3, background: '#567884' } }).png().toBuffer();
  fs.writeFileSync(path.join(assetRoot, 'first.png'), original);
  fs.writeFileSync(path.join(assetRoot, 'second.png'), original);
  fs.writeFileSync(selectedArtPath, JSON.stringify({ collection: 'Temporary fixture', selections: [{ promptId: 'pipeline-fixture', title: 'Pipeline artwork', artworks: [
    { label: 'First', assetUrl: '/assets/first.png' }, { label: 'Second', assetUrl: '/assets/second.png' },
  ] }] }));
  const transport = globalThis.fetch.bind(globalThis);
  const remoteFetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected outbound request from a pipeline API test'); });
  const paidCalls = [], connectionCalls = [], jobs = [{ id: 'paused-fixture', status: 'paused' }, { id: 'uncertain-fixture', status: 'submission_uncertain' }];
  const flux = {
    key: SECRET_VALUES[0], list: () => jobs, async tick() {},
    create(input) { paidCalls.push(input); throw new Error('Unexpected paid generation'); },
    createBatch(input) { paidCalls.push(input); throw new Error('Unexpected paid generation'); },
    async connection() { connectionCalls.push('connection'); return { configured: true, verified: true, credits: 24, extra: SECRET_VALUES[4] }; },
  };
  const { server, productionReview } = createApplication({
    config: { creationExecutor: 'midjourney', adminToken, openaiApiKey: '', creativeModel: 'mock-only', shopifySecret: SECRET_VALUES[2] },
    journal: { records: new Map() }, queue: { pending: [] }, catalog: new Map(),
    creativeAgent: { create() { throw new Error('Pipeline monitoring must not prepare a new brief'); } },
    creativeOrchestrator: { graph: {}, model: {}, modelName: SECRET_VALUES[3], async run() { throw new Error('Pipeline monitoring must not invoke a model'); } }, flux,
    pictureRoot: path.join(root, 'pictures'), pictureDraftPath: path.join(root, 'picture-drafts.json'),
    batchDraftPath: path.join(root, 'batch.json'), productionReviewPath,
    fluxPath: path.join(root, 'flux.json'), upscalePath: path.join(root, 'upscale.json'),
    productionReviewAssetRoot: assetRoot, productionReviewFileRoot: path.join(root, 'private-originals'),
    selectedArtPath, portraitCollectionPath: path.join(root, 'portraits.json'),
    approvalPath: path.join(root, 'approvals.json'), autonomousPromptPath: path.join(root, 'auto.json'),
    autonomousControlPath: path.join(root, 'control.json'),
  });
  const realInspect = productionReview.inspect.bind(productionReview);
  const inspections = t.mock.method(productionReview, 'inspect', id => realInspect(id));
  t.after(async () => {
    server.closeIdleConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(remoteFetch.mock.calls.length, 0, 'These API operations must not make outbound image or model requests');
    assert.equal(paidCalls.length, 0, 'Pipeline checks must never submit paid generation');
    assert.deepEqual(jobs, [{ id: 'paused-fixture', status: 'paused' }, { id: 'uncertain-fixture', status: 'submission_uncertain' }], 'Checks must not resume or change paused jobs');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, options = {}) => transport(base + route, { ...options, signal: AbortSignal.timeout(10000) });
  const post = (route, input, headers = {}) => request(route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(input) });
  const check = (input, headers = {}) => post('/api/pipeline/check', input, headers);
  return { root, base, productionReviewPath, productionReview, inspections, request, post, check, flux, connectionCalls };
}

test('pipeline status and local checks return 17 stages without network work, secrets or saved-state changes', async t => {
  const app = await setup(t);
  const status = await app.request('/api/pipeline/status');
  assert.equal(status.status, 200);
  assert.equal(status.headers.get('cache-control'), 'no-store');
  assert.equal(status.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(status.headers.get('content-type'), 'application/json');
  const snapshot = await status.json();
  assert.deepEqual(snapshot.stages.map(stage => stage.id), STAGE_IDS);
  assert.ok(Number.isFinite(Date.parse(snapshot.checkedAt)));
  assert.ok(snapshot.artworks.some(artwork => artwork.id === FIRST_ID && !artwork.hasQuality && artwork.hasLocalOriginal));
  assert.ok(snapshot.artworks.some(artwork => artwork.id === SECOND_ID && !artwork.hasQuality));
  assert.equal(snapshot.systems.find(system => system.id === 'flux').verified, false);
  assert.equal(snapshot.systems.find(system => system.id === 'shopify').status, 'not-connected');
  assert.equal(snapshot.stages.find(stage => stage.id === 'creation-queue').status, 'blocked');
  for (const stageId of ['brief', 'generation', 'backups', 'shopify', 'monitoring']) {
    const response = await app.check({ stageId });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.stage.id, stageId);
    assert.deepEqual(result.snapshot.stages.map(stage => stage.id), STAGE_IDS);
    assert.ok(result.checkedAt && result.message);
    for (const secret of SECRET_VALUES) assert.equal(JSON.stringify(result).includes(secret), false);
  }
  assert.equal(app.connectionCalls.length, 0);
  assert.equal(app.inspections.mock.calls.length, 0);
  assert.equal(fs.existsSync(app.productionReviewPath), false);
  for (const secret of SECRET_VALUES) assert.equal(JSON.stringify(snapshot).includes(secret), false);
});

test('explicit provider checks verify only the mocked read-only connection and sanitize failures', async t => {
  const app = await setup(t);
  await app.request('/api/pipeline/status');
  assert.equal(app.connectionCalls.length, 0);
  const response = await app.check({ stageId: 'provider' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(app.connectionCalls.length, 1);
  assert.equal(result.stage.id, 'provider');
  assert.equal(result.stage.status, 'ready');
  assert.equal(result.snapshot.systems.find(system => system.id === 'flux').verified, true);
  assert.match(result.message, /Available credits: 24/);
  assert.equal(JSON.stringify(result).includes(SECRET_VALUES[4]), false);
  const fresh = await (await app.request('/api/pipeline/status')).json();
  assert.equal(fresh.systems.find(system => system.id === 'flux').verified, true);
  assert.equal(app.connectionCalls.length, 1, 'status refreshes do not repeat the provider call');
  app.flux.connection = async () => { app.connectionCalls.push('connection'); throw new Error(SECRET_VALUES[4]); };
  const failed = await app.check({ stageId: 'provider' });
  assert.equal(failed.status, 200);
  const body = await failed.json();
  assert.equal(body.stage.status, 'blocked');
  assert.equal(body.snapshot.systems.find(system => system.id === 'flux').verified, false);
  assert.equal(body.message, 'Provider verification failed; check connection in FLUX controls.');
  assert.equal(JSON.stringify(body).includes(SECRET_VALUES[4]), false);
  assert.equal(app.connectionCalls.length, 2);
  assert.equal(app.inspections.mock.calls.length, 0);
  assert.equal(fs.existsSync(app.productionReviewPath), false);
});

test('artwork checks inspect exactly the selected original and preserve a saved manual price', async t => {
  const app = await setup(t);
  const response = await app.check({ stageId: 'resolution', artworkId: FIRST_ID });
  assert.equal(response.status, 200);
  const checked = await response.json();
  assert.equal(checked.stage.id, 'resolution');
  const first = checked.snapshot.artworks.find(artwork => artwork.id === FIRST_ID);
  assert.equal(first.width, 192); assert.equal(first.height, 256); assert.equal(first.hasQuality, true);
  assert.equal(checked.snapshot.artworks.find(artwork => artwork.id === SECOND_ID).hasQuality, false);
  assert.deepEqual(app.inspections.mock.calls.map(call => call.arguments[0]), [FIRST_ID]);
  assert.equal(app.productionReview.records[SECOND_ID], undefined);
  const hash = app.productionReview.records[FIRST_ID].hash;
  const decision = await app.post('/api/production-review/' + encodeURIComponent(FIRST_ID) + '/decide', { decision: 'approved', hash, price: 69, visualScore: 8, visualConfirmed: true });
  assert.equal(decision.status, 200);
  const approvalBefore = structuredClone(app.productionReview.records[FIRST_ID].approval);
  const rechecked = await app.check({ stageId: 'pricing', artworkId: FIRST_ID });
  assert.equal(rechecked.status, 200);
  const result = await rechecked.json();
  assert.equal(result.snapshot.artworks.find(artwork => artwork.id === FIRST_ID).price, '69.00');
  assert.deepEqual(app.productionReview.records[FIRST_ID].approval, approvalBefore);
  assert.equal(JSON.parse(fs.readFileSync(app.productionReviewPath, 'utf8'))[FIRST_ID].product.price, '69.00');
  assert.deepEqual(app.inspections.mock.calls.map(call => call.arguments[0]), [FIRST_ID, FIRST_ID]);
  assert.equal(app.connectionCalls.length, 0);
});

test('invalid stages and artwork gates reject before inspecting files or checking connections', async t => {
  const app = await setup(t);
  for (const input of [{}, { stageId: 'unknown' }, { stageId: '../provider' }, { stageId: 'generation', artworkId: FIRST_ID }, { stageId: 'provider', artworkId: FIRST_ID }, { stageId: 'resolution', artworkId: '' }, { stageId: 'pricing', artworkId: null }]) {
    const response = await app.check(input);
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal((await app.check({ stageId: 'originals', artworkId: 'missing-artwork' })).status, 409);
  const invalidJson = await app.request('/api/pipeline/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not JSON}' });
  assert.equal(invalidJson.status, 400);
  assert.equal((await app.check([])).status, 400);
  assert.equal(app.connectionCalls.length, 0);
  assert.equal(app.inspections.mock.calls.length, 0);
  assert.equal(fs.existsSync(app.productionReviewPath), false);
});

test('pipeline routes enforce local host, JSON and same-origin checks before any provider verification', async t => {
  const app = await setup(t);
  // The fetch client replaces Host, so use a local HTTP request for this gate.
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const request = http.request(app.base + '/api/pipeline/status', { headers: { host: 'untrusted.example' } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject); request.end();
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await app.check({ stageId: 'provider' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await app.check({ stageId: 'provider' }, { origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await app.check({ stageId: 'provider' }, { 'content-type': 'text/plain' })).status, 415);
  assert.equal(app.connectionCalls.length, 0);
  assert.equal(app.inspections.mock.calls.length, 0);
  const accepted = await app.check({ stageId: 'monitoring' }, { origin: app.base, 'sec-fetch-site': 'same-origin' });
  assert.equal(accepted.status, 200);
});

test('configured admin authentication protects both pipeline routes and still enforces POST origins', async t => {
  const app = await setup(t, SECRET_VALUES[1]);
  const authorization = { authorization: 'Bearer ' + SECRET_VALUES[1] };
  assert.equal((await app.request('/api/pipeline/status')).status, 401);
  assert.equal((await app.check({ stageId: 'provider' })).status, 401);
  assert.equal((await app.request('/api/pipeline/status', { headers: { authorization: 'Bearer incorrect' } })).status, 401);
  assert.equal((await app.check({ stageId: 'provider' }, { ...authorization, origin: 'https://untrusted.example' })).status, 403);
  assert.equal(app.connectionCalls.length, 0);
  const status = await app.request('/api/pipeline/status', { headers: authorization });
  assert.equal(status.status, 200);
  const snapshot = await status.json();
  for (const secret of SECRET_VALUES) assert.equal(JSON.stringify(snapshot).includes(secret), false);
  const verified = await app.check({ stageId: 'provider' }, { ...authorization, origin: app.base });
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).snapshot.systems.find(system => system.id === 'flux').verified, true);
  assert.equal(app.connectionCalls.length, 1);
});
