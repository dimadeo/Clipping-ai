import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProductionReview, reviewZone } from '../src/production-review.js';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dmas-review-archive-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const assetRoot=path.join(root,'assets');fs.mkdirSync(assetRoot);
  const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(1200,16);bytes.writeUInt32BE(1500,20);
  fs.writeFileSync(path.join(assetRoot,'image.png'),bytes);
  const options={file:path.join(root,'reviews.json'),assetRoot,sources:()=>[{id:'one',title:'Archive example',assetUrl:'/assets/image.png'}]};
  return {root,bytes,options,review:new ProductionReview(options)};
}
const approved=hash=>({decision:'approved',hash,price:18,visualScore:9,visualConfirmed:true});
test('approval creates a byte-identical backup, exits pending and queues Shopify without publishing',async t=>{
  const {root,bytes,review,options}=fixture(t);const inspected=await review.inspect('one');
  const record=await review.decide('one',approved(inspected.hash));
  assert.equal(reviewZone(record),'approved');assert.equal(record.archive.bucket,'Approved');
  assert.deepEqual(fs.readFileSync(path.join(root,'Approved',record.archive.fileName)),bytes);
  assert.deepEqual(review.archiveFile('Approved',record.archive.fileName).bytes,bytes);
  assert.equal(record.workflow.stage,'shopify_pending');assert.equal(record.product.publicationStatus,'blocked_connection');
  assert.equal(new ProductionReview(options).list().filter(a=>reviewZone(a)==='pending').length,0);
  assert.ok(fs.existsSync(path.join(options.assetRoot,'image.png')));
});
test('rejection creates a backup and removes any previous approval and Shopify queue entry',async t=>{
  const {root,bytes,review}=fixture(t);const inspected=await review.inspect('one');
  const first=await review.decide('one',approved(inspected.hash));
  const rejected=await review.decide('one',{decision:'rejected',hash:inspected.hash});
  assert.equal(reviewZone(rejected),'rejected');assert.equal(rejected.product,null);assert.equal(rejected.approval,null);
  assert.equal(rejected.workflow.stage,'rejected_archive');assert.equal(rejected.archive.bucket,'Rejected');
  assert.deepEqual(fs.readFileSync(path.join(root,'Rejected',rejected.archive.fileName)),bytes);
  assert.ok(fs.existsSync(path.join(root,'Approved',first.archive.fileName)),'earlier backup is retained');
});
test('failed backups leave the decision pending rather than claiming success',async t=>{
  const {review,root}=fixture(t);const inspected=await review.inspect('one');
  fs.writeFileSync(path.join(root,'Approved'),'not a directory');
  await assert.rejects(review.decide('one',approved(inspected.hash)));
  assert.equal(reviewZone(review.records.one),'pending');assert.equal(review.records.one.approval,undefined);
});
test('rejecting a changed file is refused, and reinspection restores pending while backups remain',async t=>{
  const {review,root,options,bytes}=fixture(t);const inspected=await review.inspect('one');
  const first=await review.decide('one',approved(inspected.hash));
  const changed=Buffer.from(bytes);changed.writeUInt32BE(1300,16);fs.writeFileSync(path.join(options.assetRoot,'image.png'),changed);
  await assert.rejects(review.decide('one',{decision:'rejected',hash:inspected.hash}),/changed/);
  const rechecked=await review.inspect('one');assert.equal(reviewZone(rechecked),'pending');assert.equal(rechecked.workflow,undefined);
  assert.deepEqual(fs.readFileSync(path.join(root,'Approved',first.archive.fileName)),bytes);
});
test('earlier decisions migrate idempotently and changed originals are returned to review',async t=>{
  const {review,options,bytes}=fixture(t);const inspected=await review.inspect('one');
  review.records.one.status='rejected';review.save();
  const first=await review.archiveDecisions();assert.equal(first.archived,1);assert.equal(first.errors.length,0);
  const again=await review.archiveDecisions();assert.equal(again.archived,0);assert.equal(again.alreadyBackedUp,1);
  const changed=Buffer.from(bytes);changed.writeUInt32BE(1300,16);fs.writeFileSync(path.join(options.assetRoot,'image.png'),changed);
  assert.equal((await review.archiveDecisions()).returnedToReview,1);assert.equal(reviewZone(review.records.one),'pending');
  assert.notEqual(review.records.one.hash,inspected.hash);
});
test('archive file access rejects traversal and damaged backups',async t=>{
  const {review,root}=fixture(t);const inspected=await review.inspect('one');const record=await review.decide('one',approved(inspected.hash));
  assert.throws(()=>review.archiveFile('../','private'),/Invalid/);
  assert.throws(()=>review.archiveFile('Approved','../../.env'),/Invalid/);
  fs.writeFileSync(path.join(root,'Approved',record.archive.fileName),'corrupted');
  assert.throws(()=>review.archiveFile('Approved',record.archive.fileName),/integrity/);
});
