import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { RustImageCore } from '../src/rust-image-core.js';

test('Rust image core inspects a source and plans multi-pass scaling', async () => {
  const source = path.resolve('fixtures', 'source.png');
  const calls = [];
  const runner = async (command, args, options) => {
    calls.push({ command, args, options });
    if (args.includes('inspect')) {
      return { stdout: `path=${source} width=1792 height=2240 sha256=${'a'.repeat(64)}` };
    }
    return { stdout: 'passes=4.0000,1.5000' };
  };
  const core = new RustImageCore({ enabled: true, directory: path.resolve('native-core'), runner });

  const result = await core.preflight({ source, longEdge: 2240, target: 13440, maxScale: 4, maxPasses: 4 });

  assert.deepEqual(result, {
    inspection: { width: 1792, height: 2240, sha256: 'a'.repeat(64) },
    passes: [4, 1.5],
  });
  assert.deepEqual(calls[0].args, ['run', '--quiet', '--', 'inspect', source]);
  assert.deepEqual(calls[1].args, ['run', '--quiet', '--', 'plan', '--long-edge', '2240', '--target', '13440', '--max-scale', '4', '--max-passes', '4']);
  assert.equal(calls[0].options.windowsHide, true);
});

test('Rust image core rejects invalid plans before starting a command', async () => {
  let called = false;
  const core = new RustImageCore({ enabled: true, runner: async () => { called = true; } });

  await assert.rejects(core.plan({ longEdge: 0, target: 1000 }), /Long edge must be a positive integer/);
  assert.equal(called, false);
});