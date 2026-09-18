import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { imageDimensions } from './production-review.js';
import { highestFluxSize, FLUX_MAX_PIXELS } from './creation-formats.js';

const error = message => Object.assign(new Error(message), { statusCode: 409 });
const referenceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function fluxPrompt(text) {
  return String(text).replace(/\s--[a-z][a-z-]*(?:\s+[^]*?)(?=\s--[a-z]|$)/gi, '').trim();
}
export function fluxSize(ratio='4:5') {
  return highestFluxSize(ratio);
}
function providerUrl(value, delivery=false) {
  const url=new URL(value);
  const hostOK=delivery ? /^delivery\.[a-z0-9.-]+\.bfl\.ai$/.test(url.hostname) : /^(api|api\.[a-z0-9.-]+)\.bfl\.ai$/.test(url.hostname);
  if(url.protocol!=='https:' || !hostOK || url.username || url.password || url.port)throw error('Unexpected BFL response URL');
  return url.href;
}
export class FluxStudio {
  constructor({key='',file=path.resolve('data/flux-jobs.json'),assetRoot=path.resolve('assets/flux'),fetcher=fetch,onReady=async()=>{},referenceImage=null}={}) {
    Object.assign(this,{key:key.trim(),file,assetRoot,fetcher,onReady,referenceImage});
    this.jobs=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
    this.busy=false;
    // A submit interrupted before receiving its ID must never be charged again automatically.
    for(const job of this.jobs)if(job.status==='submitting'){job.status='submission_uncertain';job.message='Check BFL history before creating another request.';}
  }
  save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.jobs,null,2));fs.renameSync(this.file+'.tmp',this.file);}
  list(){return this.jobs.map(({pollingUrl,...publicJob})=>publicJob);}
  async json(url,body){
    if(!this.key)throw error('Add BFL_API_KEY to local settings first');
    const response=await this.fetcher(providerUrl(url),{method:body?'POST':'GET',redirect:'error',headers:{'x-key':this.key,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw error(response.status===402?'Add credits to your BFL account':response.status===401||response.status===403?'BFL did not accept this API key':`BFL returned HTTP ${response.status}. Check the connection before trying again.`);
    return response.json();
  }
  async connection(){try {const result=await this.json('https://api.bfl.ai/v1/credits');return {configured:!!this.key,verified:true,credits:result.credits};}catch(e){return {configured:!!this.key,verified:false,message:e.message};}}
  create({approvalId,title,prompt,ratio,count=1}) {
    if(!this.key)throw error('BFL key is missing');
    if(!Number.isInteger(count)||count<1||count>50)throw error('Image count must be 1 to 50');
    const existing=this.jobs.filter(j=>j.approvalId===approvalId);if(existing.length)return existing;
    if(this.jobs.some(j=>['queued','submitting','polling'].includes(j.status)))throw error('Wait for the current FLUX batch to finish');
    const clean=fluxPrompt(prompt);if(!clean)throw error('Creative prompt is required');
    const jobs=Array.from({length:count},(_,index)=>({id:crypto.randomUUID(),approvalId,title:`${title} · ${index+1}`,prompt:clean,...fluxSize(ratio),status:'queued',createdAt:new Date().toISOString(),model:'flux-2-pro'}));
    this.jobs.push(...jobs);this.save();return jobs;
  }
  createBatch({approvalId,artworks}) {
    if(!this.key)throw error('BFL key is missing');
    if(typeof approvalId!=='string'||!approvalId.trim())throw error('A batch approval is required');
    // An approval is an idempotency key: replay always returns its original jobs.
    const existing=this.jobs.filter(j=>j.approvalId===approvalId);if(existing.length)return existing;
    if(this.jobs.some(j=>['queued','submitting','polling'].includes(j.status)))throw error('Wait for the current FLUX batch to finish');
    if(!Array.isArray(artworks)||artworks.length<1||artworks.length>50)throw error('A batch must contain 1 to 50 artworks');
    const numbers=new Set();
    // Validate the complete batch before mutating or persisting the queue.
    const prepared=artworks.map(artwork=>{
      if(!artwork||typeof artwork!=='object')throw error('Each artwork must include a number, title, prompt and aspect ratio');
      const {number,title,prompt,aspectRatio}=artwork;
      if(!Number.isSafeInteger(number)||number<1||numbers.has(number))throw error('Artwork numbers must be unique positive integers');
      numbers.add(number);
      if(typeof title!=='string'||!title.trim()||title.trim().length>200)throw error(`Artwork ${number} needs a title of 1 to 200 characters`);
      if(typeof prompt!=='string'||!prompt.trim()||prompt.length>20000)throw error(`Artwork ${number} needs a prompt of 1 to 20000 characters`);
      const clean=fluxPrompt(prompt);if(!clean)throw error(`Artwork ${number} needs a creative prompt`);
      if(typeof aspectRatio!=='string'||!aspectRatio.trim())throw error(`Artwork ${number} needs its own aspect ratio`);
      let dimensions=fluxSize(aspectRatio);
      if(artwork.generation!==undefined){
        const generation=artwork.generation;
        if(!generation||typeof generation!=='object'||Array.isArray(generation))throw error(`Artwork ${number} needs valid output pixel dimensions`);
        const {width,height}=generation;
        if([width,height].some(value=>!Number.isInteger(value)||value<64||value>4096||value%16!==0)||width*height>FLUX_MAX_PIXELS)throw error(`Artwork ${number} needs output dimensions from 64 to 4096 pixels, in multiples of 16 and within the FLUX pixel limit`);
        const [ratioWidth,ratioHeight]=aspectRatio.split(':').map(Number);
        if(Math.abs(width/height-ratioWidth/ratioHeight)>1e-8)throw error(`Artwork ${number} output dimensions must match its aspect ratio`);
        dimensions={width,height};
      }
      let references={};
      if(artwork.referenceIds!==undefined){
        if(!Array.isArray(artwork.referenceIds)||artwork.referenceIds.length<1||artwork.referenceIds.length>8)throw error(`Artwork ${number} needs 1 to 8 reference pictures`);
        const ids=[...artwork.referenceIds];
        if(ids.some(id=>typeof id!=='string'||!referenceId.test(id))||new Set(ids.map(id=>id.toLowerCase())).size!==ids.length)throw error(`Artwork ${number} needs unique valid reference picture IDs`);
        if(typeof this.referenceImage!=='function')throw error('Reference picture storage is not available');
        references={referenceIds:ids};
      }
      return {number,artworkNumber:number,artworkTitle:title.trim(),title:`${String(number).padStart(2,'0')} — ${title.trim()}`,prompt:clean,aspectRatio,...dimensions,...references};
    });
    const createdAt=new Date().toISOString();
    const jobs=prepared.map(artwork=>({id:crypto.randomUUID(),approvalId,...artwork,status:'queued',createdAt,model:'flux-2-pro'}));
    this.jobs.push(...jobs);this.save();return jobs;
  }
  async tick(){
    if(this.busy)return;this.busy=true;
    try {
      const job=this.jobs.find(j=>j.status==='polling')||this.jobs.find(j=>j.status==='queued');if(!job)return;
      if(job.status==='queued'){
        // Load local pictures before entering the paid submission boundary. Never persist their bytes.
        const inputs={};
        try {
          for(const [index,id] of (job.referenceIds||[]).entries()){
            const encoded=await this.referenceImage(id);
            if(typeof encoded!=='string'||!encoded.length||encoded.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw error('Reference picture is unavailable');
            inputs[index===0?'input_image':`input_image_${index+1}`]=encoded;
          }
        }catch{
          job.status='failed';job.message='A reference picture could not be loaded. Upload it again before creating a new batch.';this.save();return;
        }
        job.status='submitting';this.save();
        try {const result=await this.json('https://api.bfl.ai/v1/flux-2-pro',{prompt:job.prompt,width:job.width,height:job.height,output_format:'png',...inputs});
          if(!result.id||!result.polling_url)throw error('Missing BFL job identifier');
          job.providerId=result.id;job.pollingUrl=providerUrl(result.polling_url);job.status='polling';job.submittedAt=new Date().toISOString();this.save();
        }catch(e){job.status='submission_uncertain';job.message=e.message+' Check BFL history; this request will not be resent automatically.';for(const other of this.jobs)if(other.status==='queued'&&other.approvalId===job.approvalId)other.status='paused';this.save();}return;
      }
      try {
        const result=await this.json(job.pollingUrl);
        if(['Error','Failed','Request Moderated','Content Moderated'].includes(result.status)){job.status='failed';job.message='BFL could not complete this image: '+result.status;this.save();return;}
        if(result.status!=='Ready'){
          if(Date.now()-Date.parse(job.submittedAt)>15*60*1000){job.status='needs_attention';job.message='Generation is taking longer than expected. Check BFL history.';this.save();}return;
        }
        const response=await this.fetcher(providerUrl(result.result.sample,true),{redirect:'error',signal:AbortSignal.timeout(25000)});
        if(!response.ok)throw error('Could not download the completed BFL image');
        let length=0;const parts=[];for await(const chunk of response.body){length+=chunk.length;if(length>40*1024*1024)throw error('BFL image exceeds 40 MB');parts.push(chunk);}
        const bytes=Buffer.concat(parts);job.dimensions=imageDimensions(bytes);
        fs.mkdirSync(this.assetRoot,{recursive:true});const ext=bytes[0]===137?'png':'jpg';
        fs.writeFileSync(path.join(this.assetRoot,job.id+'.'+ext),bytes);
        job.assetUrl='/assets/flux/'+job.id+'.'+ext;job.status='artwork_ready';job.completedAt=new Date().toISOString();delete job.message;this.save();
        try{await this.onReady(job);}catch{job.message='Image saved; retry its resolution check in the review panel.';this.save();}
      }catch(e){job.message=e.message;job.pollErrors=(job.pollErrors||0)+1;if(job.pollErrors>=5)job.status='needs_attention';this.save();}
    }finally{this.busy=false;}
  }
}
