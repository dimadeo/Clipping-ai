import fs from 'node:fs/promises';
import path from 'node:path';
import { buildMidjourneyHandoff } from './midjourney.js';

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  return response.json();
}

export class Renderer {
  constructor(config) { this.config = config; }
  async render(input) {
    if (this.config.creationExecutor === 'midjourney') {
      return { status: 'awaiting_creation', provider: 'midjourney', handoff: buildMidjourneyHandoff(input) };
    }
    if (this.config.creationExecutor !== 'local' && this.config.rendererEndpoint) return postJson(this.config.rendererEndpoint, input, { authorization: `Bearer ${this.config.rendererApiKey}` });
    const id = `${input.order.orderId}-${input.order.lineItemId}.json`;
    const output = path.resolve('data/rendered', id);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify({ generatedAt: new Date().toISOString(), ...input }, null, 2));
    return { assetUrl: `file://${output}`, provider: 'local-manifest' };
  }
}

export class Storage {
  constructor(config) { this.config = config; }
  async save(rendered) {
    return this.config.storageEndpoint ? postJson(this.config.storageEndpoint, rendered) : rendered;
  }
}

export class Delivery {
  constructor(config) { this.config = config; }
  async notify(payload) {
    if (this.config.deliveryWebhookUrl) await postJson(this.config.deliveryWebhookUrl, payload);
    return { delivered: true, mode: this.config.deliveryWebhookUrl ? 'webhook' : 'local' };
  }
}
