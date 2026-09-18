import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProductionReview, imageDimensions, resolutionReport } from '../src/production-review.js';

test('resolution score does not call small files UHD or print-ready', () => {
  const report = resolutionReport({ width:1122, height:1402 });
  assert.equal(report.maxPrintCm, '9.5 × 11.9 cm');
  assert.ok(report.score < 40);
  assert.ok(report.sizes.every(size => !size.meets300Ppi));
  assert.throws(() => imageDimensions(Buffer.from('not an image')));
});

test('human approval is bound to inspected bytes, price and visual score; persists through restart', async () => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'dmas-review-'));
  const assets=path.join(folder,'assets');fs.mkdirSync(assets);
  const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(1122,16);bytes.writeUInt32BE(1402,20);
  const image=path.join(assets,'sample.png');fs.writeFileSync(image,bytes);
  const options={file:path.join(folder,'reviews.json'),assetRoot:assets,sources:()=>[{id:'one',title:'A & B',assetUrl:'/assets/sample.png'}]};
  const review=new ProductionReview(options);
  await assert.rejects(review.decide('one',{decision:'approved'}));
  const inspected=await review.inspect('one');
  await assert.rejects(review.decide('one',{decision:'approved',hash:inspected.hash,price:18,visualScore:8}));
  const approval={decision:'approved',hash:inspected.hash,price:18,visualScore:8,visualConfirmed:true};
  const approved=await review.decide('one',approval);
  assert.equal(approved.product.price,'18.00');
  assert.equal(approved.product.requiresShipping,false);
  assert.match(approved.product.descriptionHtml,/A &amp; B/);
  assert.equal(new ProductionReview(options).list()[0].approval.hash,inspected.hash);
  review.records.one.checkedAt='2000-01-01T00:00:00.000Z';
  review.records.one.quality.score=999;
  const rechecked=await review.inspect('one');
  assert.equal(rechecked.fileChanged,false);
  assert.notEqual(rechecked.checkedAt,'2000-01-01T00:00:00.000Z');
  assert.ok(rechecked.quality.score<100);
  assert.equal(rechecked.approval.hash,inspected.hash);
  assert.equal(rechecked.product.price,'18.00');
  assert.equal(new ProductionReview(options).list()[0].checkedAt,rechecked.checkedAt);
  bytes.writeUInt32BE(1200,16);fs.writeFileSync(image,bytes);
  await assert.rejects(review.decide('one',approval),/changed/);
  const checked=await review.inspect('one');
  assert.equal(checked.fileChanged,true);
  assert.equal(checked.quality.width,1200);
  assert.equal(checked.approval,undefined);
  assert.equal(checked.product,undefined);
});

test('failed recheck does not replace a previous quality report or approval', async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'dmas-review-failure-'));
  const assetRoot=path.join(folder,'assets');fs.mkdirSync(assetRoot);
  const file=path.join(assetRoot,'one.png');
  const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(1200,16);bytes.writeUInt32BE(1500,20);fs.writeFileSync(file,bytes);
  const review=new ProductionReview({file:path.join(folder,'reviews.json'),assetRoot,sources:()=>[{id:'one',title:'Test',assetUrl:'/assets/one.png'}]});
  const first=await review.inspect('one');
  const previous=JSON.stringify(first);
  fs.writeFileSync(file,'not an image');
  await assert.rejects(review.inspect('one'),/PNG or JPEG/);
  assert.equal(JSON.stringify(review.records.one),previous);
});
