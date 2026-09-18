import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { compilePrompt } from './prompt.js';
import { createDownloadToken } from './security.js';
import { validateMidjourneyResult } from './midjourney.js';

export class Journal {
  constructor(file = path.resolve('data/jobs.jsonl')) { this.file = file; fs.mkdirSync(path.dirname(file), { recursive: true }); this.records = new Map(); if (fs.existsSync(file)) for (const line of fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)) { const entry = JSON.parse(line); this.records.set(entry.idempotencyKey, entry); } }
  get(key) { return this.records.get(key); }
  put(job) { this.records.set(job.idempotencyKey, job); fs.appendFileSync(this.file, `${JSON.stringify(job)}\n`); return job; }
}

export class JobQueue {
  constructor({ journal, catalog, renderer, storage, delivery, config }) { Object.assign(this, { journal, catalog, renderer, storage, delivery, config }); this.pending = []; this.processing = false; }
  record(job, stage, status = job.status) {
    job.stage = stage; job.status = status;
    job.timeline = [...(job.timeline || []), { stage, status, at: new Date().toISOString() }];
    this.journal.put(job); return job;
  }
  enqueue(order, { creative } = {}) {
    const idempotencyKey = `${order.store}:${order.orderId}:${order.lineItemId}`;
    const previous = this.journal.get(idempotencyKey);
    if (previous) return { job: previous, duplicate: true };
    const job = { id: crypto.randomUUID(), idempotencyKey, order, creative, status: 'queued', stage: 'intake', attempts: 0, createdAt: new Date().toISOString(), timeline: [{ stage: 'intake', status: 'queued', at: new Date().toISOString() }] };
    this.journal.put(job); this.pending.push(job); void this.drain(); return { job, duplicate: false };
  }
  async drain() { if (this.processing) return; this.processing = true; while (this.pending.length) { const job = this.pending.shift(); try { await this.execute(job); } catch (error) { job.attempts += 1; job.error = error.message; this.record(job, 'operations', job.attempts >= this.config.maxAttempts ? 'failed' : 'retrying'); if (job.status === 'retrying') this.pending.push(job); } } this.processing = false; }
  async execute(job) {
    job.attempts += 1; this.record(job, 'creative', 'working');
    const creative = job.creative || compilePrompt({ productTitle: job.order.productTitle, properties: job.order.properties, catalog: this.catalog });
    job.creative = creative;
    this.record(job, 'rendering', 'working');
    const rendered = await this.renderer.render({ ...creative, order: job.order });
    if (rendered.status === 'awaiting_creation') {
      job.handoff = rendered.handoff;
      this.record(job, 'rendering', 'awaiting_creation');
      return;
    }
    await this.finishRendered(job, rendered);
  }
  async completeCreation(jobId, input) {
    const job = [...this.journal.records.values()].find((entry) => entry.id === jobId);
    if (!job) throw Object.assign(new Error('Creation job not found'), { statusCode: 404 });
    const result = validateMidjourneyResult(input);
    if (job.status === 'artwork_ready' && job.assetUrl === result.assetUrl) return { job, duplicate: true };
    if (job.status !== 'awaiting_creation') throw Object.assign(new Error('Creation result cannot be submitted in the current job state'), { statusCode: 409 });
    Object.assign(job, result, { provider: 'midjourney' });
    this.record(job, 'rendering', 'working');
    if (job.order.store === 'studio') {
      job.completedAt = new Date().toISOString();
      this.record(job, 'safe-preview', 'artwork_ready');
      return { job, duplicate: false };
    }
    await this.finishRendered(job, { assetUrl: result.assetUrl, provider: 'midjourney' });
    return { job, duplicate: false };
  }
  async finishRendered(job, rendered) {
    this.record(job, 'provider-routing', 'working');
    const stored = await this.storage.save(rendered);
    const token = createDownloadToken({ assetUrl: stored.assetUrl, orderId: job.order.orderId, expiresAt: Date.now() + 7 * 86400000 }, this.config.downloadSecret);
    const downloadUrl = `${this.config.baseUrl}/downloads/${token}`;
    this.record(job, 'delivery', 'working');
    await this.delivery.notify({ orderId: job.order.orderId, customerEmail: job.order.customerEmail, downloadUrl, assetUrl: stored.assetUrl, status: 'fulfilled' });
    Object.assign(job, { completedAt: new Date().toISOString(), assetUrl: stored.assetUrl, downloadUrl }); this.record(job, 'complete', 'fulfilled');
  }
}
