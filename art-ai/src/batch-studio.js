import crypto from 'node:crypto';
import { parseArtworkBatch } from './artwork-batch.js';
import { highestFluxSize } from './creation-formats.js';

export function prepareArtworkBatch(text, collectionName) {
  const batch = parseArtworkBatch(text);
  if (!batch) return null;
  const batchName = batch.batchId ? batch.batchId.replace(/^B([0-9]+)$/i, 'Batch $1') : String(collectionName || 'Artwork batch').trim().slice(0,200);
  const artworks = batch.artworks.map(artwork => {
    let generation = null, issue = artwork.issue;
    if (!issue && artwork.aspectRatio) {
      try { generation = { ...highestFluxSize(artwork.aspectRatio), format: 'PNG' }; }
      catch (error) { issue = error.message; }
    } else if (!issue) issue = 'Add an aspect ratio or square image to this artwork before FLUX generation.';
    return { ...artwork, generation, issue, status: issue ? 'needs_changes' : 'awaiting_approval' };
  });
  return {
    kind: 'artwork-batch', promptId: crypto.randomUUID(), originalText: batch.originalText,
    collectionName: batchName,
    batchId: batch.batchId || null, artworks, createdAt: new Date().toISOString(),
    candidates: [], brief: { imageCount: artworks.length },
    delivery: { collectionName: batchName, requestedImages: artworks.length, printSizes: [] }
  };
}

export const batchStudioScript = String.raw`<script>
let displayedArtworkBatch=null;
function renderArtworkBatch(data){
  displayedArtworkBatch=data;
  document.querySelector('#fine-agent-form [name=imageCount]').value=data.artworks.length;
  const root=document.querySelector('#candidates');root.replaceChildren();
  const make=(tag,text)=>{const e=document.createElement(tag);e.textContent=text||'';return e;};
  const section=make('section');section.id='artwork-batch';section.className='card';
  section.append(make('h2',data.collectionName+' · '+data.artworks.length+' separate artworks'),make('p','One image per entry, in order. Your prompt fields are preserved; the single-artwork style controls and image count do not override this batch.'));
  const summary=make('p','Prepared locally. No generation or publishing has started.');summary.id='artwork-batch-progress';summary.setAttribute('role','status');section.append(summary);
  const scroll=make('div');scroll.style.overflowX='auto';const table=make('table');table.style.cssText='width:100%;border-collapse:collapse;text-align:left';
  const head=make('thead'),hr=make('tr');for(const label of ['#','Artwork idea','Shape / native pixels','Workflow']){const th=make('th',label);th.scope='col';th.style.padding='12px';hr.append(th);}head.append(hr);table.append(head);const body=make('tbody');
  for(const a of data.artworks){const row=make('tr');row.dataset.artworkNumber=String(a.number);row.style.borderTop='1px solid #66705d';const num=make('td',String(a.number).padStart(2,'0')),title=make('td'),shape=make('td',(a.aspectRatio||'Not specified')+(a.generation?' · '+a.generation.width+' × '+a.generation.height+' px':'')),state=make('td',a.issue||'Awaiting your approval');state.className='batch-item-status';state.style.minWidth='200px';
    title.append(make('strong',a.title));const details=make('details');details.append(make('summary','What to create · full brief'));const pre=make('pre',a.prompt);pre.style.cssText='white-space:pre-wrap;min-width:200px;max-width:600px;font:inherit';details.append(pre);if(a.fields){for(const [key,value] of Object.entries(a.fields)){const line=make('p',key.replaceAll('_',' ')+': '+value);details.append(line);}}title.append(details);
    for(const cell of [num,title,shape,state])cell.style.padding='12px';row.append(num,title,shape,state);body.append(row);
  }table.append(body);scroll.append(table);section.append(scroll);
  section.append(make('p','Flow: brief approval → creation → quality and print checks → price approval → Shopify draft → publish approval. Later stages remain manual/pending until their connections are ready.'),make('p','FLUX generation is paid per image. These are native PNG outputs, not certified print-ready files. Known image failures are recorded and the queue continues; uncertain submissions pause to avoid duplicate charges. No automatic paid retry.'));
  const confirm=make('label');confirm.style.display='block';const checkbox=make('input');checkbox.type='checkbox';confirm.append(checkbox,document.createTextNode(' I reviewed every prompt and ratio and approve paid generation of one image per artwork.'));
  const button=make('button','Generate approved batch · '+data.artworks.length+' images');button.type='button';button.disabled=true;
  const blocked=data.expired||data.artworks.some(a=>a.issue||!a.generation);checkbox.disabled=!!blocked;checkbox.onchange=()=>{button.disabled=!checkbox.checked||blocked;};
  const status=make('p');status.setAttribute('role','status');if(blocked)status.textContent=data.expired?'This saved draft has expired. Prepare it again before approval.':'Correct the marked entries in the source text, then prepare the batch again.';
  button.onclick=async()=>{if(!checkbox.checked)return;button.disabled=true;checkbox.disabled=true;status.textContent='Submitting your approved batch…';try{const r=await fetch('/api/flux/generate-batch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({promptId:data.promptId,approved:true})});const result=await r.json();if(!r.ok)throw Error(result.error||'Could not queue batch');status.textContent=result.jobs.length+' artworks queued. Progress appears in this table and Pipeline.';await refreshArtworkBatchProgress();}catch(error){status.textContent=error.message;checkbox.disabled=false;button.disabled=false;}};
  section.append(confirm,button,status);root.append(section);refreshArtworkBatchProgress();
}
async function refreshArtworkBatchProgress(){
 if(!displayedArtworkBatch)return;
 try{const r=await fetch('/api/flux/jobs');if(!r.ok)return;const {jobs}=await r.json();const relevant=jobs.filter(j=>j.approvalId===displayedArtworkBatch.promptId+':batch');if(!relevant.length)return;
 const root=document.querySelector('#artwork-batch');if(!root)return;const make=(tag,text)=>{const e=document.createElement(tag);e.textContent=text||'';return e;};
 for(const job of relevant){const cell=root.querySelector('[data-artwork-number="'+job.artworkNumber+'"] .batch-item-status');if(!cell)continue;cell.replaceChildren(make('span',job.status.replaceAll('_',' ')));if(job.message)cell.append(make('p',job.message));if(job.assetUrl){const img=make('img');img.src=job.assetUrl;img.alt=job.title;img.style.cssText='display:block;max-width:120px;max-height:120px;object-fit:contain';const link=make('a','Review quality & price');link.href='#production-review';cell.append(img,link);}}
 const done=relevant.filter(j=>j.status==='artwork_ready').length,failed=relevant.filter(j=>j.status==='failed').length,attention=relevant.filter(j=>['paused','needs_attention','submission_uncertain'].includes(j.status)).length;
 document.querySelector('#artwork-batch-progress').textContent=done+' completed · '+failed+' failed · '+attention+' need attention · '+(relevant.length-done-failed-attention)+' pending. '+(done===relevant.length?'Ready for quality review.':'');
 root.querySelector('button').disabled=true;root.querySelector('input[type=checkbox]').disabled=true;
 }catch{/* Preserve visible state until the next refresh. */}
}
async function restoreArtworkBatch(){try{const r=await fetch('/api/creative/batches/latest');if(!r.ok)return;const data=await r.json();if(!data.batch)return;const input=document.querySelector('#fine-agent-form [name=subject]');if(input.value==='Museum-grade contemporary portrait, intimate direct gaze'){input.value=data.batch.originalText;document.querySelector('#fine-agent-form [name=collectionName]').value=data.batch.collectionName;renderFineAgentPreview();renderArtworkBatch(data.batch);document.querySelector('#fine-agent-status').textContent='Saved batch restored · '+data.batch.artworks.length+' separate artworks.';}}catch{/* Do not overwrite the current form on a failed restore. */}}
setInterval(refreshArtworkBatchProgress,5000);restoreArtworkBatch();
</script>`;
