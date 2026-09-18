export const fluxPanel = `<section class="card" id="flux-studio" style="margin:24px 0"><div class="eyebrow">Automatic creation</div><h2>FLUX.2 Pro studio</h2><p>Prepare art directions above, then choose <b>Approve &amp; generate with FLUX</b> on your favourite direction. The image count comes from your collection brief.</p><p class="muted">Pay per generated image. New images use the highest native resolution for the chosen shape (up to 4 MP), saved as PNG. Larger outputs cost more than the previous 1 MP setting; large print files still need preparation. Midjourney remains available as a manual option.</p><button id="flux-check" class="secondary">Check connection &amp; credits</button><p id="flux-connection" role="status">Connection not checked</p><div id="flux-jobs" aria-live="polite"></div></section>`;
export const fluxScript=String.raw`<script>
(() => {
const n=(tag,text)=>{const e=document.createElement(tag);e.textContent=text||'';return e;};
const state=document.querySelector('#flux-connection');
const req=async(url,body)=>{const r=await fetch(url,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d;};
const original=renderCandidates;
renderCandidates=function(data){original(data);document.querySelectorAll('#candidates .candidate').forEach((card,index)=>{
const button=n('button','Approve & generate '+(data.brief.imageCount||1)+' images with FLUX');button.type='button';
button.disabled=!data.generation;const detail=n('p',data.generation?'Requested: '+data.generation.width+' × '+data.generation.height+' px · PNG · highest native resolution.':(data.generationMessage||'Add a ratio to the prompt before FLUX generation.'));card.append(detail);const status=n('p');status.setAttribute('role','status');card.append(button,status);
button.onclick=async()=>{button.disabled=true;status.textContent='Sending approved direction…';try{const result=await req('/api/flux/generate',{promptId:data.promptId,candidateIndex:index,approved:true});status.textContent=result.jobs.length+' images queued. Follow progress in FLUX studio.';document.querySelector('#flux-studio').scrollIntoView({behavior:'smooth'});await refresh();}catch(e){status.textContent=e.message;button.disabled=false;}};
});};
let signature='';
async function refresh(){try{const result=await req('/api/flux/jobs');const root=document.querySelector('#flux-jobs');root.replaceChildren();for(const job of result.jobs){const row=n('div',job.title+' — '+job.status.replaceAll('_',' '));row.className='job';row.append(n('p',job.width+' × '+job.height+' px requested'));if(job.message)row.append(n('p',job.message));if(job.assetUrl){const image=n('img');image.src=job.assetUrl;image.alt=job.title;image.style.cssText='max-width:180px;max-height:220px;object-fit:contain';row.append(image);const a=n('a','Review quality & price');a.href='#production-review';a.className='button secondary';row.append(a);}root.append(row);}if(!result.jobs.length)root.append(n('p','No FLUX generations yet.'));
const next=result.jobs.filter(j=>j.assetUrl).map(j=>j.id).join(',');if(next!==signature){signature=next;document.querySelector('#refresh-production-review').click();}
}catch(e){state.textContent=e.message;}}
document.querySelector('#flux-check').onclick=async()=>{state.textContent='Checking BFL…';try{const r=await req('/api/flux/connection');state.textContent=r.verified?'Connected · '+r.credits+' credits available':r.message;}catch(e){state.textContent=e.message;}};
refresh();setInterval(refresh,5000);
})();
</script>`;
