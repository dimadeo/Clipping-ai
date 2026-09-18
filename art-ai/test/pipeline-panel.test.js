import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { pipelinePanel, pipelineScript, pipelineStyles } from '../src/pipeline-panel.js';

const source = pipelineScript.replace(/^<script>\s*/, '').replace(/\s*<\/script>$/, '');
const stageIds = [...pipelinePanel.matchAll(/data-pipeline-stage="([^"]+)"/g)].map(match => match[1]);
const fixture = () => ({
  checkedAt: '2026-09-12T15:00:00.000Z',
  summary: { total: 2, pending: 1, approved: 1, rejected: 0, queued: 0, running: 0, failed: 0 },
  stages: stageIds.map((id, index) => ({ id, number: index + 1, title: id, status: 'ready', count: 2, detail: 'Saved stage information', canCheckArtwork: ['originals', 'resolution', 'pricing'].includes(id), openHash: '#production-review' })),
  systems: [{ id: 'langchain', name: 'LangChain', role: 'Model tools', status: 'ready', installed: true, version: '1.0', configured: false, verified: false, detail: 'Installed package; no verified model connection.' }],
  artworks: [{ id: 'one', title: 'One', hasLocalOriginal: true, hasQuality: true, width: 192, height: 256, price: '69.00' }], issues: [],
});

class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.handlers = new Map(); this.textContent = ''; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this.replacements = 0; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.replacements++; this.children = []; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.handlers.set(name, callback); }
  dispatch(name) { return this.handlers.get(name)?.(); }
  getClientRects() { return this.visible === false ? [] : [{}]; }
  querySelector(selector) {
    return this.children.find(child => selector.startsWith('.') ? child.className === selector.slice(1) : selector === '[data-empty]' ? child.dataset.empty : selector === '[data-pipeline-status]' ? child.isStatus : selector === '[data-pipeline-count]' ? child.isCount : false) || null;
  }
}

function browser(initial = fixture()) {
  const elements = new Map([...pipelinePanel.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element()]));
  const root = elements.get('pipeline-control'), buttons = new Map(), timers = new Map(), requests = [];
  const document = { visibilityState: 'visible', activeElement: null, querySelector: () => root, createElement: tag => new Element(tag), addEventListener() {} };
  for (const id of stageIds) {
    const button = new Element('button'); button.dataset.pipelineStage = id;
    const title = new Element('span'); title.className = 'pipeline-stage-title';
    const status = new Element('span'); status.isStatus = true;
    const count = new Element('span'); count.isCount = true;
    button.append(title, status, count); buttons.set(id, button);
  }
  root.querySelector = selector => elements.get(selector.slice(1));
  root.querySelectorAll = () => [...buttons.values()];
  let next = initial, timerId = 0;
  const context = vm.createContext({
    document, window: { addEventListener() {} }, AbortController,
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (next instanceof Error) throw next;
      const data = structuredClone(next);
      return { ok: true, json: async () => url.endsWith('/check') ? { snapshot: data, message: 'Check completed.' } : data };
    },
  });
  vm.runInContext(source, context);
  return {
    elements, buttons, document, root, requests, timers,
    setResponse(value) { next = value; },
    async flush() { await new Promise(resolve => setImmediate(resolve)); },
    async click(id) { await elements.get(id).dispatch('click'); },
    async poll() { const entry = [...timers.entries()].find(([, timer]) => timer.delay === 15000); assert.ok(entry); timers.delete(entry[0]); entry[1].callback(); await new Promise(resolve => setImmediate(resolve)); },
  };
}

test('pipeline exports a parseable, self-contained and labelled 17-stage interface', () => {
  assert.doesNotThrow(() => new Function(source));
  assert.equal(new Set(stageIds).size, 17);
  assert.equal(stageIds[0], 'brief'); assert.equal(stageIds.at(-1), 'monitoring');
  assert.match(pipelinePanel, /<ol class="pipeline-flow" aria-label="The 17 stages in order">/);
  assert.match(pipelinePanel, /role="alert"/);
  assert.match(pipelinePanel, /Restart monitoring restarts status updates only/);
  assert.match(pipelineStyles, /clip-path:polygon\(/);
  assert.match(pipelineStyles, /prefers-reduced-motion/);
  assert.doesNotMatch(pipelinePanel + pipelineStyles + pipelineScript, /https?:\/\/|innerHTML|insertAdjacentHTML|document\.write/);
});

test('polling and restart request status only, while pause and hidden views stop requests', async () => {
  const app = browser(); await app.flush();
  assert.equal(app.requests.length, 1);
  await app.poll(); assert.equal(app.requests.length, 2);
  await app.click('pipeline-pause'); await app.poll(); assert.equal(app.requests.length, 2);
  await app.click('pipeline-restart'); await app.flush(); assert.equal(app.requests.length, 3);
  app.document.visibilityState = 'hidden'; await app.poll(); assert.equal(app.requests.length, 3);
  app.document.visibilityState = 'visible'; app.root.visible = false; await app.poll(); assert.equal(app.requests.length, 3);
  assert.ok(app.requests.every(call => call.url === '/api/pipeline/status' && call.options.method === undefined));
  assert.ok(app.requests.every(call => call.options.signal instanceof AbortSignal));
});

test('stage checks omit artwork IDs and explicit rechecks are restricted to supported stages', async () => {
  const app = browser(); await app.flush();
  app.buttons.get('originals').dispatch('click');
  const select = app.elements.get('pipeline-artwork'); select.value = 'one'; select.dispatch('change');
  await app.click('pipeline-check');
  assert.deepEqual(JSON.parse(app.requests.at(-1).options.body), { stageId: 'originals' });
  await app.click('pipeline-recheck');
  assert.deepEqual(JSON.parse(app.requests.at(-1).options.body), { stageId: 'originals', artworkId: 'one' });
  const count = app.requests.length;
  app.buttons.get('publishing').dispatch('click');
  await app.click('pipeline-recheck');
  assert.equal(app.requests.length, count);
  assert.equal(app.elements.get('pipeline-artwork-controls').hidden, true);
  app.buttons.get('provider').dispatch('click');
  assert.equal(app.elements.get('pipeline-check').textContent, 'Check BFL connection');
  assert.match(app.elements.get('pipeline-check-note').textContent, /account access and credits/);
  await app.click('pipeline-check');
  assert.deepEqual(JSON.parse(app.requests.at(-1).options.body), { stageId: 'provider' });
  assert.ok(app.requests.every(call => ['/api/pipeline/status', '/api/pipeline/check'].includes(call.url)));
});

test('failed refresh keeps the successful timestamp, stops automatic retry, and permits manual recovery', async () => {
  const app = browser(); await app.flush();
  const stamp = app.elements.get('pipeline-last-success').textContent;
  app.setResponse(new Error('Connection unavailable'));
  await app.click('pipeline-refresh');
  assert.equal(app.elements.get('pipeline-last-success').textContent, stamp);
  assert.equal(app.elements.get('pipeline-error').hidden, false);
  assert.equal(app.elements.get('pipeline-loading').hidden, true);
  assert.equal(app.elements.get('pipeline-refresh').disabled, false);
  const count = app.requests.length; await app.poll(); assert.equal(app.requests.length, count);
  app.setResponse({ ...fixture(), checkedAt: '2026-09-12T16:00:00.000Z' });
  await app.click('pipeline-refresh');
  assert.equal(app.elements.get('pipeline-error').hidden, true);
  assert.notEqual(app.elements.get('pipeline-last-success').textContent, stamp);
});

test('refresh preserves selection and uses text for external labels while refusing unsafe stage links', async () => {
  const first = fixture(), app = browser(first); await app.flush();
  app.buttons.get('originals').dispatch('click');
  const select = app.elements.get('pipeline-artwork'); select.value = 'one'; select.dispatch('change');
  const replacements = select.replacements;
  await app.click('pipeline-refresh');
  assert.equal(select.replacements, replacements);
  assert.equal(select.value, 'one');
  assert.equal(app.buttons.get('originals').attributes['aria-pressed'], 'true');
  const changed = fixture();
  changed.artworks.push({ id: 'two', title: '<img src=x onerror=alert(1)>' });
  changed.stages.find(stage => stage.id === 'originals').openHash = 'javascript:alert(1)';
  changed.systems[0].name = '<script>untrusted</script>';
  app.document.activeElement = select;
  app.setResponse(changed); await app.click('pipeline-refresh');
  assert.equal(select.replacements, replacements, 'An open selection must not be rebuilt by polling');
  assert.equal(app.elements.get('pipeline-open').hidden, true);
  assert.equal(app.elements.get('pipeline-open').attributes.href, undefined);
  app.document.activeElement = null; select.dispatch('blur');
  assert.equal(select.value, 'one');
  assert.equal(select.children.at(-1).textContent, '<img src=x onerror=alert(1)>');
  const card = app.elements.get('pipeline-systems').children[0];
  assert.equal(card.children[0].textContent, '<script>untrusted</script>');
});
