import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import sharp from 'sharp';
import { createApplication } from '../src/server.js';

async function setup(t,adminToken=''){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dmas-picture-api-'));
  const calls=[],jobs=[];
  const flux={key:'test-only',list:()=>jobs,async tick(){},createBatch(input){
    const existing=jobs.filter(j=>j.approvalId===input.approvalId);if(existing.length)return existing;
    calls.push(input);const created=input.artworks.map(a=>({...a,id:'test-'+a.number,approvalId:input.approvalId,status:'queued',pollingUrl:'private-url'}));jobs.push(...created);return created;
  }};
  const {server}=createApplication({config:{creationExecutor:'midjourney',adminToken,openaiApiKey:'',creativeModel:'test-only'},
    journal:{records:new Map()},queue:{pending:[]},catalog:new Map(),creativeAgent:{},creativeOrchestrator:{},flux,
    pictureRoot:path.join(root,'pictures'),pictureDraftPath:path.join(root,'drafts.json'),
    batchDraftPath:path.join(root,'batch.json'),productionReviewPath:path.join(root,'reviews.json'),
    fluxPath:path.join(root,'flux.json'),upscalePath:path.join(root,'upscale.json'),
    selectedArtPath:path.join(root,'selected.json'),portraitCollectionPath:path.join(root,'portraits.json'),approvalPath:path.join(root,'approvals.json'),
    autonomousPromptPath:path.join(root,'auto.json'),autonomousControlPath:path.join(root,'control.json')});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(route,options={})=>fetch(base+route,{...options,signal:AbortSignal.timeout(10000)});
  const post=(route,body)=>request(route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const bytes=await sharp({create:{width:192,height:256,channels:3,background:'#537381'}}).png().toBuffer();
  const upload=(headers={})=>request('/api/creative/pictures',{method:'POST',headers:{'content-type':'image/png','x-file-name':encodeURIComponent('My picture.png'),...headers},body:bytes});
  return {request,post,upload,calls,jobs,root};
}
test('upload → picture plan → explicit approval carries references with no early paid work',async t=>{
  const app=await setup(t);
  const served=await (await app.request('/')).text();
  for(const match of served.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Function(match[1]),'Every served script must remain valid after HTML insertion');
  const r=await app.upload();assert.equal(r.status,201);const {picture}=await r.json();
  assert.equal(picture.name,'My picture.png');assert.equal(picture.width,192);
  const list=await (await app.request('/api/creative/pictures')).json();assert.equal(list.pictures.length,1);
  const preview=await app.request(picture.previewUrl);assert.equal(preview.status,200);assert.equal(preview.headers.get('content-type'),'image/jpeg');
  const plan=await app.post('/api/creative/picture-drafts',{pictureIds:[picture.id],mode:'collection',title:'Ink portraits',instructions:'Use soft black ink on ivory.',aspectRatio:'source'});
  assert.equal(plan.status,201);const {draft}=await plan.json();assert.equal(app.calls.length,0);assert.equal(draft.artworks[0].aspectRatio,'3:4');
  assert.equal((await app.post(`/api/creative/picture-drafts/${draft.id}/generate`,{approved:false})).status,400);assert.equal(app.calls.length,0);
  const result=await app.post(`/api/creative/picture-drafts/${draft.id}/generate`,{approved:true});assert.equal(result.status,202);
  const data=await result.json();assert.equal(data.jobs[0].pollingUrl,undefined);assert.deepEqual(app.calls[0].artworks[0].referenceIds,[picture.id]);
  await app.post(`/api/creative/picture-drafts/${draft.id}/generate`,{approved:true});assert.equal(app.calls.length,1);
  const custom=await app.post('/api/creative/picture-drafts',{pictureIds:[picture.id],mode:'single',title:'Custom size',instructions:'Create an ink study.',aspectRatio:'source',resolution:'custom',pixelWidth:1024,pixelHeight:1536});
  const {draft:customDraft}=await custom.json();assert.equal(custom.status,201);assert.deepEqual(customDraft.artworks[0].generation,{width:1024,height:1536});
  await app.post(`/api/creative/picture-drafts/${customDraft.id}/generate`,{approved:true});assert.deepEqual(app.calls[1].artworks[0].generation,{width:1024,height:1536});
  const invalid=await app.post('/api/creative/picture-drafts',{pictureIds:[picture.id],mode:'single',title:'8K',instructions:'Create an ink study.',resolution:'custom',pixelWidth:7680,pixelHeight:4320});assert.equal(invalid.status,400);assert.equal(app.calls.length,2);
});
test('picture upload preserves same-origin protections and rejects invalid file type',async t=>{
  const app=await setup(t);
  assert.equal((await app.upload({'sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await app.upload({origin:'https://untrusted.example'})).status,403);
  assert.equal((await app.upload({'content-type':'image/svg+xml'})).status,415);
  const bad=await app.request('/api/creative/pictures',{method:'POST',headers:{'content-type':'image/png'},body:'not a picture'});assert.equal(bad.status,400);
  assert.equal((await (await app.request('/api/creative/pictures')).json()).pictures.length,0);
});
test('private picture library and previews require configured admin authentication',async t=>{
  const app=await setup(t,'mock-admin');
  assert.equal((await app.request('/api/creative/pictures')).status,401);
  assert.equal((await app.upload()).status,401);
  assert.equal((await app.request('/api/creative/pictures/00000000-0000-4000-8000-000000000000/image')).status,401);
  assert.equal((await app.request('/api/creative/pictures',{headers:{authorization:'Bearer mock-admin'}})).status,200);
});
