import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePrompt } from '../src/prompt.js';
import { validShopifySignature } from '../src/security.js';
import { JobQueue, Journal } from '../src/engine.js';
import { CreativeMemory, CreativePromptAgent } from '../src/creative-agent.js';
import { LangGraphCreativeOrchestrator } from '../src/langchain-orchestrator.js';
import crypto from 'node:crypto';

test('compiles a catalog prompt with deterministic seed', () => {
  const catalog = new Map([['test work', { Subject: 'a test subject', Full_Automated_Prompt: 'test --ar 3:4 --stylize 600', Negative_Prompt: '--no watermark', Aspect_Ratio_DPI: '--ar 3:4' }]]);
  const result = compilePrompt({ productTitle: 'Test Work', properties: {}, catalog });
  assert.equal(result.aspectRatio, '3:4'); assert.equal(result.negativePrompt, '--no watermark'); assert.equal(result.seed, compilePrompt({ productTitle: 'Test Work', properties: {}, catalog }).seed);
});

test('accepts only the correct Shopify HMAC', () => {
  const raw = '{"id":1}'; const secret = 'secret';
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  assert.equal(validShopifySignature(raw, signature, secret), true);
  assert.equal(validShopifySignature(raw, signature, 'wrong'), false);
});

test('records visible control-room stages during fulfillment', async () => {
  const writes = []; const journal = { get: () => undefined, put: (job) => { writes.push({ ...job }); } };
  const queue = new JobQueue({ journal, catalog: new Map(), config: { maxAttempts: 1, baseUrl: 'http://localhost:3000', downloadSecret: 'test' }, renderer: { render: async () => ({ assetUrl: 'file://asset' }) }, storage: { save: async (asset) => asset }, delivery: { notify: async () => ({ delivered: true }) } });
  const { job } = queue.enqueue({ store: 'shopify', orderId: '1', lineItemId: '2', customerEmail: 'buyer@example.com', productTitle: 'Test Work', properties: {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(job.status, 'fulfilled'); assert.equal(job.stage, 'complete'); assert.deepEqual(job.timeline.map((event) => event.stage), ['intake', 'creative', 'rendering', 'provider-routing', 'delivery', 'complete']);
});

test('creative agent produces varied directions and learns from explicit feedback', () => {
  const agent = new CreativePromptAgent({ memory: new CreativeMemory(null) });
  const output = agent.create({ subject: 'a sculptural amber orchid', goal: 'create an elegant luxury-art concept', palette: 'obsidian, amber and gold' });
  assert.equal(output.candidates.length, 3);
  assert.notEqual(output.candidates[0].prompt, output.candidates[1].prompt);
  agent.learn({ promptId: output.promptId, score: 5, tags: ['editorial restraint'] });
  assert.deepEqual(agent.insights().preferredDirections, ['editorial restraint']);
});

test('LangGraph keeps creative work waiting for the owner approval', async () => {
  const agent = new CreativePromptAgent({ memory: new CreativeMemory(null) });
  const orchestrator = new LangGraphCreativeOrchestrator({ creativeAgent: agent, apiKey: '' });
  const output = await orchestrator.run({ subject: 'a monochrome gallery portrait' });
  assert.equal(output.candidates.length, 3);
  assert.equal(output.orchestration.approval.status, 'awaiting_owner_approval');
  assert.deepEqual(output.orchestration.trace.map((event) => event.node), [
    'understand_brief', 'create_directions', 'art_director_review', 'await_owner_approval'
  ]);
});
