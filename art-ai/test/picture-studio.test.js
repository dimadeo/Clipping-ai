import test from 'node:test';
import assert from 'node:assert/strict';
import { pictureStudioScript } from '../src/picture-studio.js';

test('the delivered picture studio script remains syntactically valid', () => {
  const scripts = [...pictureStudioScript.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Function(scripts[0][1]));
});
