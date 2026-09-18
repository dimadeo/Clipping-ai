import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveArtworkRatio } from '../src/prompt-shape.js';
import { highestFluxSize, FLUX_MAX_PIXELS } from '../src/creation-formats.js';
import { CreativeMemory, CreativePromptAgent } from '../src/creative-agent.js';
import { LangGraphCreativeOrchestrator } from '../src/langchain-orchestrator.js';
import { buildMidjourneyHandoff } from '../src/midjourney.js';

const examples = [
  ['01 — BLUE HOUR', 'Landscape orientation, width-to-height ratio 7:5; intended physical size 70 × 50 cm.', '7:5'],
  ['02 — AFTER EVERYONE LEFT', 'Landscape ratio 5:4; intended size 50 × 40 cm.', '5:4'],
  ['03 — TWELVE QUIET PLACES', 'Generate one artwork for this batch. Landscape ratio 4:3; intended size 20 × 15 cm.', '4:3'],
  ['04 — THE ROOM REMEMBERS', 'Portrait ratio 3:4; intended size 60 × 80 cm.', '3:4'],
  ['05 — INHERITED THREADS', 'Portrait ratio 5:7; intended size 50 × 70 cm.', '5:7'],
  ['06 — CITY BENEATH THE CITY', 'Portrait ratio 4:5; intended size 40 × 50 cm.', '4:5'],
  ['07 — WEATHER WITHIN', 'Landscape ratio 6:5; intended size 120 × 100 cm.', '6:5'],
  ['08 — GARDEN AFTER RAIN', 'Portrait ratio 2:3; intended size 40 × 60 cm.', '2:3'],
  ['09 — SMALL GUARDIANS', 'One original ceramic sculpture approximately 20 cm tall. Square image.', '1:1'],
  ['10 — SUNDAY, REMEMBERED', 'Portrait ratio 3:4; intended size 60 × 80 cm.', '3:4']
];

test('each of the ten artwork prompts supplies its own ratio through compilation and handoff', () => {
  const agent = new CreativePromptAgent({ memory: new CreativeMemory(null) });
  for (const [title, description, expected] of examples) {
    const subject = `${title}\nCreate an original fine-art concept. ${description}`;
    assert.equal(resolveArtworkRatio(subject), expected, title);
    // A stale form value must never override the ratio explicitly in the prompt.
    const result = agent.create({ subject, aspectRatio: '16:9' });
    assert.equal(result.brief.aspectRatio, expected, title);
    for (const candidate of result.candidates) {
      const handoff = buildMidjourneyHandoff({ compiledPrompt: candidate.prompt, aspectRatio: result.brief.aspectRatio });
      assert.equal(handoff.aspectRatio, expected, title);
      assert.ok(handoff.prompt.includes(` --ar ${expected} `), title);
    }
    const { width, height } = highestFluxSize(expected);
    const [w, h] = expected.split(':').map(Number);
    assert.equal(width * h, height * w, title);
    assert.equal(width % 16, 0, title);
    assert.equal(height % 16, 0, title);
    assert.ok(width * height <= FLUX_MAX_PIXELS, title);
  }
});

test('equivalent ratio and physical-size hints normalize consistently', () => {
  assert.equal(resolveArtworkRatio('Landscape ratio 14 : 10; intended size 70 x 50 cm.'), '7:5');
  assert.equal(resolveArtworkRatio('Create a textile artwork measuring 50 × 70 cm.'), '5:7');
  assert.equal(resolveArtworkRatio('A composition --ar 12:10'), '6:5');
  assert.equal(resolveArtworkRatio('Square artwork, ratio 40:40.'), '1:1');
  assert.deepEqual(highestFluxSize('70:50'), highestFluxSize('7:5'));
  assert.deepEqual(highestFluxSize('120:100'), highestFluxSize('6:5'));
});

test('conflicting hints and numbered multi-artwork input require clarification', () => {
  assert.throws(() => resolveArtworkRatio('Ratio 7:5; intended size 50 × 70 cm.'), /Conflicting/);
  assert.throws(() => resolveArtworkRatio('Square image. Ratio 4:5.'), /Conflicting/);
  const batch = examples.map(([title, description]) => `${title}\n${description}`).join('\n\n');
  assert.throws(() => resolveArtworkRatio(batch), /Multiple artwork prompts detected/);
  assert.throws(() => new CreativePromptAgent({ memory: new CreativeMemory(null) }).create({ subject: batch }), /Multiple artwork prompts detected/);
});

test('a free shape remains unset and does not inject a portrait ratio into handoffs', () => {
  const subject = 'A luminous abstract botanical painting with generous negative space.';
  assert.equal(resolveArtworkRatio(subject), null);
  assert.equal(resolveArtworkRatio('A ceramic sculpture approximately 20 cm tall.'), null);
  const agent = new CreativePromptAgent({ memory: new CreativeMemory(null) });
  for (const aspectRatio of [undefined, null, '', 'auto']) {
    const result = agent.create({ subject, aspectRatio });
    assert.equal(result.brief.aspectRatio, null);
    for (const candidate of result.candidates) {
      assert.doesNotMatch(candidate.prompt, /--ar\b/);
      const handoff = buildMidjourneyHandoff({ compiledPrompt: candidate.prompt, aspectRatio: result.brief.aspectRatio });
      assert.equal(handoff.aspectRatio, null);
      assert.doesNotMatch(handoff.prompt, /--ar\b/);
    }
  }
  assert.throws(() => highestFluxSize(null), /Add a ratio/);
});

test('manual ratio remains available when the prompt provides no shape', () => {
  const agent = new CreativePromptAgent({ memory: new CreativeMemory(null) });
  const result = agent.create({ subject: 'Quiet sea and luminous horizon.', aspectRatio: '7:5' });
  assert.equal(result.brief.aspectRatio, '7:5');
});

test('invalid and extreme ratios cannot produce impossible FLUX dimensions', () => {
  for (const prompt of ['Ratio 0:5.', 'Ratio 4:0.', 'Ratio 10001:1.']) {
    assert.throws(() => resolveArtworkRatio(prompt), /positive width:height ratio/);
  }
  for (const ratio of ['bad', '0:1', '1:0', '-4:5', '10001:1', '10000:1', '9999:9998']) {
    assert.throws(() => highestFluxSize(ratio));
  }
});

test('long complete prompt and its final ratio survive local orchestration without any provider request', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No provider request is allowed while preparing this brief.'); });
  const subject = 'Layered pigment, expressive restrained marks, subtle reflected light. '.repeat(18) + 'Final instruction: landscape ratio 7:5; intended size 70 × 50 cm.';
  assert.ok(subject.indexOf('ratio 7:5') > 700);
  const agent = new CreativePromptAgent({ memory: new CreativeMemory(null) });
  const orchestrator = new LangGraphCreativeOrchestrator({ creativeAgent: agent, apiKey: '' });
  const result = await orchestrator.run({ subject, aspectRatio: 'auto' });
  assert.equal(result.brief.subject, subject);
  assert.equal(result.brief.aspectRatio, '7:5');
  assert.equal(result.orchestration.approval.status, 'awaiting_owner_approval');
  assert.ok(result.candidates.every(candidate => candidate.prompt.includes(subject)));
  assert.equal(request.mock.callCount(), 0);
});
