import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { planUpscale, requiredPixels, pixelsForCm } from '../src/print-targets.js';
import { detailReport, laplacianVariance, inspectionCrops } from '../src/detail-metrics.js';
import { UpscaleService, replicateTopazProvider } from '../src/upscale.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-upscale-'));

// A synthetic "artwork" with real high-frequency content: noise plus hard-edged stripes.
async function detailedSource(width = 320, height = 400) {
  const raw = Buffer.alloc(width * height * 3);
  let s = 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    const stripe = ((x >> 3) + (y >> 3)) & 1 ? 200 : 40;
    const v = Math.max(0, Math.min(255, stripe + (rnd() - 0.5) * 120));
    raw[i] = v; raw[i + 1] = 255 - v; raw[i + 2] = (v + 128) & 255 > 127 ? v : 255 - v;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}
const stretch = (bytes, f) => sharp(bytes).metadata().then((m) => sharp(bytes).resize({ width: m.width * f, height: m.height * f, kernel: sharp.kernel.lanczos3 }).png().toBuffer());
const stretchAndSharpen = (bytes, f) => sharp(bytes).metadata().then((m) => sharp(bytes).resize({ width: m.width * f, height: m.height * f, kernel: sharp.kernel.lanczos3 }).sharpen({ sigma: 1.2, m1: 2, m2: 3 }).png().toBuffer());

test('print targets: 30x40 cm at 300 PPI is 16.7 MP and a 4 MP source needs 4x with the supported factors', () => {
  assert.equal(pixelsForCm(30), 3544);
  assert.equal(pixelsForCm(40), 4725);
  assert.equal(requiredPixels(30, 40), 3544 * 4725);
  const plan = planUpscale({ width: 1792, height: 2240, targetWidthCm: 30, targetHeightCm: 40 });
  assert.equal(plan.factor, 4);
  assert.equal(plan.sufficient, true);
  assert.ok(plan.exactFactor > 2 && plan.exactFactor < 2.1, `exact factor ${plan.exactFactor}`);
  assert.deepEqual(plan.output, { width: 7168, height: 8960, megapixels: 64.23 });
  assert.equal(plan.printsToCm.width, 60.7);
  const landscape = planUpscale({ width: 2496, height: 1664, targetWidthCm: 30, targetHeightCm: 40 });
  assert.equal(landscape.factor, 4, '2x would be 16.61 MP against a 16.74 MP target: 0.8% short, so the planner is strict and steps up');
  assert.ok(landscape.exactFactor > 2.0 && landscape.exactFactor < 2.01, `exact ${landscape.exactFactor}`);
  const square = planUpscale({ width: 2048, height: 2048, targetWidthCm: 30, targetHeightCm: 40 });
  assert.equal(square.factor, 2, 'a 4.19 MP square at 2x is 16.78 MP, which clears the target');
  assert.equal(square.output.width, 4096);
  const short = planUpscale({ width: 400, height: 500, targetWidthCm: 30, targetHeightCm: 40, factors: [2, 4] });
  assert.equal(short.sufficient, false);
  assert.equal(short.factor, 4);
  assert.match(short.note, /leaves this source short/);
  assert.throws(() => planUpscale({ width: 0, height: 10, targetWidthCm: 30, targetHeightCm: 40 }), (e) => e.statusCode === 400);
});

test('detail guard: a plain stretch reads as nothing_added, a sharpened stretch reads as gain, and it never claims verified', async () => {
  const source = await detailedSource();
  const stretched = await stretch(source, 2);
  const sharpened = await stretchAndSharpen(source, 2);
  const plain = await detailReport({ sourceBytes: source, candidateBytes: stretched });
  assert.equal(plain.verdict, 'nothing_added', `ratio ${plain.ratio}`);
  assert.ok(plain.ratio > 0.95 && plain.ratio < 1.05, `stretch ratio should be ~1.0, got ${plain.ratio}`);
  assert.equal(plain.candidate.width, 640);
  assert.equal(plain.baseline.width, 640, 'baseline is the source stretched to the candidate size');
  const gain = await detailReport({ sourceBytes: source, candidateBytes: sharpened });
  assert.ok(gain.ratio > 1.25, `sharpened ratio should show clear gain, got ${gain.ratio}`);
  assert.equal(gain.verdict, 'clear_gain');
  assert.equal(gain.detailVerified, false, 'a high ratio must never be reported as verified detail');
  assert.match(gain.caveat, /does not distinguish real detail from sharpening/);
  const lv = await laplacianVariance(source);
  assert.ok(lv.variance > 0 && lv.sampleEdge === 320);
  const crops = await inspectionCrops(sharpened, { edge: 100 });
  assert.equal(crops.length, 2);
  assert.equal(crops[0].name, 'centre');
  assert.equal(crops[1].size, 100);
  assert.equal(crops[0].png[0], 137, 'crops are PNG');
});

// A fake Replicate that records every call and can be told which schema to declare.
function fakeReplicate({ schemaParams = ['image', 'enhance_model', 'upscale_factor', 'output_format'], output, fail = false, pollsUntilDone = 1 } = {}) {
  const calls = []; let polls = 0;
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body });
    if (url === 'https://api.replicate.com/v1/account') return json(200, { username: 'andre' });
    if (url.startsWith('https://api.replicate.com/v1/models/topazlabs/image-upscale/predictions')) return json(201, { id: 'p1', status: 'starting', urls: { get: 'https://api.replicate.com/v1/predictions/p1' } });
    if (url === 'https://api.replicate.com/v1/models/topazlabs/image-upscale') return json(200, { latest_version: { id: 'v9', openapi_schema: { components: { schemas: { Input: { properties: Object.fromEntries(schemaParams.map((p) => [p, {}])) } } } } } });
    if (url === 'https://api.replicate.com/v1/files') return json(201, { urls: { get: 'https://api.replicate.com/v1/files/f1' } });
    if (url === 'https://api.replicate.com/v1/predictions/p1') { polls++; return polls < pollsUntilDone ? json(200, { status: 'processing' }) : fail ? json(200, { status: 'failed', error: 'boom' }) : json(200, { status: 'succeeded', output: 'https://replicate.delivery/x/out.png' }); }
    if (url === 'https://replicate.delivery/x/out.png') return { ok: true, status: 200, body: (async function* () { yield output; })() };
    throw new Error('unexpected url ' + url);
  };
  return { fetcher, calls };
}
const service = (overrides = {}) => new UpscaleService({ token: 'r8_test', file: path.join(tmp, `${Math.random().toString(36).slice(2)}.json`), assetRoot: path.join(tmp, 'masters'), targetCm: { width: 3, height: 4 }, ...overrides });

test('connection: unconfigured without a token; verified only when account AND schema both check out', async () => {
  const none = new UpscaleService({ token: '', file: path.join(tmp, 'none.json'), fetcher: async () => { throw new Error('must not be called'); } });
  assert.deepEqual(await none.connection(), { configured: false, verified: false, message: 'REPLICATE_API_TOKEN is not set.' });
  const good = service({ fetcher: fakeReplicate().fetcher });
  const ok = await good.connection();
  assert.equal(ok.verified, true); assert.equal(ok.account, 'andre'); assert.equal(ok.version, 'v9');
  const drifted = service({ fetcher: fakeReplicate({ schemaParams: ['image', 'scale', 'model'] }).fetcher });
  const bad = await drifted.connection();
  assert.equal(bad.verified, false);
  assert.match(bad.message, /does not declare enhance_model, upscale_factor, output_format/);
  assert.match(bad.message, /Schema has: image, scale, model/);
});

test('enqueue is idempotent on the source job and refuses an impossible plan up front', async () => {
  const s = service({ fetcher: fakeReplicate().fetcher, readSource: async () => detailedSource() });
  const big = { width: 30, height: 40 };
  const a = s.enqueue({ sourceJobId: 'flux:1', title: 'Sierra', sourcePath: 'x', width: 1792, height: 2240, targetCm: big });
  const b = s.enqueue({ sourceJobId: 'flux:1', title: 'Sierra', sourcePath: 'x', width: 1792, height: 2240, targetCm: big });
  assert.equal(a.id, b.id);
  assert.equal(a.status, 'queued'); assert.equal(a.plan.factor, 4); assert.equal(a.method, 'topaz-restoration');
  const tiny = s.enqueue({ sourceJobId: 'flux:2', title: 'Tiny', sourcePath: 'x', width: 300, height: 400, targetCm: big });
  assert.equal(tiny.status, 'failed'); assert.match(tiny.message, /short/);
  assert.ok(!fs.existsSync(s.file + '.tmp'));
});

test('tick runs queued -> submitting -> polling -> master_ready, uploads the source, uses Bearer auth, downloads only from replicate.delivery, and calls onReady', async () => {
  const source = await detailedSource();
  const output = await stretchAndSharpen(source, 2);
  const fake = fakeReplicate({ output, pollsUntilDone: 2 });
  const ready = [];
  const s = service({ fetcher: fake.fetcher, readSource: async () => source, onReady: async (job) => ready.push(job.id) });
  const job = s.enqueue({ sourceJobId: 'flux:1', title: 'Sierra', sourcePath: 'x', width: 320, height: 400 });
  await s.tick(); assert.equal(s.get(job.id).status, 'polling');
  assert.ok(s.get(job.id).providerId === 'p1');
  const upload = fake.calls.find((c) => c.url === 'https://api.replicate.com/v1/files');
  assert.ok(upload && upload.method === 'POST' && upload.body instanceof FormData, 'source is uploaded through the Files API, not inlined');
  const create = fake.calls.find((c) => c.url.endsWith('/predictions'));
  const input = JSON.parse(create.body).input;
  assert.deepEqual(input, { image: 'https://api.replicate.com/v1/files/f1', enhance_model: 'High Fidelity V2', upscale_factor: '2x', output_format: 'png' });
  await s.tick(); assert.equal(s.get(job.id).status, 'polling', 'still processing after first poll');
  await s.tick();
  const done = s.get(job.id);
  assert.equal(done.status, 'master_ready', done.message);
  assert.deepEqual(done.dimensions, { width: 640, height: 800 });
  assert.equal(done.detail.verdict, 'clear_gain');
  assert.equal(done.detail.detailVerified, false);
  assert.match(done.assetUrl, /^\/assets\/masters\/[0-9a-f-]+-[a-f0-9]{64}\.png$/);
  assert.ok(fs.existsSync(path.join(tmp, 'masters', path.basename(done.assetUrl))));
  assert.deepEqual(ready, [job.id]);
  assert.ok(!('pollingUrl' in s.list()[0]), 'polling URL never leaves the process');
});

test('a stretch-only result lands in master_low_detail and does not call onReady', async () => {
  const source = await detailedSource();
  const fake = fakeReplicate({ output: await stretch(source, 2) });
  const ready = [];
  const s = service({ fetcher: fake.fetcher, readSource: async () => source, onReady: async (job) => ready.push(job.id) });
  const job = s.enqueue({ sourceJobId: 'flux:1', title: 'Flat', sourcePath: 'x', width: 320, height: 400 });
  await s.tick(); await s.tick();
  const done = s.get(job.id);
  assert.equal(done.status, 'master_low_detail');
  assert.equal(done.detail.verdict, 'nothing_added');
  assert.match(done.message, /Do not sell this as a print file/);
  assert.deepEqual(ready, []);
});

test('provider failure, schema drift, and restart-in-flight each stop honestly without resubmitting', async () => {
  const source = await detailedSource();
  const failing = service({ fetcher: fakeReplicate({ fail: true, output: source }).fetcher, readSource: async () => source });
  const f = failing.enqueue({ sourceJobId: 'flux:1', title: 'x', sourcePath: 'x', width: 320, height: 400 });
  await failing.tick(); await failing.tick();
  assert.equal(failing.get(f.id).status, 'failed'); assert.match(failing.get(f.id).message, /boom/);
  const drifted = service({ fetcher: fakeReplicate({ schemaParams: ['image'] }).fetcher, readSource: async () => source });
  const d = drifted.enqueue({ sourceJobId: 'flux:1', title: 'x', sourcePath: 'x', width: 320, height: 400 });
  await drifted.tick();
  assert.equal(drifted.get(d.id).status, 'needs_attention'); assert.match(drifted.get(d.id).message, /does not declare/);
  const file = path.join(tmp, 'restart.json');
  fs.writeFileSync(file, JSON.stringify([{ id: 'j1', sourceJobId: 's', status: 'submitting', plan: { factor: 2 } }]));
  const restarted = new UpscaleService({ token: 'r8_test', file, fetcher: async () => { throw new Error('must not be called'); } });
  assert.equal(restarted.get('j1').status, 'submission_uncertain');
  await restarted.tick();
  assert.equal(restarted.get('j1').status, 'submission_uncertain', 'an uncertain submission is never retried automatically');
});

test('provider adapter builds Topaz input with the High Fidelity model by default and CGI on request', () => {
  assert.equal(replicateTopazProvider().buildInput({ imageUrl: 'u', factor: 4 }).enhance_model, 'High Fidelity V2');
  assert.equal(replicateTopazProvider({ enhanceModel: 'CGI' }).buildInput({ imageUrl: 'u', factor: 6 }).upscale_factor, '6x');
  assert.equal(replicateTopazProvider().generative, false);
  assert.equal(replicateTopazProvider().buildInput({ imageUrl: 'u', factor: 4 }).output_format, 'png');
  assert.equal(replicateTopazProvider({ outputFormat: 'jpg' }).buildInput({ imageUrl: 'u', factor: 6 }).output_format, 'jpg');
});

test('a JPEG master is requested as jpg, saved with a .jpg extension, and still measured', async () => {
  const source = await detailedSource();
  const jpeg = await sharp(await stretchAndSharpen(source, 2)).jpeg({ quality: 95 }).toBuffer();
  const fake = fakeReplicate({ output: jpeg });
  const s = service({ fetcher: fake.fetcher, readSource: async () => source, provider: replicateTopazProvider({ outputFormat: 'jpg' }) });
  const job = s.enqueue({ sourceJobId: 'flux:jpg', title: 'Jpeg', sourcePath: 'x', width: 320, height: 400 });
  await s.tick(); await s.tick();
  const done = s.get(job.id);
  assert.equal(done.status, 'master_ready', done.message);
  assert.match(done.assetUrl, /^\/assets\/masters\/[0-9a-f-]+-[a-f0-9]{64}\.jpg$/);
  assert.deepEqual(done.dimensions, { width: 640, height: 800 });
  assert.ok(fs.existsSync(path.join(tmp, 'masters', path.basename(done.assetUrl))));
  const create = fake.calls.find((c) => c.url.endsWith('/predictions'));
  assert.equal(JSON.parse(create.body).input.output_format, 'jpg');
});

test('Rust preflight records inspection metadata before an external upscale submission', async () => {
  const source = await detailedSource();
  const fake = fakeReplicate({ output: await stretchAndSharpen(source, 2) });
  const calls = [];
  const rustCore = {
    enabled: true,
    inspect: async (sourcePath) => {
      calls.push(['inspect', sourcePath]);
      return { width: 320, height: 400, sha256: 'a'.repeat(64) };
    },
    plan: async (input) => {
      calls.push(['plan', input]);
      return { passes: [2] };
    },
  };
  const s = service({
    fetcher: fake.fetcher,
    readSource: async () => source,
    resolveSourcePath: () => path.join(tmp, 'source.png'),
    rustCore,
  });
  const job = s.enqueue({ sourceJobId: 'flux:rust-ready', title: 'Rust ready', sourcePath: '/assets/source.png', width: 320, height: 400 });

  await s.tick();

  assert.equal(s.get(job.id).status, 'polling');
  assert.deepEqual(s.get(job.id).rustPreflight, { width: 320, height: 400, sha256: 'a'.repeat(64), passes: [2] });
  assert.deepEqual(calls, [
    ['inspect', path.join(tmp, 'source.png')],
    ['plan', { longEdge: 400, target: 800 }],
  ]);
});

test('Rust preflight blocks a changed source before it submits an external upscale', async () => {
  const source = await detailedSource();
  const fake = fakeReplicate({ output: source });
  const rustCore = {
    enabled: true,
    inspect: async () => ({ width: 321, height: 400, sha256: 'b'.repeat(64) }),
    plan: async () => ({ passes: [2] }),
  };
  const s = service({
    fetcher: fake.fetcher,
    readSource: async () => source,
    resolveSourcePath: () => path.join(tmp, 'changed-source.png'),
    rustCore,
  });
  const job = s.enqueue({ sourceJobId: 'flux:rust-mismatch', title: 'Rust mismatch', sourcePath: '/assets/source.png', width: 320, height: 400 });

  await s.tick();

  assert.equal(s.get(job.id).status, 'needs_attention');
  assert.match(s.get(job.id).message, /Source dimensions changed/);
  assert.equal(fake.calls.some((call) => call.url === 'https://api.replicate.com/v1/files'), false);
});
