import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewPanel, reviewScript } from '../src/review-panel.js';
import { readUserGuide } from '../src/user-guide.js';
import { MARKET_COMPARABLES } from '../src/pricing-market.js';
import { suggestArtworkPrice } from '../src/artwork-pricing.js';

test('pricing controls expose evidence and reset approval when the human price changes',()=>{
  assert.doesNotThrow(()=>new Function(reviewScript.replace(/^<script>/,'').replace(/<\/script>$/,'')));
  assert.match(reviewPanel,/Existing approved prices stay unchanged/);
  assert.match(reviewScript,/Why this price\? Market comparisons & limits/);
  assert.match(reviewScript,/price\.value=item\.pricing\.amount;confirmed\.checked=false/);
  assert.match(reviewScript,/\[title,price,score\].*addEventListener\('input'.*confirmed\.checked=false/);
  assert.match(reviewScript,/source\.licenseNote/);
  assert.match(reviewScript,/Check individual print sizes/);
  assert.ok(readUserGuide().some(file=>file.name==='Pricing Guide.md'));
});

test('curated initial market snapshot is USD single-design evidence, dated and usable',()=>{
  assert.equal(MARKET_COMPARABLES.length,3);
  assert.equal(new Set(MARKET_COMPARABLES.map(s=>s.seller)).size,3);
  for(const source of MARKET_COMPARABLES){
    assert.equal(source.currency,'USD');assert.equal(source.productKind,'single-digital-download');
    assert.ok(source.printSizeNote);assert.ok(source.licenseNote);assert.match(source.url,/^https:\/\//);
  }
  const price=suggestArtworkPrice({width:3000,height:4500},{now:'2026-09-12T12:00:00Z'});
  assert.equal(price.status,'suggested');assert.equal(price.market.medianUsd,10);assert.equal(price.amount,'10.00');
  const expired=suggestArtworkPrice({width:3000,height:4500},{now:'2026-12-12T12:00:00Z'});
  assert.equal(expired.status,'unavailable');assert.equal(expired.amount,null);
});
