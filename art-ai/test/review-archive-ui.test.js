import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewScript, reviewPanel } from '../src/review-panel.js';
import { canvasScript } from '../src/canvas-studio.js';
test('review defaults to pending, filters decided images and offers backup folders',()=>{
  const source=reviewScript.replace(/^<script>/,'').replace(/<\/script>$/,'');new Function(source);
  assert.match(source,/let zone='pending'/);
  assert.match(source,/data\.artworks\.filter\(item=>zoneOf\(item\)===zone\)/);
  assert.match(reviewPanel,/Approved \/ Shopify queue/);assert.match(reviewPanel,/data-review-zone="rejected"/);
  assert.doesNotMatch(canvasScript,/section\.id==='production-review'\|\|section\.classList\.contains\('approval-studio'\)/);
});
