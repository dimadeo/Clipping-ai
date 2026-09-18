import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FluxStudio, fluxSize } from '../src/flux.js';

const artworks=()=>[
  {number:1,title:'Blue Hour',prompt:'An oil seascape. Landscape ratio 7:5.',aspectRatio:'7:5'},
  {number:2,title:'Weather Within',prompt:'A textured abstract painting. Landscape ratio 6:5.',aspectRatio:'6:5'},
  {number:3,title:'Small Guardians',prompt:'One ceramic sculpture on a neutral studio background. Square image.',aspectRatio:'1:1'}
];
function setup(t,fetcher=async()=>{throw Error('Unexpected network request');},key='test') {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'dmas-flux-batch-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  return new FluxStudio({key,file:path.join(folder,'jobs.json'),assetRoot:path.join(folder,'assets'),fetcher});
}
function png() {
  const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(2048,16);bytes.writeUInt32BE(2048,20);return bytes;
}

test('batch creates one ordered job per prompt with its own dimensions and numbered title',async t=>{
  const payloads=[],reviewed=[];
  const studio=setup(t,async(url,options)=>{
    if(options.method==='POST'){
      payloads.push(JSON.parse(options.body));
      return Response.json({id:`job-${payloads.length}`,polling_url:`https://api.bfl.ai/v1/get_result?id=job-${payloads.length}`});
    }
    if(url.includes('delivery.')){assert.equal(options.headers,undefined);return new Response(png());}
    return Response.json({status:'Ready',result:{sample:'https://delivery.eu1.bfl.ai/output.png'}});
  });
  studio.onReady=async job=>reviewed.push(job.artworkNumber);
  const inputs=artworks();
  const jobs=studio.createBatch({approvalId:'approved-batch',artworks:inputs});
  assert.equal(jobs.length,3);
  assert.deepEqual(jobs.map(j=>j.title),['01 — Blue Hour','02 — Weather Within','03 — Small Guardians']);
  assert.deepEqual(jobs.map(j=>j.artworkNumber),[1,2,3]);
  assert.deepEqual(jobs.map(j=>j.number),[1,2,3]);
  assert.deepEqual(jobs.map(j=>j.aspectRatio),['7:5','6:5','1:1']);
  assert.deepEqual(jobs.map(j=>j.prompt),inputs.map(a=>a.prompt));
  for(let i=0;i<6;i++)await studio.tick();
  assert.deepEqual(payloads,inputs.map(a=>({prompt:a.prompt,...fluxSize(a.aspectRatio),output_format:'png'})));
  assert.deepEqual(reviewed,[1,2,3]);
  assert.ok(studio.list().every(j=>j.status==='artwork_ready'&&!j.pollingUrl));
});

test('invalid item or missing key cannot partially queue a batch',t=>{
  const invalids=[
    {...artworks()[1],number:1},
    {...artworks()[1],number:0},
    {...artworks()[1],number:1.5},
    {...artworks()[1],title:'  '},
    {...artworks()[1],title:'x'.repeat(201)},
    {...artworks()[1],prompt:null},
    {...artworks()[1],prompt:'   '},
    {...artworks()[1],aspectRatio:undefined},
    {...artworks()[1],aspectRatio:'bad'},
    {...artworks()[1],aspectRatio:'9999:1'}
  ];
  const studio=setup(t);
  for(const invalid of invalids){
    assert.throws(()=>studio.createBatch({approvalId:'invalid',artworks:[artworks()[0],invalid]}));
    assert.deepEqual(studio.jobs,[]);assert.equal(fs.existsSync(studio.file),false);
  }
  assert.throws(()=>studio.createBatch({approvalId:'invalid',artworks:[]}));
  assert.throws(()=>studio.createBatch({approvalId:'invalid',artworks:Array(51).fill(artworks()[0])}));
  assert.throws(()=>studio.createBatch({approvalId:'',artworks:artworks()}));
  const noKey=setup(t,undefined,'');
  assert.throws(()=>noKey.createBatch({approvalId:'valid',artworks:artworks()}),/key is missing/);
  assert.deepEqual(noKey.jobs,[]);assert.equal(fs.existsSync(noKey.file),false);
});

test('approval replay returns the original jobs, including after reload, and other active batches wait',t=>{
  const studio=setup(t);
  const first=studio.createBatch({approvalId:'approved',artworks:artworks()});
  const replay=studio.createBatch({approvalId:'approved',artworks:[{number:99,title:'Replacement',prompt:'Other art',aspectRatio:'4:5'}]});
  assert.deepEqual(replay,first);assert.equal(studio.jobs.length,3);
  assert.throws(()=>studio.createBatch({approvalId:'another',artworks:artworks()}),/Wait for the current FLUX batch/);
  assert.throws(()=>studio.create({approvalId:'legacy',title:'Legacy',prompt:'Art',ratio:'4:5'}),/Wait for the current FLUX batch/);
  const restored=new FluxStudio({key:'test',file:studio.file,assetRoot:studio.assetRoot,fetcher:studio.fetcher});
  assert.deepEqual(restored.createBatch({approvalId:'approved',artworks:[]}),first);
  assert.equal(restored.jobs.length,3);
});

test('explicit provider failure records the failed artwork and continues sequentially',async t=>{
  const submitted=[];
  const studio=setup(t,async(url,options)=>{
    if(options.method==='POST'){
      submitted.push(JSON.parse(options.body).prompt);
      return Response.json({id:`job-${submitted.length}`,polling_url:`https://api.bfl.ai/v1/get_result?id=job-${submitted.length}`});
    }
    return Response.json({status:'Failed'});
  });
  studio.createBatch({approvalId:'approved',artworks:artworks()});
  await studio.tick();assert.deepEqual(studio.jobs.map(j=>j.status),['polling','queued','queued']);
  await studio.tick();assert.deepEqual(studio.jobs.map(j=>j.status),['failed','queued','queued']);
  await studio.tick();assert.deepEqual(studio.jobs.map(j=>j.status),['failed','polling','queued']);
  for(let i=0;i<4;i++)await studio.tick();
  assert.deepEqual(submitted,artworks().map(a=>a.prompt));
  assert.deepEqual(studio.jobs.map(j=>j.status),['failed','failed','failed']);
});

test('uncertain submission pauses the remaining approved batch without automatic paid retries',async t=>{
  let posts=0;
  const studio=setup(t,async()=>{posts++;throw Error('Connection ended after submit');});
  studio.createBatch({approvalId:'approved',artworks:artworks()});
  for(let i=0;i<5;i++)await studio.tick();
  assert.equal(posts,1);
  assert.deepEqual(studio.jobs.map(j=>j.status),['submission_uncertain','paused','paused']);
  studio.createBatch({approvalId:'approved',artworks:artworks()});
  await studio.tick();assert.equal(posts,1);assert.equal(studio.jobs.length,3);
});
