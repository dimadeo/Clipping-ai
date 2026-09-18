import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PictureDrafts, pictureFormat } from '../src/picture-drafts.js';
import { highestFluxSize } from '../src/creation-formats.js';

function setup(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dmas-picture-plans-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const records=[{id:'a',name:'Portrait.jpg',width:1000,height:1500},{id:'b',name:'Room.png',width:1600,height:1000}];
  const pictures={get(id){const p=records.find(p=>p.id===id);if(!p)throw Error('Picture missing');return p;}};
  const file=path.join(root,'drafts.json');
  return {drafts:new PictureDrafts({pictures,file}),pictures,file};
}
const brief={pictureIds:['a','b'],mode:'collection',title:'Quiet mornings',instructions:'Make soft black and white ink studies.',aspectRatio:'source'};
test('collection maps one ordered picture to each artwork and retains its shape',t=>{
  const {drafts}=setup(t);const result=drafts.prepare(brief);
  assert.equal(result.artworks.length,2);
  assert.deepEqual(result.artworks.map(a=>a.referenceIds),[['a'],['b']]);
  assert.deepEqual(result.artworks.map(a=>a.aspectRatio),['2:3','8:5']);
  assert.ok(result.artworks.every(a=>a.prompt.includes(brief.instructions)&&a.prompt.includes('Do not make a collage')));
  assert.equal(result.mode,'collection');
});
test('one artwork includes all selected references once and survives restart',t=>{
  const {drafts,pictures,file}=setup(t);const result=drafts.prepare({...brief,mode:'single',aspectRatio:'1:1'});
  assert.equal(result.artworks.length,1);assert.deepEqual(result.artworks[0].referenceIds,['a','b']);
  assert.equal(result.artworks[0].aspectRatio,'1:1');
  assert.deepEqual(new PictureDrafts({pictures,file}).get(result.id),result);
  result.artworks[0].prompt='changed';assert.notEqual(drafts.get(result.id).artworks[0].prompt,'changed');
});
test('invalid picture selections and missing transformations cannot create a plan',t=>{
  const {drafts}=setup(t);
  for(const change of [{pictureIds:[]},{pictureIds:['a','a']},{pictureIds:Array(9).fill('a')},{pictureIds:['missing']},{mode:'bad'},{title:''},{instructions:''},{instructions:'x'.repeat(9001)},{aspectRatio:'bad'}])assert.throws(()=>drafts.prepare({...brief,...change}));
  assert.equal(drafts.drafts.length,0);
});
test('nonstandard photos get aligned near-original proportions and realistic dimensions',()=>{
  for(const [width,height] of [[1600,1607],[3840,2161],[1067,1600],[4000,3000],[134,670],[71,367]]){
    const format=pictureFormat({width,height});
    assert.ok(format.generation.width%16===0&&format.generation.height%16===0);
    assert.ok(Math.abs(format.generation.width/format.generation.height/(width/height)-1)<.02);
    assert.deepEqual(highestFluxSize(format.aspectRatio),format.generation);
  }
  assert.throws(()=>pictureFormat({width:10000,height:64}),/panoramic/);
});
test('resolution presets request lower pixel counts and custom pixels define the exact output',t=>{
  const {drafts}=setup(t);
  for(const [resolution,limit] of [['1mp',1_000_000],['2mp',2_000_000]]){
    const result=drafts.prepare({...brief,resolution});
    assert.ok(result.artworks.every(a=>a.generation.width*a.generation.height<=limit));
    const square=pictureFormat({width:400,height:600},'1:1',{resolution});
    assert.equal(square.generation.width,square.generation.height);
    assert.ok(square.generation.width*square.generation.height<=limit);
  }
  const result=drafts.prepare({...brief,resolution:'custom',pixelWidth:1024,pixelHeight:1536,aspectRatio:'1:1'});
  assert.ok(result.artworks.every(a=>a.aspectRatio==='2:3'&&a.generation.width===1024&&a.generation.height===1536));
  for(const [pixelWidth,pixelHeight] of [[8000,4000],[2048,4096],[100,100],[0,1024],['1024',1024],[NaN,1024]])assert.throws(()=>drafts.prepare({...brief,resolution:'custom',pixelWidth,pixelHeight}),/Custom pixels/);
  assert.throws(()=>drafts.prepare({...brief,resolution:'8k'}),/output resolution/);
});
