// A LUMAS-style product detail page: size-tiered pricing, a trust strip, and the room preview as the
// hero image. Preview only, like gallery.js — a real purchase happens on the Shopify listing once an
// artwork is published there. Nothing here fakes a checkout that doesn't exist.
export const productPageStyles = `*{box-sizing:border-box}.pdp{--ink:#eee8df;--sub:#aaa49c;--line:#2c2a25;--accent:#d8c9a3;background:#10100f;color:var(--ink);font:15px/1.6 Arial,sans-serif;min-height:100vh}.pdp a{color:inherit}.pdp header{height:88px;display:flex;align-items:center;justify-content:space-between;padding:0 5vw;border-bottom:1px solid var(--line)}.pdp .brand{font-size:17px;letter-spacing:.22em;text-transform:lowercase}.pdp header nav{display:flex;gap:22px;font-size:11px;letter-spacing:.1em}.pdp header nav a{text-decoration:none;color:var(--sub)}.pdp main{max-width:1180px;margin:auto;padding:6vw 5vw;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(280px,0.85fr);gap:6vw}@media(max-width:860px){.pdp main{grid-template-columns:minmax(0,1fr);padding:8vw 6vw}}.pdp .stage{position:relative;aspect-ratio:1/1;background:#161613;border:1px solid var(--line);overflow:hidden}.pdp .stage img{width:100%;height:100%;object-fit:cover;display:block}.pdp .stage .tag{position:absolute;top:16px;left:16px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;background:#000a;padding:6px 11px;color:var(--accent)}.pdp .view-toggle{display:flex;gap:8px;margin-top:14px}.pdp .view-toggle button{flex:1;padding:11px;background:transparent;border:1px solid #4a4438;color:var(--ink);font-size:11px;letter-spacing:.08em;cursor:pointer}.pdp .view-toggle button[aria-pressed=true]{background:var(--accent);color:#151310;border-color:var(--accent)}.pdp .eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:.22em;color:var(--accent);margin:0 0 10px}.pdp h1{font:normal clamp(28px,3vw,42px)/1.15 Georgia,serif;margin:0 0 14px}.pdp .about{color:#c9c2b4;font-size:14px;margin:0 0 26px;max-width:46ch}.pdp .sizes{display:grid;gap:9px;margin-bottom:22px}.pdp .size-option{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:13px 16px;border:1px solid var(--line);background:#161613;cursor:pointer;text-align:left;color:var(--ink)}.pdp .size-option[aria-pressed=true]{border-color:var(--accent)}.pdp .size-option:disabled{opacity:.4;cursor:not-allowed}.pdp .size-option .dims{font-size:11px;color:var(--sub);display:block;margin-top:2px}.pdp .size-option .price{font-size:15px;white-space:nowrap}.pdp .size-note{font-size:11px;color:var(--sub);margin:-10px 0 22px}.pdp .cta{width:100%;padding:17px;background:var(--accent);color:#161310;border:0;font-size:13px;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;margin-bottom:10px}.pdp .cta:disabled{background:#3a362d;color:#8a8577;cursor:not-allowed}.pdp .preview-note{font-size:11px;color:var(--sub);text-align:center;margin:0 0 26px}.pdp .trust{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;padding:20px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-bottom:22px}.pdp .trust div{font-size:11px;color:var(--sub);text-align:center;line-height:1.5}.pdp .trust strong{display:block;color:var(--ink);font-size:12px;margin-bottom:3px;font-weight:600}.pdp .edition{font-size:12px;color:var(--sub);margin-bottom:6px}.pdp footer{padding:5vw;border-top:1px solid var(--line);color:var(--sub);font-size:11px;text-align:center}`;

export const productPageScript = `(function(){
  const stage=document.querySelector('#pdp-stage'),img=document.querySelector('#pdp-image'),tag=document.querySelector('#pdp-tag');
  const roomBtn=document.querySelector('#view-room'),artBtn=document.querySelector('#view-art');
  const sizesEl=document.querySelector('#pdp-sizes'),noteEl=document.querySelector('#pdp-size-note'),cta=document.querySelector('#pdp-cta');
  const params=new URLSearchParams(location.search),id=params.get('id')||'';
  let artUrl='',roomUrl='/assets/spaces/black-room-01.png',selected=null;
  function money(v){return '$'+v;}
  function renderSizes(ladder){
    sizesEl.replaceChildren();
    if(!ladder||!ladder.sizes||!ladder.sizes.length){noteEl.textContent='Size pricing is not available for this piece yet.';cta.disabled=true;return;}
    ladder.sizes.forEach((s,i)=>{
      const b=document.createElement('button');b.type='button';b.className='size-option';b.disabled=!s.available;
      b.setAttribute('aria-pressed',String(i===0&&s.available));
      b.innerHTML='<span>'+s.size+'<span class="dims">'+s.label+'</span></span><span class="price">'+(s.available?money(s.priceUsd):'Unavailable')+'</span>';
      if(s.available)b.onclick=()=>{selected=s;document.querySelectorAll('.size-option').forEach(x=>x.setAttribute('aria-pressed','false'));b.setAttribute('aria-pressed','true');cta.disabled=false;cta.textContent='Reserve — '+s.size+' · '+money(s.priceUsd);};
      else b.title=s.reason||'This size needs a higher-resolution master.';
      sizesEl.append(b);
    });
    const first=ladder.sizes.find(s=>s.available);
    if(first){selected=first;cta.disabled=false;cta.textContent='Reserve — '+first.size+' · '+money(first.priceUsd);}
    else{cta.disabled=true;cta.textContent='Not yet available at any size';}
    noteEl.textContent='Prices are a draft market-based suggestion, not a final listing price. '+(ladder.basis||'');
  }
  roomBtn.onclick=()=>{img.src=roomUrl;tag.textContent='In a room';roomBtn.setAttribute('aria-pressed','true');artBtn.setAttribute('aria-pressed','false');};
  artBtn.onclick=()=>{img.src=artUrl;tag.textContent='Artwork only';artBtn.setAttribute('aria-pressed','true');roomBtn.setAttribute('aria-pressed','false');};
  fetch('/api/production-review').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{
    const item=data.artworks.find(a=>a.id===id)||data.artworks[0];
    if(!item){document.querySelector('#pdp-title').textContent='No artwork available for preview.';return;}
    artUrl=item.reviewImageUrl||item.assetUrl;img.src=artUrl;tag.textContent='Artwork only';artBtn.setAttribute('aria-pressed','true');
    document.querySelector('#pdp-title').textContent=item.title||'Untitled';
    renderSizes(item.priceLadder||item.currentPriceLadder);
  }).catch(()=>{noteEl.textContent='Could not load pricing. Refresh the page.';});
})();`;

export function productPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Dark Matters · Artwork</title><style>${productPageStyles}</style></head>
<body class="pdp"><header><a class="brand" href="/gallery">the dark matters</a><nav><a href="/gallery">Collection</a><a href="/size-preview">Print sizes</a><a href="/spaces">Viewing room</a></nav></header>
<main>
  <div>
    <div class="stage" id="pdp-stage"><span class="tag" id="pdp-tag">Artwork only</span><img id="pdp-image" alt="Artwork preview"></div>
    <div class="view-toggle"><button id="view-art" type="button" aria-pressed="true">Artwork only</button><button id="view-room" type="button" aria-pressed="false">In a room</button></div>
  </div>
  <div>
    <p class="eyebrow">Limited digital edition</p>
    <h1 id="pdp-title">Loading…</h1>
    <p class="about">A high-resolution digital file, upscaled and verified for genuine 300 DPI print quality at the size you choose.</p>
    <div class="sizes" id="pdp-sizes"></div>
    <p class="size-note" id="pdp-size-note"></p>
    <button class="cta" id="pdp-cta" type="button" disabled>Loading pricing…</button>
    <p class="preview-note">Design preview — reservations are not processed here yet. Purchases will run through the store's Shopify listing once published.</p>
    <div class="trust">
      <div><strong>Instant download</strong>Delivered straight to your account after checkout</div>
      <div><strong>Verified resolution</strong>Every size is checked against its file's real pixel count</div>
      <div><strong>Secure checkout</strong>Processed by Shopify, not stored on this site</div>
    </div>
  </div>
</main>
<footer>Digital art for spaces with a point of view. <a href="mailto:hello@thedarkmatters.art">hello@thedarkmatters.art</a></footer>
<script>${productPageScript}</script>
</body></html>`;
}
