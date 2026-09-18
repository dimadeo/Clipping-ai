import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PipelineMonitor } from '../src/pipeline-monitor.js';
import { ProductionReview } from '../src/production-review.js';
import { FluxStudio } from '../src/flux.js';

const NOW = '2026-09-12T12:00:00.000Z';
const IDS = ['brief', 'directions', 'generation-approval', 'provider', 'creation-queue', 'generation', 'originals', 'resolution', 'visual-review', 'pricing', 'product-approval', 'backups', 'product-fields', 'shopify', 'digital-delivery', 'publishing', 'monitoring'];
const mustNotRun = () => { throw new Error('A read-only monitor invoked work or a network call'); };
const dimensionBytes = () => {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(1200, 16); bytes.writeUInt32BE(1600, 20);
  return bytes;
};

function packageFixture(root, name, version = '1.2.3', nested = false) {
  const directory = nested ? path.join(root, 'node_modules', '@langchain', 'core', 'node_modules', name) : path.join(root, 'node_modules', ...name.split('/'));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }));
  fs.writeFileSync(path.join(directory, 'index.js'), 'throw new Error("Package code must not execute during monitoring");');
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmas-pipeline-monitor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['langchain', '@langchain/core', '@langchain/langgraph', '@langchain/openai']) packageFixture(root, name);
  packageFixture(root, 'langsmith', '0.9.8', true);
  const assetRoot = path.join(root, 'assets'), archiveRoot = path.join(root, 'archives');
  fs.mkdirSync(assetRoot);
  fs.writeFileSync(path.join(assetRoot, 'first.png'), dimensionBytes());
  const digest = 'a'.repeat(64), archiveName = 'b'.repeat(16) + '-' + digest + '.png';
  fs.mkdirSync(path.join(archiveRoot, 'Approved'), { recursive: true });
  fs.writeFileSync(path.join(archiveRoot, 'Approved', archiveName), 'presence only; this monitor does not hash backups');
  const artworks = [
    { id: 'remote', title: 'Missing original', status: 'awaiting_quality_check', assetUrl: 'https://cdn.midjourney.com/old.png' },
    { id: 'pending', title: 'Ready for review', status: 'awaiting_human_review', assetUrl: '/assets/first.png', quality: { width: 1200, height: 1600 }, pricing: { amount: '18.00' } },
    { id: 'approved', title: 'Saved price', status: 'approved_product_prepared', assetUrl: '/assets/first.png', quality: { width: 1200, height: 1600 }, pricing: { amount: '12.00' }, hash: digest,
      product: { title: 'Saved price', sku: 'TDM-1', currency: 'USD', price: '69.00' }, approval: { price: '69.00' }, archive: { bucket: 'Approved', hash: digest, fileName: archiveName } },
    { id: 'rejected', title: 'Rejected art', status: 'rejected', assetUrl: '/assets/first.png', quality: { width: 1200, height: 1600 } },
  ];
  const jobs = [
    { id: 'queued1', status: 'queued', approvalId: 'selected:batch' }, { id: 'queued2', status: 'queued' },
    { id: 'active', status: 'polling' }, { id: 'bad', status: 'failed' },
    { id: 'paused', status: 'paused' }, { id: 'unknown', status: 'submission_uncertain' },
  ];
  const inspected = [];
  const productionReview = { list: () => artworks, assetRoot, archiveRoot, inspect: async id => { inspected.push(id); }, save: mustNotRun, decide: mustNotRun, archiveDecisions: mustNotRun };
  const flux = { key: 'bfl-secret-value', list: () => jobs, tick: mustNotRun, create: mustNotRun, createBatch: mustNotRun, connection: mustNotRun, fetcher: mustNotRun };
  const drafts = new Map([
    ['selected', { result: { promptId: 'selected' }, expiresAt: Date.parse(NOW) + 1000 }],
    ['waiting', { result: { promptId: 'waiting' }, expiresAt: Date.parse(NOW) + 1000 }],
    ['expired', { result: { promptId: 'expired' }, expiresAt: Date.parse(NOW) - 1000 }],
  ]);
  const env = { LANGSMITH_API_KEY: 'langsmith-secret-value', LANGSMITH_TRACING: 'true', LANGSMITH_PROJECT: 'private-project-name', OPENAI_API_KEY: 'openai-secret-value', BFL_API_KEY: 'bfl-secret-value', SHOPIFY_CLIENT_ID: 'private-client-id', SHOPIFY_ADMIN_ACCESS_TOKEN: 'private-shopify-token' };
  const options = { productionReview, flux, drafts, creativeAgent: { create: mustNotRun }, creativeOrchestrator: { graph: { invoke: mustNotRun }, model: { invoke: mustNotRun }, modelName: 'private-model-alias' },
    root, env, settings: { creationExecutor: 'midjourney', shopifySecret: 'private-signing-secret' }, now: () => new Date(NOW) };
  return { root, options, artworks, jobs, drafts, env, inspected, monitor: new PipelineMonitor(options) };
}

test('the monitor reports all 17 ordered stages and observed local counts', t => {
  const { monitor } = fixture(t);
  const snapshot = monitor.snapshot();
  assert.equal(snapshot.checkedAt, NOW);
  assert.deepEqual(snapshot.stages.map(stage => stage.id), IDS);
  assert.deepEqual(snapshot.stages.map(stage => stage.number), Array.from({ length: 17 }, (_, index) => index + 1));
  assert.deepEqual(snapshot.summary, { total: 4, pending: 2, approved: 1, rejected: 1, queued: 2, running: 1, failed: 1 });
  const stage = id => snapshot.stages.find(item => item.id === id);
  assert.equal(stage('generation-approval').count, 1);
  assert.equal(stage('originals').count, 3);
  assert.equal(stage('resolution').count, 3);
  assert.equal(stage('backups').count, 1);
  assert.match(stage('backups').detail, /not fresh integrity verification/);
  assert.equal(stage('product-fields').count, 1);
  assert.equal(snapshot.artworks.find(item => item.id === 'approved').price, '69.00');
  assert.equal(snapshot.artworks.find(item => item.id === 'remote').hasLocalOriginal, false);
  assert.deepEqual(snapshot.stages.filter(item => item.canCheckArtwork).map(item => item.id), ['originals', 'resolution', 'pricing']);
  for (const item of snapshot.stages) {
    assert.ok(['ready', 'waiting', 'running', 'blocked', 'manual', 'not-connected'].includes(item.status));
    assert.ok(['#canvas', '#production-review', '#flux-studio', '#pipeline-control'].includes(item.openHash));
    assert.ok(item.title && item.detail);
    assert.ok(Number.isInteger(item.count));
  }
});

test('packages are detected from disk, while configured remote systems remain unverified and expose no secrets', t => {
  const { monitor, env } = fixture(t);
  const snapshot = monitor.snapshot(), systems = snapshot.systems;
  assert.equal(systems.length, 10);
  const system = id => systems.find(item => item.id === id);
  assert.equal(system('langchain').installed, true);
  assert.equal(system('langchain').version, '1.2.3');
  assert.equal(system('langsmith').installed, true);
  assert.equal(system('langsmith').version, '0.9.8');
  assert.equal(system('langsmith').configured, true);
  assert.match(system('langsmith').role, /does not orchestrate/);
  for (const id of ['langsmith', 'openai', 'flux', 'replicate', 'midjourney', 'shopify', 'digital-products', 'gelato']) assert.equal(system(id).verified, false);
  assert.equal(system('replicate').configured, false);
  assert.match(system('replicate').detail, /BFL has no still-image upscale/);
  assert.equal(system('langgraph').verified, true, 'the graph object can be observed locally');
  assert.equal(system('shopify').configured, true);
  assert.equal(system('shopify').status, 'not-connected');
  assert.equal(system('digital-products').installed, true);
  assert.equal(system('gelato').installed, true);
  assert.match(system('digital-products').detail, /reported by the owner/);
  const encoded = JSON.stringify(snapshot);
  for (const secret of [...Object.values(env).filter(value => value !== 'true'), 'private-signing-secret', 'private-model-alias']) assert.equal(encoded.includes(secret), false);
  assert.equal(encoded.includes('pollingUrl'), false);
});

test('snapshots preserve drafts, jobs and review records and never perform work or network checks', t => {
  const { monitor, artworks, jobs, drafts, inspected } = fixture(t);
  const before = JSON.stringify({ artworks, jobs, drafts: [...drafts] });
  const first = monitor.snapshot(), second = monitor.snapshot();
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify({ artworks, jobs, drafts: [...drafts] }), before);
  assert.deepEqual(inspected, []);
  assert.equal(drafts.size, 3, 'expired drafts are counted out without deleting them');
});

test('paused and uncertain paid submissions block the queue and generation without being retried', t => {
  const { monitor, jobs } = fixture(t);
  const snapshot = monitor.snapshot();
  for (const id of ['creation-queue', 'generation']) assert.equal(snapshot.stages.find(item => item.id === id).status, 'blocked');
  assert.equal(snapshot.stages.find(item => item.id === 'creation-queue').count, 6);
  assert.ok(snapshot.issues.some(issue => issue.stageId === 'creation-queue' && issue.count === 3 && /never retried/.test(issue.message)));
  assert.equal(jobs.find(job => job.id === 'unknown').status, 'submission_uncertain');
  assert.equal(jobs.find(job => job.id === 'paused').status, 'paused');
});

test('stage checks only inspect one selected artwork for explicitly allowed stages', async t => {
  const { monitor, inspected, jobs } = fixture(t);
  const before = structuredClone(jobs);
  for (const id of IDS.filter(id => id !== 'provider')) {
    const result = await monitor.check(id);
    assert.equal(result.stage.id, id);
    assert.equal(result.snapshot.stages.length, 17);
    assert.equal(result.checkedAt, NOW);
  }
  assert.deepEqual(inspected, []);
  for (const stage of ['originals', 'resolution', 'pricing']) {
    const result = await monitor.check(stage, { artworkId: 'pending' });
    assert.equal(result.stage.id, stage);
  }
  assert.deepEqual(inspected, ['pending', 'pending', 'pending']);
  await assert.rejects(monitor.check('invented'), error => error.statusCode === 400);
  await assert.rejects(monitor.check('generation', { artworkId: 'pending' }), error => error.statusCode === 400);
  await assert.rejects(monitor.check('pricing', { artworkId: '' }), error => error.statusCode === 400);
  await assert.rejects(monitor.check('pricing', { artworkId: null }), error => error.statusCode === 400);
  await assert.rejects(monitor.check('pricing', { artworkId: 'missing' }), error => error.statusCode === 409);
  assert.deepEqual(inspected, ['pending', 'pending', 'pending']);
  assert.deepEqual(jobs, before);
});

test('a monitor price check preserves the stored 69 approval using the existing file-bound inspector', async t => {
  const { options, root } = fixture(t);
  const productionReview = new ProductionReview({ file: path.join(root, 'reviews.json'), assetRoot: options.productionReview.assetRoot, fetchImage: mustNotRun,
    sources: () => [{ id: 'saved', title: 'Saved approval', assetUrl: '/assets/first.png' }], pricingSamples: [] });
  const inspected = await productionReview.inspect('saved');
  await productionReview.decide('saved', { decision: 'approved', hash: inspected.hash, price: 69, visualScore: 8, visualConfirmed: true });
  const approved = structuredClone(productionReview.records.saved.approval);
  const monitor = new PipelineMonitor({ ...options, productionReview });
  assert.equal(monitor.snapshot().artworks[0].price, '69.00');
  await monitor.check('pricing', { artworkId: 'saved' });
  assert.equal(productionReview.records.saved.product.price, '69.00');
  assert.deepEqual(productionReview.records.saved.approval, approved);
  assert.equal(JSON.parse(fs.readFileSync(productionReview.file)).saved.product.price, '69.00');
});

test('missing packages and model objects are reported honestly; tracing requires both a key and a flag', t => {
  const { options, root } = fixture(t);
  const emptyRoot = path.join(root, 'empty'); fs.mkdirSync(emptyRoot);
  const monitor = new PipelineMonitor({ ...options, root: emptyRoot, env: {}, settings: {}, creativeAgent: null, creativeOrchestrator: {}, flux: { list: () => [], key: '' } });
  let snapshot = monitor.snapshot();
  assert.equal(snapshot.systems.find(item => item.id === 'langchain').installed, false);
  assert.equal(snapshot.systems.find(item => item.id === 'langgraph').verified, false);
  assert.equal(snapshot.systems.find(item => item.id === 'openai').configured, false);
  assert.equal(snapshot.systems.find(item => item.id === 'langsmith').configured, false);
  assert.equal(snapshot.systems.find(item => item.id === 'flux').configured, false);
  assert.equal(snapshot.stages[0].status, 'not-connected');
  monitor.env = { LANGSMITH_API_KEY: 'hidden', LANGCHAIN_TRACING_V2: 'true' };
  snapshot = monitor.snapshot();
  assert.equal(snapshot.systems.find(item => item.id === 'langsmith').configured, true);
  assert.equal(snapshot.systems.find(item => item.id === 'langsmith').verified, false);
  monitor.env = { LANGSMITH_API_KEY: 'hidden', LANGCHAIN_TRACING_V2: 'false' };
  assert.equal(monitor.snapshot().systems.find(item => item.id === 'langsmith').configured, false);
});

test('read failures block affected stages without exposing raw errors or claiming completion', t => {
  const { options } = fixture(t);
  const monitor = new PipelineMonitor({ ...options,
    productionReview: { list: () => { throw new Error('secret-file-path-and-token'); } },
    flux: { list: () => { throw new Error('secret-provider-token'); } } });
  const snapshot = monitor.snapshot();
  assert.equal(snapshot.summary.total, 0);
  assert.equal(snapshot.summary.failed, 0);
  for (const id of ['creation-queue', 'generation', 'originals', 'resolution', 'pricing', 'monitoring']) assert.equal(snapshot.stages.find(item => item.id === id).status, 'blocked');
  assert.equal(JSON.stringify(snapshot).includes('secret-'), false);
  assert.equal(snapshot.issues.length, 2);
});

test('invalid archive paths cannot count as saved backups', t => {
  const { monitor, artworks } = fixture(t);
  artworks.find(item => item.id === 'approved').archive.fileName = '../../assets/first.png';
  const stage = monitor.snapshot().stages.find(item => item.id === 'backups');
  assert.equal(stage.count, 0);
  assert.equal(stage.status, 'blocked');
});

test('only an explicit provider check calls the BFL credits endpoint and caches a sanitized success', async t => {
  const { options, root, inspected, artworks, drafts } = fixture(t);
  const calls = [];
  const flux = new FluxStudio({ key: 'private-bfl-key', file: path.join(root, 'flux.json'), fetcher: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ credits: 12.5, privateResponseField: 'do-not-expose-response' }) };
  } });
  flux.jobs = [{ id: 'paused', status: 'paused' }, { id: 'uncertain', status: 'submission_uncertain' }];
  flux.tick = mustNotRun; flux.create = mustNotRun; flux.createBatch = mustNotRun;
  const before = JSON.stringify({ jobs: flux.jobs, artworks, drafts: [...drafts] });
  const monitor = new PipelineMonitor({ ...options, flux });
  const system = snapshot => snapshot.systems.find(item => item.id === 'flux');
  assert.equal(system(monitor.snapshot()).verified, false);
  await monitor.check('monitoring');
  assert.equal(calls.length, 0);
  const result = await monitor.check('provider');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.bfl.ai/v1/credits');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.body, undefined);
  assert.equal(system(result.snapshot).verified, true);
  assert.match(system(result.snapshot).detail, /2026-09-12T12:00:00.000Z/);
  assert.match(system(result.snapshot).detail, /12\.5/);
  assert.equal(result.stage.status, 'ready');
  assert.match(result.message, /BFL connection verified/);
  assert.deepEqual(monitor.providerVerification, { verified: true, checkedAt: NOW, credits: 12.5 });
  monitor.snapshot(); monitor.snapshot();
  assert.equal(calls.length, 1, 'snapshot refreshes reuse the recent observation without making requests');
  await assert.rejects(monitor.check('provider', { artworkId: 'pending' }), error => error.statusCode === 400);
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(result).includes('private-bfl-key'), false);
  assert.equal(JSON.stringify(result).includes('do-not-expose-response'), false);
  assert.deepEqual(inspected, []);
  assert.equal(JSON.stringify({ jobs: flux.jobs, artworks, drafts: [...drafts] }), before);
  assert.equal(fs.existsSync(flux.file), false, 'provider verification does not persist or change jobs');
});

test('provider failure details and thrown responses are sanitized and do not retain an earlier success', async t => {
  const { monitor, jobs } = fixture(t);
  const before = JSON.stringify(jobs);
  let calls = 0;
  monitor.flux.connection = async () => { calls++; return { verified: true, credits: 100 }; };
  await monitor.check('provider');
  monitor.flux.connection = async () => { calls++; return { verified: false, credits: 999, message: 'private-server-token', private: { apiKey: 'private-api-key' } }; };
  const failed = await monitor.check('provider');
  assert.equal(failed.stage.status, 'blocked');
  assert.equal(failed.snapshot.systems.find(item => item.id === 'flux').verified, false);
  assert.equal(failed.message, 'Provider verification failed; check connection in FLUX controls.');
  assert.deepEqual(monitor.providerVerification, { verified: false, checkedAt: NOW, credits: null });
  assert.equal(JSON.stringify(failed).includes('private-server-token'), false);
  assert.equal(JSON.stringify(failed).includes('private-api-key'), false);
  monitor.flux.connection = async () => { calls++; throw new Error('secret-url-with-credentials'); };
  const thrown = await monitor.check('provider');
  assert.equal(thrown.stage.status, 'blocked');
  assert.equal(thrown.message, failed.message);
  assert.equal(JSON.stringify(thrown).includes('secret-url-with-credentials'), false);
  assert.equal(calls, 3, 'each explicit click performs its own read-only verification');
  assert.equal(JSON.stringify(jobs), before);
});

test('provider verification expires after five minutes without automatic requests', async t => {
  const { monitor } = fixture(t);
  let now = Date.parse(NOW), calls = 0;
  monitor.now = () => new Date(now);
  monitor.flux.connection = async () => { calls++; return { verified: true, credits: 0 }; };
  await monitor.check('provider');
  const system = () => monitor.snapshot().systems.find(item => item.id === 'flux');
  assert.equal(system().verified, true);
  assert.match(system().detail, /Available credits: 0/);
  now += 5 * 60 * 1000 - 1;
  assert.equal(system().verified, true);
  now += 1;
  assert.equal(system().verified, false);
  assert.equal(system().status, 'ready', 'a configured but expired connection returns to unverified readiness');
  assert.match(system().detail, /unverified/);
  assert.equal(calls, 1);
  monitor.flux.connection = async () => { calls++; return { verified: false, message: 'private-error' }; };
  assert.equal((await monitor.check('provider')).stage.status, 'blocked');
  now += 5 * 60 * 1000;
  assert.equal(monitor.snapshot().stages.find(item => item.id === 'provider').status, 'ready');
  assert.equal(calls, 2);
});

test('provider checks handle unavailable verification and ignore nonnumeric credit payloads', async t => {
  const { monitor } = fixture(t);
  delete monitor.flux.connection;
  const unavailable = await monitor.check('provider');
  assert.match(unavailable.message, /unavailable/);
  assert.equal(unavailable.stage.status, 'blocked');
  monitor.flux.connection = async () => ({ verified: true, credits: 'private-credit-response', message: 'private-provider-message' });
  const result = await monitor.check('provider');
  assert.equal(result.snapshot.systems.find(item => item.id === 'flux').verified, true);
  assert.deepEqual(monitor.providerVerification, { verified: true, checkedAt: NOW, credits: null });
  assert.equal(JSON.stringify(result).includes('private-credit-response'), false);
  assert.equal(JSON.stringify(result).includes('private-provider-message'), false);
});

test('LangSmith is detected through a pnpm-linked core package using its real dependency location', t => {
  const { options, root } = fixture(t);
  const layout = path.join(root, 'pnpm-layout');
  const coreRoot = path.join(layout, 'node_modules', '.pnpm', 'core-store', 'node_modules');
  const coreReal = path.join(coreRoot, '@langchain', 'core');
  const smithReal = path.join(layout, 'node_modules', '.pnpm', 'smith-store', 'node_modules', 'langsmith');
  const publicCore = path.join(layout, 'node_modules', '@langchain', 'core');
  fs.mkdirSync(coreReal, { recursive: true });
  fs.mkdirSync(smithReal, { recursive: true });
  fs.mkdirSync(path.dirname(publicCore), { recursive: true });
  fs.writeFileSync(path.join(coreReal, 'package.json'), JSON.stringify({ name: '@langchain/core', version: '1.2.10' }));
  fs.writeFileSync(path.join(smithReal, 'package.json'), JSON.stringify({ name: 'langsmith', version: '0.10.2', main: 'index.cjs' }));
  fs.writeFileSync(path.join(smithReal, 'index.cjs'), 'throw new Error("Detection must not execute the SDK");');
  fs.symlinkSync(coreReal, publicCore, 'junction');
  fs.symlinkSync(smithReal, path.join(coreRoot, 'langsmith'), 'junction');
  assert.equal(fs.existsSync(path.join(layout, 'node_modules', 'langsmith', 'package.json')), false);
  const monitor = new PipelineMonitor({ ...options, root: layout });
  const smith = monitor.snapshot().systems.find(system => system.id === 'langsmith');
  assert.equal(smith.installed, true);
  assert.equal(smith.version, '0.10.2');
  assert.equal(smith.configured, true);
  assert.equal(smith.verified, false, 'installed tracing is not proof of remote connectivity');
});
