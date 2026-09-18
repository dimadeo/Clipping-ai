import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FluxStudio, fluxSize } from '../src/flux.js';

const artwork=(number=1)=>({number,title:`Picture ${number}`,prompt:`Paint artwork ${number} with expressive brushwork.`,aspectRatio:'4:5'});
const encoded=index=>Buffer.from([0xff,0xd8,0xff,index,0xff,0xd9]).toString('base64');
function setup(t,options={}) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'dmas-flux-pictures-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  return new FluxStudio({key:'test',file:path.join(folder,'jobs.json'),assetRoot:path.join(folder,'assets'),fetcher:async()=>{throw Error('Unexpected network request');},...options});
}
const submitted=()=>Response.json({id:'provider-job',polling_url:'https://api.bfl.ai/v1/get_result?id=provider-job'});

for(const count of [1,3,8])test(`${count} reference pictures reach the pinned FLUX endpoint in their approved order`,async t=>{
  const ids=Array.from({length:count},()=>crypto.randomUUID()),loaded=[],requests=[];
  const studio=setup(t,{
    referenceImage:async id=>{loaded.push(id);assert.equal(studio.jobs[0].status,'queued');return encoded(ids.indexOf(id));},
    fetcher:async(url,options)=>{requests.push({url,options});return submitted();}
  });
  const input={...artwork(),referenceIds:[...ids]};
  studio.createBatch({approvalId:'pictures-approved',artworks:[input]});
  assert.deepEqual(loaded,[]);assert.deepEqual(requests,[]);
  input.referenceIds.reverse();input.referenceIds.push(crypto.randomUUID());
  assert.deepEqual(studio.jobs[0].referenceIds,ids);
  await studio.tick();
  assert.deepEqual(loaded,ids);assert.equal(requests.length,1);
  assert.equal(requests[0].url,'https://api.bfl.ai/v1/flux-2-pro');assert.equal(requests[0].options.method,'POST');
  const expectedInputs=Object.fromEntries(ids.map((id,index)=>[index===0?'input_image':`input_image_${index+1}`,encoded(index)]));
  assert.deepEqual(JSON.parse(requests[0].options.body),{prompt:artwork().prompt,...fluxSize('4:5'),output_format:'png',...expectedInputs});
  assert.equal(studio.jobs[0].status,'polling');
  const publicJobs=studio.list(),saved=fs.readFileSync(studio.file,'utf8');
  assert.deepEqual(publicJobs[0].referenceIds,ids);assert.equal(publicJobs[0].pollingUrl,undefined);
  for(let index=0;index<count;index++){
    assert.equal(JSON.stringify(studio.jobs).includes(encoded(index)),false);
    assert.equal(JSON.stringify(publicJobs).includes(encoded(index)),false);
    assert.equal(saved.includes(encoded(index)),false);
  }
  assert.equal(saved.includes('input_image'),false);
  assert.equal(saved.includes(studio.assetRoot),false);
});

test('reference picture validation rejects the entire batch without resolving or persisting any item',t=>{
  const id=crypto.randomUUID();let reads=0;
  const studio=setup(t,{referenceImage:async()=>{reads++;return encoded(1);}});
  const invalids=[null,[],id,[id,id],[id,id.toUpperCase()],Array.from({length:9},()=>crypto.randomUUID()),[null],[1],[{}],[''],['../private.jpg'],['C:\\private\\photo.jpg'],['https://example.com/photo.jpg'],['data:image/jpeg;base64,'+encoded(1)],[' '+id],[id+'\n'],Array(1)];
  for(const referenceIds of invalids){
    assert.throws(()=>studio.createBatch({approvalId:'invalid',artworks:[{...artwork(1),referenceIds:[id]},{...artwork(2),referenceIds}]}),/reference picture/i);
    assert.deepEqual(studio.jobs,[]);assert.equal(fs.existsSync(studio.file),false);
  }
  assert.equal(reads,0);
  const unavailable=setup(t);
  assert.throws(()=>unavailable.createBatch({approvalId:'missing-storage',artworks:[artwork(1),{...artwork(2),referenceIds:[id]}]}),/storage is not available/);
  assert.deepEqual(unavailable.jobs,[]);assert.equal(fs.existsSync(unavailable.file),false);
});

test('missing local references fail before submission, conceal local paths and let the next job proceed',async t=>{
  const ids=[crypto.randomUUID(),crypto.randomUUID()];let requests=0;
  const privatePath='C:\\private\\pictures\\family-photo.jpg';
  const studio=setup(t,{
    referenceImage:async id=>{if(id===ids[1])throw Error(`ENOENT: no such file ${privatePath}`);return encoded(0);},
    fetcher:async()=>{requests++;return submitted();}
  });
  studio.createBatch({approvalId:'pictures-approved',artworks:[{...artwork(1),referenceIds:ids},artwork(2)]});
  await studio.tick();
  assert.equal(requests,0);assert.deepEqual(studio.jobs.map(job=>job.status),['failed','queued']);
  assert.match(studio.jobs[0].message,/reference picture could not be loaded/);
  assert.equal(studio.jobs[0].providerId,undefined);
  for(const value of [JSON.stringify(studio.jobs),JSON.stringify(studio.list()),fs.readFileSync(studio.file,'utf8')]){
    assert.equal(value.includes(privatePath),false);assert.equal(value.includes('family-photo.jpg'),false);assert.equal(value.includes(encoded(0)),false);
  }
  await studio.tick();assert.equal(requests,1);assert.deepEqual(studio.jobs.map(job=>job.status),['failed','polling']);
});

test('an absent or malformed local image value fails without a provider request',async t=>{
  for(const value of [undefined,null,'','data:image/jpeg;base64,'+encoded(0),'C:\\private\\photo.jpg','https://example.com/photo.jpg']){
    let requests=0;
    const studio=setup(t,{referenceImage:async()=>value,fetcher:async()=>{requests++;return submitted();}});
    studio.createBatch({approvalId:'pictures-approved',artworks:[{...artwork(),referenceIds:[crypto.randomUUID()]}]});
    await studio.tick();assert.equal(requests,0);assert.equal(studio.jobs[0].status,'failed');
  }
});

test('restored picture jobs resolve references only when processed and fail safely without storage',async t=>{
  const studio=setup(t,{referenceImage:async()=>encoded(0)}),ids=[crypto.randomUUID()];
  studio.createBatch({approvalId:'pictures-approved',artworks:[{...artwork(),referenceIds:ids}]});
  const restored=new FluxStudio({key:'test',file:studio.file,assetRoot:studio.assetRoot,fetcher:async()=>{assert.fail('No provider request is allowed');}});
  assert.deepEqual(restored.jobs[0].referenceIds,ids);
  await restored.tick();assert.equal(restored.jobs[0].status,'failed');
});

test('uncertain picture submissions preserve the no-retry boundary and pause the remaining batch',async t=>{
  let requests=0,reads=0;
  const studio=setup(t,{referenceImage:async()=>{reads++;return encoded(0);},fetcher:async()=>{requests++;throw Error('Connection ended after submit');}});
  studio.createBatch({approvalId:'pictures-approved',artworks:[{...artwork(1),referenceIds:[crypto.randomUUID()]},artwork(2)]});
  await studio.tick();await studio.tick();
  assert.equal(requests,1);assert.equal(reads,1);
  assert.deepEqual(studio.jobs.map(job=>job.status),['submission_uncertain','paused']);
});

test('text-only batches keep their request shape and never resolve reference pictures',async t=>{
  let reads=0;const requests=[];
  const studio=setup(t,{referenceImage:async()=>{reads++;throw Error('Unexpected picture lookup');},fetcher:async(url,options)=>{requests.push(JSON.parse(options.body));return submitted();}});
  studio.createBatch({approvalId:'text-approved',artworks:[artwork()]});
  await studio.tick();assert.equal(reads,0);assert.equal(studio.jobs[0].referenceIds,undefined);
  assert.deepEqual(requests,[{prompt:artwork().prompt,...fluxSize('4:5'),output_format:'png'}]);
});

test('selected output pixel dimensions are copied into jobs and submitted unchanged with their references',async t=>{
  const requests=[];
  const studio=setup(t,{referenceImage:async()=>encoded(0),fetcher:async(url,options)=>{
    if(options.method!=='POST')return Response.json({status:'Failed'});
    requests.push(JSON.parse(options.body));return submitted();
  }});
  const sizes=[{width:896,height:1120},{width:1280,height:1600},{width:64,height:80}];
  const inputs=sizes.map((generation,index)=>({...artwork(index+1),generation:{...generation},referenceIds:[crypto.randomUUID()]}));
  studio.createBatch({approvalId:'selected-pixels',artworks:inputs});
  inputs[0].generation.width=4096;
  assert.deepEqual(studio.jobs.map(({width,height})=>({width,height})),sizes);
  assert.deepEqual(JSON.parse(fs.readFileSync(studio.file,'utf8')).map(({width,height})=>({width,height})),sizes);
  for(let index=0;index<sizes.length*2;index++)await studio.tick();
  assert.deepEqual(requests,sizes.map((size,index)=>({prompt:artwork(index+1).prompt,...size,output_format:'png',input_image:encoded(0)})));
});

test('invalid selected dimensions reject the entire batch before queueing or loading pictures',t=>{
  let reads=0;
  const studio=setup(t,{referenceImage:async()=>{reads++;return encoded(0);}});
  const invalids=[
    null,false,[],{},'896x1120',
    {width:'896',height:1120},{width:896,height:1120.5},
    {width:48,height:80},{width:4160,height:4096},
    {width:895,height:1120},{width:896,height:1119},
    {width:2048,height:2560},{width:1024,height:1024},
    {width:NaN,height:1120},{width:896,height:Infinity}
  ];
  for(const generation of invalids){
    assert.throws(()=>studio.createBatch({approvalId:'invalid-pixels',artworks:[
      {...artwork(1),generation:{width:896,height:1120},referenceIds:[crypto.randomUUID()]},
      {...artwork(2),generation}
    ]}),/output (pixel dimensions|dimensions)/);
    assert.deepEqual(studio.jobs,[]);assert.equal(fs.existsSync(studio.file),false);
  }
  assert.equal(reads,0);
});
