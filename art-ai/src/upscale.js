import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { imageDimensions } from './production-review.js';
import { planUpscale } from './print-targets.js';
import { detailReport } from './detail-metrics.js';

const error = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
// A genuine 8192px+ PNG from a detailed 6x Topaz pass routinely lands well past 64 MB; the cap only
// needs to catch a runaway or wrong-content download, not bound legitimate high-resolution art masters.
const MAX_MASTER_BYTES = 256 * 1024 * 1024;
const POLL_TIMEOUT_MS = 20 * 60 * 1000;

// Only these hosts may ever be contacted or downloaded from. Mirrors providerUrl() in flux.js.
function providerUrl(value, delivery = false) {
  const url = new URL(value);
  const hostOK = delivery ? /^([a-z0-9-]+\.)*replicate\.delivery$/.test(url.hostname) : url.hostname === 'api.replicate.com';
  if (url.protocol !== 'https:' || !hostOK || url.username || url.password || url.port) throw error('Unexpected Replicate response URL');
  return url.href;
}

/** Topaz on Replicate. The parameter names are confirmed against the live schema on connection(). */
export function replicateTopazProvider({ model = 'topazlabs/image-upscale', enhanceModel = 'High Fidelity V2', outputFormat = 'png' } = {}) {
  return {
    name: model,
    method: 'topaz-restoration',
    generative: false,
    paramNames: ['image', 'enhance_model', 'upscale_factor', 'output_format'],
    buildInput: ({ imageUrl, factor }) => ({ image: imageUrl, enhance_model: enhanceModel, upscale_factor: `${factor}x`, output_format: outputFormat }),
    factors: [2, 4, 6],
  };
}

/**
 * The upscale stage. Written to mirror FluxStudio: JSON persistence with .tmp + rename, a
 * single-flight tick() driven by the server timer, and a submit boundary that is never
 * automatically retried once it might have been charged.
 */
export class UpscaleService {
  constructor({ token = '', file = path.resolve('data/upscale-jobs.json'), assetRoot = path.resolve('assets/masters'), fetcher = fetch, provider = replicateTopazProvider(), readSource, resolveSourcePath, rustCore = null, onReady = async () => {}, targetCm = { width: 30, height: 40 } } = {}) {
    Object.assign(this, { token: token.trim(), file, assetRoot, fetcher, provider, readSource, resolveSourcePath, rustCore, onReady, targetCm });
    this.jobs = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    this.busy = false;
    this.schemaCheck = null;
    for (const job of this.jobs) if (job.status === 'submitting') { job.status = 'submission_uncertain'; job.message = 'Check Replicate history before creating another request.'; }
  }

  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.jobs, null, 2)); fs.renameSync(this.file + '.tmp', this.file); }
  list() { return this.jobs.map(({ pollingUrl, ...publicJob }) => publicJob); }
  get(id) { return this.jobs.find((job) => job.id === id) || null; }

  async json(url, { method = 'GET', body, headers = {} } = {}) {
    if (!this.token) throw error('Add REPLICATE_API_TOKEN to local settings first');
    const response = await this.fetcher(providerUrl(url), {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${this.token}`, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw error(response.status === 402 ? 'Add credit to your Replicate account' : response.status === 401 || response.status === 403 ? 'Replicate did not accept this API token' : `Replicate returned HTTP ${response.status}. Check the connection before trying again.`);
    return response.json();
  }

  /** Probes the account AND checks the provider's parameter names against the live model schema. Never reports verified without both. */
  async connection() {
    if (!this.token) return { configured: false, verified: false, message: 'REPLICATE_API_TOKEN is not set.' };
    try {
      const account = await this.json('https://api.replicate.com/v1/account');
      const model = await this.json(`https://api.replicate.com/v1/models/${this.provider.name}`);
      const props = Object.keys(model?.latest_version?.openapi_schema?.components?.schemas?.Input?.properties || {});
      const missing = this.provider.paramNames.filter((name) => !props.includes(name));
      this.schemaCheck = { at: new Date().toISOString(), version: model?.latest_version?.id || null, missing, schemaParams: props };
      if (missing.length) return { configured: true, verified: false, account: account.username, message: `The model schema does not declare ${missing.join(', ')}. Submission is refused until the provider adapter is updated. Schema has: ${props.join(', ')}.` };
      return { configured: true, verified: true, account: account.username, model: this.provider.name, version: this.schemaCheck.version };
    } catch (e) { return { configured: true, verified: false, message: e.message }; }
  }

  /** Queue a master for a finished generation. The source job id is the idempotency key. */
  enqueue({ sourceJobId, title, sourcePath, width, height, targetCm = this.targetCm }) {
    if (!this.token) throw error('Replicate token is missing');
    if (typeof sourceJobId !== 'string' || !sourceJobId.trim()) throw error('A source job id is required');
    const existing = this.jobs.find((job) => job.sourceJobId === sourceJobId);
    if (existing) return existing;
    const plan = planUpscale({ width, height, targetWidthCm: targetCm.width, targetHeightCm: targetCm.height, factors: this.provider.factors });
    const job = { id: crypto.randomUUID(), sourceJobId, title: String(title || sourceJobId).slice(0, 200), sourcePath, plan, status: 'queued', createdAt: new Date().toISOString(), provider: this.provider.name, method: this.provider.method };
    if (!plan.sufficient) { job.status = 'failed'; job.message = plan.note; }
    this.jobs.push(job); this.save(); return job;
  }

  async uploadSource(bytes, filename) {
    const form = new FormData();
    form.append('content', new Blob([bytes], { type: bytes[0] === 137 ? 'image/png' : 'image/jpeg' }), filename);
    const file = await this.json('https://api.replicate.com/v1/files', { method: 'POST', body: form });
    if (!file?.urls?.get) throw error('Replicate did not return a file URL');
    return providerUrl(file.urls.get);
  }

  async rustPreflight(job) {
    if (!this.rustCore?.enabled) return null;
    if (typeof this.resolveSourcePath !== 'function') throw error('Rust image core requires a source path resolver');
    const source = this.resolveSourcePath(job.sourcePath);
    const inspection = await this.rustCore.inspect(source);
    if (inspection.width !== job.plan.source.width || inspection.height !== job.plan.source.height) {
      throw error('Source dimensions changed after the upscale plan was created. Requeue the source before submitting a paid upscale.');
    }
    const plan = await this.rustCore.plan({
      longEdge: Math.max(inspection.width, inspection.height),
      target: Math.max(job.plan.output.width, job.plan.output.height),
    });
    return { width: inspection.width, height: inspection.height, sha256: inspection.sha256, passes: plan.passes };
  }

  async tick() {
    if (this.busy) return; this.busy = true;
    try {
      const job = this.jobs.find((j) => j.status === 'polling') || this.jobs.find((j) => j.status === 'queued');
      if (!job) return;
      if (job.status === 'queued') {
        if (!this.schemaCheck || this.schemaCheck.missing.length) { const c = await this.connection(); if (!c.verified) { job.status = 'needs_attention'; job.message = c.message; this.save(); return; } }
        let sourceBytes;
        try { sourceBytes = await this.readSource(job.sourcePath); if (!Buffer.isBuffer(sourceBytes) || !sourceBytes.length) throw new Error('empty'); }
        catch { job.status = 'failed'; job.message = 'The source image could not be read. Regenerate it before requesting a master.'; this.save(); return; }
        try { job.rustPreflight = await this.rustPreflight(job); }
        catch (e) { job.status = 'needs_attention'; job.message = `Local Rust preflight failed: ${e.message}`; this.save(); return; }
        job.status = 'submitting'; this.save();
        try {
          const imageUrl = await this.uploadSource(sourceBytes, `${job.id}.png`);
          const prediction = await this.json(`https://api.replicate.com/v1/models/${this.provider.name}/predictions`, { method: 'POST', body: { input: this.provider.buildInput({ imageUrl, factor: job.plan.factor }) } });
          if (!prediction.id || !prediction.urls?.get) throw error('Missing Replicate prediction identifier');
          job.providerId = prediction.id; job.pollingUrl = providerUrl(prediction.urls.get); job.status = 'polling'; job.submittedAt = new Date().toISOString(); this.save();
        } catch (e) { job.status = 'submission_uncertain'; job.message = e.message + ' Check Replicate history; this request will not be resent automatically.'; this.save(); }
        return;
      }
      try {
        const prediction = await this.json(job.pollingUrl);
        if (['failed', 'canceled'].includes(prediction.status)) { job.status = 'failed'; job.message = `Replicate could not complete this master: ${prediction.error || prediction.status}`; this.save(); return; }
        if (prediction.status !== 'succeeded') {
          if (Date.now() - Date.parse(job.submittedAt) > POLL_TIMEOUT_MS) { job.status = 'needs_attention'; job.message = 'Upscale is taking longer than expected. Check Replicate history.'; this.save(); }
          return;
        }
        const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
        if (typeof outputUrl !== 'string') throw error('Replicate returned no output file');
        const response = await this.fetcher(providerUrl(outputUrl, true), { redirect: 'error', signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw error('Could not download the completed master');
        let length = 0; const parts = [];
        for await (const chunk of response.body) { length += chunk.length; if (length > MAX_MASTER_BYTES) throw error('Master exceeds 256 MB'); parts.push(chunk); }
        const bytes = Buffer.concat(parts);
        const dimensions = imageDimensions(bytes);
        const sourceBytes = await this.readSource(job.sourcePath);
        const detail = await detailReport({ sourceBytes, candidateBytes: bytes });
        fs.mkdirSync(this.assetRoot, { recursive: true });
        const hash = crypto.createHash('sha256').update(bytes).digest('hex');
        // Name the file for what the bytes are: a 6x painterly master is only practical as JPEG.
        const fileName = `${job.id}-${hash}.${bytes[0] === 137 ? 'png' : 'jpg'}`;
        fs.writeFileSync(path.join(this.assetRoot, fileName), bytes, { flag: 'wx' });
        Object.assign(job, { dimensions, hash, bytes: bytes.length, assetUrl: '/assets/masters/' + fileName, detail, completedAt: new Date().toISOString() });
        job.status = detail.verdict === 'nothing_added' ? 'master_low_detail' : 'master_ready';
        job.message = detail.verdict === 'nothing_added' ? 'The upscaler added no measurable detail over a plain stretch. Do not sell this as a print file.' : undefined;
        if (job.message === undefined) delete job.message;
        this.save();
        if (job.status === 'master_ready') { try { await this.onReady(job); } catch { job.message = 'Master saved; retry its review check in the review panel.'; this.save(); } }
      } catch (e) { job.message = e.message; job.pollErrors = (job.pollErrors || 0) + 1; if (job.pollErrors >= 5) job.status = 'needs_attention'; this.save(); }
    } finally { this.busy = false; }
  }
}
