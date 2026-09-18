export const reviewPanel = `<section class="card" id="production-review" style="margin:24px 0">
<div class="eyebrow">Creation to shop</div><h2>Quality control</h2>
<p class="muted">Pending review → Approve → Approved backup → Shopify queue · Reject → Rejected archive</p>
<p>Only undecided artwork appears in Pending. Backups preserve the inspected file; originals are not deleted. Shopify uploads and customer download delivery are still pending integration.</p>
<p class="muted">Recheck reads the current file and measures its pixels; it does not upscale or improve the image. If the file is unchanged, the result stays the same. Open the original to inspect texture, eyes, edges and unwanted marks. Your visual score is recorded separately.</p>
<p><strong>Pricing guide:</strong> check a file to get a USD suggestion based on its pixel dimensions, print capacity and dated digital-download comparisons. These are proposed retail prices, not an appraisal. Existing approved prices stay unchanged.</p>
<button type="button" id="refresh-production-review" class="secondary">Refresh returned images</button>
<button type="button" id="backup-review-decisions" class="secondary">Back up earlier decisions</button>
<nav aria-label="Artwork review folders" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:18px"><button type="button" data-review-zone="pending" aria-pressed="true">Pending</button><button type="button" data-review-zone="approved" aria-pressed="false">Approved / Shopify queue</button><button type="button" data-review-zone="rejected" aria-pressed="false">Rejected</button></nav>
<div id="production-review-status" role="status"></div><div id="production-review-cards" class="approval-grid" style="margin-top:18px"></div></section>`;

export const reviewScript = String.raw`<script>
(() => {
const root=document.querySelector('#production-review-cards');
const message=document.querySelector('#production-review-status');
let zone='pending';
const zoneOf=item=>item.status==='rejected'?'rejected':item.status==='approved_product_prepared'?'approved':'pending';
const zoneNames={pending:'Pending',approved:'Approved / Shopify queue',rejected:'Rejected'};
const make=(tag,text)=>{const n=document.createElement(tag); if(text!==undefined)n.textContent=text; return n;};
function pricingGuide(pricing){
const box=make('section');box.className='pricing-guide';box.style.cssText='padding:16px;margin:16px 0;border:1px solid #b6dc8a;border-radius:14px;background:#202d21;color:#f1f7e9';
box.append(make('h4','Pricing guide · digital download'));
if(!pricing||pricing.status!=='suggested'){
box.append(make('p',pricing?.basis||'Check the resolution to calculate a price suggestion.'),make('p','Enter your own price below. No approved price will be changed.'));return box;
}
const headline=make('p','Suggested: $'+pricing.amount+' USD');headline.style.cssText='font-size:24px;font-weight:700;margin:8px 0';
box.append(headline,make('p','Suggested range: $'+pricing.range.low+'–$'+pricing.range.high+' USD'),make('p',pricing.basis));
const print=pricing.printAt300;
box.append(make('p','Print capacity at 300 PPI: '+print.widthCm+' × '+print.heightCm+' cm ('+print.widthIn+' × '+print.heightIn+' in).'));
const details=make('details');details.append(make('summary','Why this price? Market comparisons & limits'));
details.append(make('p','Sample checked: '+pricing.market.checkedAt+' · '+pricing.market.sources.length+' listings · limited evidence, not live market monitoring.'),make('p','Sample median: $'+Number(pricing.market.medianUsd).toFixed(2)+' USD. Draft print-capacity factor: ×'+pricing.factor+'. Larger usable formats receive a higher factor; this is our proposed pricing rule, not a proven market premium.'));
if(pricing.printAt150){const large=pricing.printAt150;details.append(make('p','At 150 PPI: '+large.widthCm+' × '+large.heightCm+' cm. This is a lower-density size preview, not a quality guarantee.'));}
for(const source of pricing.market.sources){
const row=make('p');const a=make('a',source.seller+' — '+source.title);a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';a.style.color='#d4ffa8';
row.append(a,make('span',' · $'+Number(source.priceUsd).toFixed(2)+' USD ('+source.priceType+')'));
row.append(make('br'),make('small',source.printSizeNote||'Print format not specified.'));
if(source.includedFiles)row.append(make('br'),make('small','Included: '+source.includedFiles));
if(source.licenseNote)row.append(make('br'),make('small',source.licenseNote));
if(source.note)row.append(make('br'),make('small',source.note));
details.append(row);
}
for(const warning of pricing.caveats||[])details.append(make('p',warning));
box.append(details);return box;
}
async function request(url,body){const response=await fetch(url,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;}
async function load(checkedId,feedback){
const edits=new Map();
const expanded=new Map([...root.querySelectorAll('article[data-review-id]')].map(card=>[card.dataset.reviewId,Boolean(card.querySelector('[data-check-results]')?.open)]));
if(checkedId)for(const oldCard of root.querySelectorAll('article[data-review-id]'))edits.set(oldCard.dataset.reviewId,{hash:oldCard.dataset.reviewHash,values:[...oldCard.querySelectorAll('form input')].map(input=>({value:input.value,checked:input.checked}))});
try {const data=await request('/api/production-review');root.replaceChildren();
document.querySelectorAll('[data-review-zone]').forEach(button=>{const view=button.dataset.reviewZone;button.textContent=zoneNames[view]+' ('+data.artworks.filter(item=>zoneOf(item)===view).length+')';button.setAttribute('aria-pressed',String(zone===view));});
const visible=data.artworks.filter(item=>zoneOf(item)===zone);
for(const item of visible){
const card=make('article');card.className='card';card.dataset.reviewId=item.id;card.dataset.reviewHash=item.hash||'';
const img=make('img');img.src=item.reviewImageUrl||item.assetUrl;img.alt=item.title;img.loading='lazy';img.style.cssText='width:100%;height:240px;object-fit:contain;background:#090909';
const link=make('a','Open full-size original');link.href=item.reviewImageUrl||item.assetUrl;link.target='_blank';link.rel='noopener';link.className='button secondary';
const status=make('p',item.id===checkedId&&feedback?feedback:item.status.replaceAll('_',' '));status.className='muted';status.setAttribute('role','status');
const inspect=make('button',item.quality?'Recheck resolution & price':'Check resolution & suggest price');inspect.type='button';
inspect.onclick=async()=>{inspect.disabled=true;inspect.textContent='Checking file…';status.textContent='Reading the original image, measuring pixels and calculating the price guide…';try{const result=await request('/api/production-review/'+encodeURIComponent(item.id)+'/inspect',{});const q=result.quality;const feedback='Check complete: '+q.width+' × '+q.height+' px. '+(result.fileChanged?'The file changed; previous approval was cleared.':item.hash?'Same file; resolution is unchanged.':'File measured successfully.')+' Rechecking does not enlarge the image.';await load(item.id,feedback);}catch(e){status.textContent='Could not check this file: '+e.message+(zone==='pending'?' Use Upload original file below if the source link is blocked.':'');const upload=card.querySelector('[data-review-upload]');if(upload)upload.open=true;inspect.disabled=false;inspect.textContent=item.quality?'Recheck resolution & price':'Check resolution & suggest price';}};
card.append(make('h3',item.title),img,link,status,inspect);
if(zone!=='pending'){
  img.src=item.archive?.url||item.reviewImageUrl||item.assetUrl;
  if(item.archive){const backup=make('a','Open '+item.archive.bucket+' backup');backup.href=item.archive.url;backup.target='_blank';backup.rel='noopener';backup.className='button secondary';card.append(backup,make('p','Backup saved in data/'+item.archive.bucket+' · '+new Date(item.archive.at).toLocaleString()));}
  else card.append(make('p','Backup not yet saved. Use “Back up earlier decisions” above. This is not ready to send to Shopify.'));
  if(zone==='approved'&&item.product){card.append(make('p','Approved price: $'+item.product.price+' USD'),make('p','Next: Shopify upload and Digital Products attachment — not published.'));if(item.currentPriceGuide){const guide=item.currentPriceGuide;card.append(make('p','Measured: '+item.quality.width+' × '+item.quality.height+' px · '+item.quality.maxPrintCm+' at 300 PPI'),make('p',guide.status==='suggested'?'Current price suggestion: $'+guide.amount+' USD · saved price unchanged.':guide.basis));const advice=make('details');advice.dataset.checkResults='true';advice.open=item.id===checkedId||expanded.get(item.id)||false;advice.append(make('summary','Compare with today’s pricing guide · saved price unchanged'),make('p','Reference only. Your approved $'+item.product.price+' USD price remains unchanged.'),pricingGuide(guide));card.append(advice);}const details=make('details');details.append(make('summary','Prepared Shopify fields'));const pre=make('pre',JSON.stringify(item.product,null,2));pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';details.append(pre);card.append(details,make('p',item.product.blockers.join(' ')));}
  if(zone==='rejected')card.append(make('p','Rejected artwork is archived and will not enter the Shopify queue.'));
  root.append(card);continue;
}
if(item.checkedAt)card.append(make('small','Last checked: '+new Date(item.checkedAt).toLocaleString()));
if(zone==='pending'){
const upload=make('details');upload.dataset.reviewUpload='true';upload.append(make('summary','Upload original file'),make('p','If the image link cannot be read, choose the original PNG or JPG for this artwork. A private, unchanged copy will be measured here. This does not approve or publish it. Up to 40 MB and 64 megapixels.'));
const uploadLabel=make('label','Original file for '+item.title);const fileInput=make('input');fileInput.type='file';fileInput.accept='image/png,image/jpeg';fileInput.dataset.reviewFile='true';uploadLabel.append(fileInput);const sendFile=make('button','Upload original & check');sendFile.type='button';sendFile.className='secondary';
sendFile.onclick=async()=>{const file=fileInput.files[0];if(!file){status.textContent='Choose the original PNG or JPG file first.';return;}if(file.size>40*1024*1024){status.textContent='The original must be 40 MB or less.';return;}const type=file.type||(/\.png$/i.test(file.name)?'image/png':/\.jpe?g$/i.test(file.name)?'image/jpeg':'');if(!['image/png','image/jpeg'].includes(type)){status.textContent='Choose a PNG or JPG original.';return;}sendFile.disabled=inspect.disabled=true;status.textContent='Saving the original privately and checking resolution and price…';try{const response=await fetch('/api/production-review/'+encodeURIComponent(item.id)+'/file',{method:'POST',headers:{'content-type':type,'x-file-name':encodeURIComponent(file.name)},body:file});const result=await response.json();if(!response.ok)throw Error(result.error||'File upload failed');await load(item.id,'Original saved and checked: '+result.quality.width+' × '+result.quality.height+' px. Review the price below; nothing was approved or published.');}catch(error){status.textContent='Upload failed: '+error.message;sendFile.disabled=inspect.disabled=false;}};
upload.append(uploadLabel,sendFile);card.append(upload);
if(item.localFile)card.append(make('p','Using your uploaded original: '+item.localFile.name));
}
if(item.quality){const q=item.quality;card.append(make('p',q.width+' × '+q.height+' px · '+q.megapixels+' MP'),make('p','Resolution score: '+q.score+'/100'),make('small',q.scoreLabel),pricingGuide(item.pricing));
const sizes=make('details');sizes.append(make('summary','Check individual print sizes'));for(const s of q.sizes)sizes.append(make('p',s.label+': '+s.ppi+' PPI · '+(s.meets300Ppi?'Resolution sufficient':'Needs a higher-resolution file')+(s.cropNeeded?' · Different aspect ratio; crop required':'')));card.append(sizes);
card.append(make('p',item.visualReview.note));
const form=make('form');
const field=(label,type,value)=>{const l=make('label',label);const input=make('input');input.type=type;input.value=value;input.required=true;l.append(input);form.append(l);return input;};
const title=field('Product title','text',item.product?.title||item.title);
const price=field('Your selling price · USD','number',item.product?.price||item.pricing?.amount||'');price.min='0.01';price.max='10000';price.step='0.01';price.dataset.priceInput='true';
if(item.pricing?.status==='suggested'){const usePrice=make('button','Use suggested $'+item.pricing.amount);usePrice.type='button';usePrice.className='secondary';usePrice.onclick=()=>{price.value=item.pricing.amount;confirmed.checked=false;status.textContent='Suggested price copied. Review it and confirm your approval below.';};form.append(usePrice);}
const score=field('Your visual quality score · 1–10','number',item.approval?.visualScore||'');score.min='1';score.max='10';score.step='1';
const confirmLabel=make('label',' I inspected the original and approve this artwork and price');const confirmed=make('input');confirmed.type='checkbox';confirmed.required=true;confirmed.style.width='auto';confirmLabel.prepend(confirmed);form.append(confirmLabel);
for(const input of [title,price,score])input.addEventListener('input',()=>{confirmed.checked=false;});
const approve=make('button','Approve & prepare Shopify fields');approve.type='submit';form.append(approve);
form.onsubmit=async e=>{e.preventDefault();approve.disabled=reject.disabled=true;try{await request('/api/production-review/'+encodeURIComponent(item.id)+'/decide',{decision:'approved',hash:item.hash,title:title.value,price:price.value,visualScore:score.value,visualConfirmed:confirmed.checked});await load(item.id,'Approved: backup saved and moved to the Shopify queue. Not published yet.');}catch(err){status.textContent=err.message;approve.disabled=reject.disabled=false;}};
const reject=make('button','Reject & archive');reject.type='button';reject.className='secondary';reject.onclick=async()=>{reject.disabled=approve.disabled=true;try{await request('/api/production-review/'+encodeURIComponent(item.id)+'/decide',{decision:'rejected',hash:item.hash});await load(item.id,'Rejected: backup saved and removed from Pending review.');}catch(e){status.textContent=e.message;reject.disabled=approve.disabled=false;}};form.append(reject);card.append(form);
if(item.product){const details=make('details');details.append(make('summary','Prepared Shopify fields'));const pre=make('pre',JSON.stringify(item.product,null,2));pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';details.append(pre);card.append(details,make('p','Publishing pending: '+item.product.blockers.join(' ')));}
}
const saved=edits.get(item.id);if(saved&&saved.hash===(item.hash||'')){[...card.querySelectorAll('form input')].forEach((input,index)=>{const value=saved.values[index];if(value){input.value=value.value;input.checked=value.checked;}});}
root.append(card);
}message.textContent=(feedback?feedback+' ':'')+visible.length+' artwork'+(visible.length===1?'':'s')+' in '+zoneNames[zone]+'.';
if(!visible.length)root.append(make('p',zone==='pending'?'Quality control is clear. New artwork will appear here when it returns.':'No artwork in this folder yet.'));
}catch(e){message.textContent=e.message;}}
document.querySelector('#refresh-production-review').onclick=()=>load();
document.querySelectorAll('[data-review-zone]').forEach(button=>button.onclick=()=>{zone=button.dataset.reviewZone;load();});
document.querySelector('#backup-review-decisions').onclick=async event=>{const button=event.currentTarget;button.disabled=true;message.textContent='Backing up earlier decisions…';try{const result=await request('/api/production-review/archive-decisions',{});await load(null,result.archived+' backups saved; '+result.alreadyBackedUp+' already saved; '+result.returnedToReview+' changed files returned to review.'+(result.errors.length?' Backup issues: '+result.errors.map(e=>e.title+': '+e.message).join(' · '):''));}catch(error){message.textContent=error.message;}finally{button.disabled=false;}};
load();
})();
</script>`;
