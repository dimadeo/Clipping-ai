import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApplication } from '../src/server.js';
import { highestFluxSize } from '../src/creation-formats.js';

const entries=[
  ['BLUE HOUR','7:5','A sea painted in oil on linen. Intended size 70 × 50 cm.'],
  ['AFTER EVERYONE LEFT','5:4','A still life of an empty dinner table. Intended size 50 × 40 cm.'],
  ['TWELVE QUIET PLACES','4:3','One miniature landscape. Intended size 20 × 15 cm.'],
  ['THE ROOM REMEMBERS','3:4','A room with water on its floor. Intended size 60 × 80 cm.'],
  ['INHERITED THREADS','5:7','A textile artwork concept. Intended size 50 × 70 cm.'],
  ['CITY BENEATH THE CITY','4:5','An imagined paper city collage. Intended size 40 × 50 cm.'],
  ['WEATHER WITHIN','6:5','An abstract painting. Intended size 120 × 100 cm.'],
  ['GARDEN AFTER RAIN','2:3','Wet leaves and silver light. Intended size 40 × 60 cm.'],
  ['SMALL GUARDIANS','1:1','One ceramic sculpture approximately 20 cm tall, neutral studio background.'],
  ['SUNDAY, REMEMBERED','3:4','A narrative family gathering painting. Intended size 60 × 80 cm.']
];
const tenPrompts='Create 10 separate fine-art concept images.\nWORKFLOW\n1. One image per numbered prompt.\n2. Never combine artworks.\n\n'+entries.map(([title,ratio,prompt],index)=>`${String(index+1).padStart(2,'0')} — ${title}\n${prompt} ${ratio==='1:1'?'Square image.':`Width-to-height ratio ${ratio}.`}`).join('\n\n')+'\n';

function mockedFlux(){
  const calls=[];const jobs=[];
  return {key:'mock-only',calls,jobs,
    list:()=>jobs,
    createBatch(input){
      calls.push(structuredClone(input));
      const previous=jobs.filter(job=>job.approvalId===input.approvalId);if(previous.length)return previous;
      const created=input.artworks.map(artwork=>({id:`mock-${artwork.number}`,approvalId:input.approvalId,artworkNumber:artwork.number,title:artwork.title,status:'queued',pollingUrl:'https://api.bfl.ai/mock-private-polling-url'}));
      jobs.push(...created);return created;
    },
    async tick(){/* Mock only: never calls an image provider. */}
  };
}

function sandbox(t){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'dmas-batch-api-'));
  const running=[];
  t.after(async()=>{
    for(const app of running)await app.close();
    fs.rmSync(folder,{recursive:true,force:true});
  });
  const options={
    config:{creationExecutor:'midjourney',adminToken:'',openaiApiKey:'',creativeModel:'mock-only'},
    journal:{records:new Map()},queue:{pending:[]},catalog:new Map(),
    creativeAgent:{create(){throw Error('A numbered batch must bypass the single-artwork agent');}},
    creativeOrchestrator:{async run(){throw Error('A numbered batch must bypass the single-artwork orchestrator');}},
    batchDraftPath:path.join(folder,'batch.json'),productionReviewPath:path.join(folder,'reviews.json'),fluxPath:path.join(folder,'flux.json'),upscalePath:path.join(folder,'upscale.json'),
    selectedArtPath:path.join(folder,'selected.json'),portraitCollectionPath:path.join(folder,'portraits.json'),approvalPath:path.join(folder,'approvals.json'),
    autonomousPromptPath:path.join(folder,'autonomous-prompts.json'),autonomousControlPath:path.join(folder,'autonomous-control.json')
  };
  async function start(flux=mockedFlux()){
    const {server}=createApplication({...options,flux});
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}`;
    const app={flux,
      async request(route,body){
        const response=await fetch(base+route,{...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});
        return {status:response.status,body:await response.json()};
      },
      async close(){if(server.listening){server.closeIdleConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}
    };
    running.push(app);return app;
  }
  return {start,options};
}

test('preparing ten numbered prompts preserves one per ratio without generation or single-brief overrides',async t=>{
  const {start,options}=sandbox(t);const app=await start();
  const response=await app.request('/api/creative/prompts',{subject:tenPrompts,collectionName:'First ten',imageCount:3,aspectRatio:'4:5',palette:'Ignore this single-brief override'});
  assert.equal(response.status,201);
  const batch=response.body;
  assert.equal(batch.kind,'artwork-batch');assert.equal(batch.originalText,tenPrompts);assert.equal(batch.collectionName,'First ten');
  assert.equal(batch.brief.imageCount,10);assert.equal(batch.delivery.requestedImages,10);assert.deepEqual(batch.candidates,[]);
  assert.deepEqual(batch.artworks.map(a=>a.number),[1,2,3,4,5,6,7,8,9,10]);
  assert.deepEqual(batch.artworks.map(a=>a.title),entries.map(([title])=>title));
  assert.deepEqual(batch.artworks.map(a=>a.aspectRatio),entries.map(([,ratio])=>ratio));
  assert.ok(batch.artworks.every(a=>a.status==='awaiting_approval'&&!a.issue&&!a.prompt.includes('Ignore this single-brief override')));
  for(const artwork of batch.artworks)assert.deepEqual(artwork.generation,{...highestFluxSize(artwork.aspectRatio),format:'PNG'});
  assert.equal(app.flux.calls.length,0);assert.equal(app.flux.jobs.length,0);
  assert.equal(fs.existsSync(options.fluxPath),false);assert.equal(fs.existsSync(options.productionReviewPath),false);
  assert.equal(JSON.parse(fs.readFileSync(options.batchDraftPath,'utf8')).result.originalText,tenPrompts);
});

test('paid batch generation requires approval and uses only cached artworks, not forged client entries',async t=>{
  const {start}=sandbox(t);const app=await start();
  const {body:batch}=await app.request('/api/creative/prompts',{subject:tenPrompts});
  for(const approved of [false,undefined,'true']){
    const denied=await app.request('/api/flux/generate-batch',{promptId:batch.promptId,approved});
    assert.equal(denied.status,400);assert.match(denied.body.error,/approve/i);
  }
  assert.equal(app.flux.calls.length,0);
  const missing=await app.request('/api/flux/generate-batch',{promptId:'not-a-cached-draft',approved:true});
  assert.equal(missing.status,404);assert.equal(app.flux.calls.length,0);
  const created=await app.request('/api/flux/generate-batch',{promptId:batch.promptId,approved:true,artworks:[{number:99,title:'Forged replacement',prompt:'Unapproved art',aspectRatio:'1:1'}],count:50});
  assert.equal(created.status,202);assert.equal(created.body.jobs.length,10);
  assert.equal(app.flux.calls.length,1);
  assert.deepEqual(app.flux.calls[0],{approvalId:batch.promptId+':batch',artworks:batch.artworks});
  assert.ok(created.body.jobs.every(job=>!Object.hasOwn(job,'pollingUrl')));
  const replay=await app.request('/api/flux/generate-batch',{promptId:batch.promptId,approved:true});
  assert.equal(replay.status,202);assert.deepEqual(replay.body.jobs,created.body.jobs);
  assert.equal(app.flux.calls[1].approvalId,app.flux.calls[0].approvalId);assert.equal(app.flux.jobs.length,10);
});

test('an artwork with missing or conflicting shape stays reviewable and blocks the whole paid batch',async t=>{
  const {start}=sandbox(t);const app=await start();
  for(const second of ['A textile concept without a specified format.','A landscape with ratio 7:5 and ratio 3:4.']){
    const subject=`01 — Good artwork\nAn oil painting. Ratio 7:5.\n\n02 — Needs a decision\n${second}`;
    const prepared=await app.request('/api/creative/prompts',{subject});
    assert.equal(prepared.status,201);assert.equal(prepared.body.artworks.length,2);
    assert.equal(prepared.body.artworks[0].issue,null);
    assert.ok(prepared.body.artworks[1].issue);assert.equal(prepared.body.artworks[1].generation,null);assert.equal(prepared.body.artworks[1].status,'needs_changes');
    const rejected=await app.request('/api/flux/generate-batch',{promptId:prepared.body.promptId,approved:true,artworks:[prepared.body.artworks[0]]});
    assert.equal(rejected.status,400);assert.match(rejected.body.error,/Correct the marked artwork ratios/);
  }
  assert.equal(app.flux.calls.length,0);assert.equal(app.flux.jobs.length,0);
});

test('latest draft preserves original text and loads for approval after application restart',async t=>{
  const {start}=sandbox(t);const first=await start();
  assert.deepEqual(await first.request('/api/creative/batches/latest'),{status:200,body:{batch:null}});
  const {body:prepared}=await first.request('/api/creative/prompts',{subject:tenPrompts,collectionName:'Saved original'});
  const latest=await first.request('/api/creative/batches/latest');
  assert.equal(latest.status,200);assert.deepEqual(latest.body.batch,{...prepared,expired:false});
  await first.close();
  const restored=await start();
  const loaded=await restored.request('/api/creative/batches/latest');
  assert.deepEqual(loaded.body.batch,{...prepared,expired:false});assert.equal(loaded.body.batch.originalText,tenPrompts);
  assert.equal(restored.flux.calls.length,0);
  const result=await restored.request('/api/flux/generate-batch',{promptId:prepared.promptId,approved:true});
  assert.equal(result.status,202);assert.equal(result.body.jobs.length,10);
  assert.deepEqual(restored.flux.calls[0].artworks,prepared.artworks);
});

test('expired saved drafts remain visible but cannot initiate paid generation',async t=>{
  const {start,options}=sandbox(t);const first=await start();
  const {body:prepared}=await first.request('/api/creative/prompts',{subject:tenPrompts});await first.close();
  const saved=JSON.parse(fs.readFileSync(options.batchDraftPath,'utf8'));saved.expiresAt=Date.now()-1000;
  fs.writeFileSync(options.batchDraftPath,JSON.stringify(saved));
  const restored=await start();const latest=await restored.request('/api/creative/batches/latest');
  assert.equal(latest.body.batch.expired,true);assert.equal(latest.body.batch.originalText,tenPrompts);
  const rejected=await restored.request('/api/flux/generate-batch',{promptId:prepared.promptId,approved:true});
  assert.equal(rejected.status,404);assert.equal(restored.flux.calls.length,0);
});
