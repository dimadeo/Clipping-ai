import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FluxStudio, fluxPrompt, fluxSize } from '../src/flux.js';
import { CREATION_FORMATS, FLUX_MAX_PIXELS } from '../src/creation-formats.js';

test('all creation shapes use the largest exact-ratio size within the BFL pixel limit',()=>{
  for(const format of CREATION_FORMATS){
    const {width,height}=fluxSize(format.ratio);const [w,h]=format.ratio.split(':').map(Number);
    assert.equal(width%16,0);assert.equal(height%16,0);assert.equal(width*h,height*w);
    assert.ok(width*height<=FLUX_MAX_PIXELS);
    assert.ok((width+w*16)*(height+h*16)>FLUX_MAX_PIXELS);
  }
  assert.deepEqual(fluxSize('1:1'),{width:2048,height:2048});
  assert.deepEqual(fluxSize('5:4'),{width:2240,height:1792});
});

const setup=fetcher=>{const folder=fs.mkdtempSync(path.join(os.tmpdir(),'dmas-flux-'));return new FluxStudio({key:'test',file:path.join(folder,'jobs.json'),assetRoot:path.join(folder,'assets'),fetcher});};
test('converts Midjourney flags and rejects unsupported dimensions',()=>{
  assert.equal(fluxPrompt('Portrait with canvas texture --style raw --ar 4:5 --stylize 300 --no text, frame'),'Portrait with canvas texture');
  assert.deepEqual(fluxSize('4:5'),{width:1792,height:2240});assert.throws(()=>fluxSize('bad'));
});
test('one approval cannot submit duplicate paid jobs; returned images are saved and reviewed',async()=>{
  const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(896,16);png.writeUInt32BE(1120,20);
  let posts=0, reviewed=0;
  const studio=setup(async(url,options)=>{
    if(options.method==='POST'){const payload=JSON.parse(options.body);assert.equal(payload.width,1792);assert.equal(payload.height,2240);assert.equal(payload.output_format,'png');posts++;return Response.json({id:'provider-job',polling_url:'https://api.eu1.bfl.ai/v1/get_result?id=provider-job'});}
    if(url.includes('delivery.')){assert.equal(options.headers,undefined);return new Response(png);}
    return Response.json({status:'Ready',result:{sample:'https://delivery.eu1.bfl.ai/output.png'}});
  });studio.onReady=async()=>{reviewed++;};
  const input={approvalId:'approved',title:'Test',prompt:'Texture --ar 4:5',ratio:'4:5',count:1};
  studio.create(input);studio.create(input);await studio.tick();await studio.tick();
  assert.equal(posts,1);assert.equal(reviewed,1);assert.equal(studio.list()[0].status,'artwork_ready');
  assert.equal(studio.list()[0].pollingUrl,undefined);
});
test('uncertain submission pauses batch and does not retry paid requests',async()=>{
  let posts=0;const studio=setup(async()=>{posts++;throw Error('network');});
  studio.create({approvalId:'one',title:'test',prompt:'Art',ratio:'4:5',count:3});
  await studio.tick();await studio.tick();assert.equal(posts,1);
  assert.deepEqual(studio.list().map(j=>j.status),['submission_uncertain','paused','paused']);
});
test('API key is not sent to an unexpected provider polling host',async()=>{
  let requests=0;const studio=setup(async()=>{requests++;return Response.json({id:'bad',polling_url:'https://example.com/steal'});});
  studio.create({approvalId:'one',title:'test',prompt:'Art',ratio:'4:5'});await studio.tick();await studio.tick();
  assert.equal(requests,1);assert.equal(studio.list()[0].status,'submission_uncertain');
});
