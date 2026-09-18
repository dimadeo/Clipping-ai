const steps = [
  ['brief', 'Creative brief'], ['directions', 'Art directions'], ['generation-approval', 'Generation approval'],
  ['provider', 'Creation provider'], ['creation-queue', 'Creation queue'], ['generation', 'Image generation'],
  ['originals', 'Original files'], ['resolution', 'Resolution check'], ['visual-review', 'Visual review'],
  ['pricing', 'Price guidance'], ['product-approval', 'Product approval'], ['backups', 'Archive backups'],
  ['product-fields', 'Product details'], ['shopify', 'Shopify connection'], ['digital-delivery', 'Digital delivery'],
  ['publishing', 'Publishing'], ['monitoring', 'Monitoring'],
];

function flowLayout(columns) {
  return '#pipeline-control .pipeline-flow{grid-template-columns:repeat(' + columns + ',minmax(0,1fr))}' + steps.map((_, index) => {
    const row = Math.floor(index / columns), position = index % columns, reverse = row % 2 === 1;
    const column = reverse ? columns - position : position + 1;
    const nextRow = position === columns - 1;
    return '#pipeline-control .pipeline-step:nth-child(' + (index + 1) + '){grid-row:' + (row + 1) + ';grid-column:' + column + '}' +
      '#pipeline-control .pipeline-step:nth-child(' + (index + 1) + ') .pipeline-arrow{' +
      (nextRow ? 'top:auto;bottom:-30px;left:calc(50% - 12px);right:auto;transform:rotate(90deg)' : reverse ? 'top:calc(50% - 14px);bottom:auto;left:-31px;right:auto;transform:rotate(180deg)' : 'top:calc(50% - 14px);bottom:auto;left:auto;right:-31px;transform:none') + '}';
  }).join('');
}

export const pipelinePanel = `<section class="card" id="pipeline-control" aria-labelledby="pipeline-heading">
  <header class="pipeline-header">
    <div><p class="pipeline-eyebrow">THE DARK MATTERS / OPERATIONS</p><h2 id="pipeline-heading">Your artwork pipeline</h2><p class="pipeline-intro">17 stages, from the first idea to a delivered digital artwork. Select a stage to see its status and next action.</p></div>
    <div class="pipeline-toolbar" aria-label="Pipeline monitoring controls"><button type="button" id="pipeline-refresh">Refresh status</button><button type="button" id="pipeline-pause" class="pipeline-secondary">Pause monitoring</button><button type="button" id="pipeline-restart" class="pipeline-secondary">Restart monitoring</button></div>
  </header>
  <div class="pipeline-monitor-line"><span id="pipeline-monitor-state">Monitoring starts when this view is open.</span><span id="pipeline-last-success">No successful status check yet.</span></div>
  <p class="pipeline-monitor-note">Monitoring refreshes this view every 15 seconds. Restart monitoring restarts status updates only.</p>
  <div id="pipeline-error" class="pipeline-error" role="alert" hidden></div>
  <p id="pipeline-loading" class="pipeline-muted">Loading pipeline status when this view opens…</p>
  <dl class="pipeline-summary" aria-label="Artwork and job totals">${[['total', 'Artworks'], ['pending', 'In review'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['queued', 'Queued jobs'], ['running', 'Running jobs'], ['failed', 'Failed jobs']].map(([key, label]) => '<div><dt>' + label + '</dt><dd id="pipeline-total-' + key + '">—</dd></div>').join('')}</dl>
  <div class="pipeline-map-heading"><h3>Follow the stages</h3><p>Numbers and arrows show the order. Status labels show the current evidence.</p></div>
  <ol class="pipeline-flow" aria-label="The 17 stages in order">${steps.map(([id, title], index) => '<li class="pipeline-step"><button type="button" class="pipeline-stage" data-pipeline-stage="' + id + '" aria-pressed="' + (index === 0) + '" aria-controls="pipeline-stage-detail"><span class="pipeline-hex" aria-hidden="true">' + String(index + 1).padStart(2, '0') + '</span><span class="pipeline-stage-title">' + title + '</span><span class="pipeline-badge" data-pipeline-status>Awaiting status</span><span class="pipeline-stage-count" data-pipeline-count>Stage ' + (index + 1) + '</span></button><span class="pipeline-arrow" aria-hidden="true">➜</span></li>').join('')}</ol>
  <section id="pipeline-stage-detail" class="pipeline-detail" aria-labelledby="pipeline-detail-title">
    <div class="pipeline-detail-top"><div><p class="pipeline-eyebrow">SELECTED STAGE</p><h3 id="pipeline-detail-title">01 · Creative brief</h3></div><span id="pipeline-detail-status" class="pipeline-badge">Awaiting status</span></div>
    <p id="pipeline-detail-copy">The first status check will show what is ready and what needs attention.</p>
    <div class="pipeline-detail-actions"><button type="button" id="pipeline-check" disabled>Check stage</button><a id="pipeline-open" class="pipeline-open" hidden>Open stage →</a><a class="pipeline-open" href="#pipeline-control">Back to stage map ↑</a><span id="pipeline-check-note" class="pipeline-muted">Checks the saved stage information.</span></div>
    <div id="pipeline-artwork-controls" class="pipeline-artwork-controls" hidden>
      <label for="pipeline-artwork">Artwork to recheck</label><select id="pipeline-artwork"><option value="">Select an artwork…</option></select>
      <p id="pipeline-artwork-info" class="pipeline-muted">Select an artwork to see its saved file and review information.</p>
      <button type="button" id="pipeline-recheck" disabled>Recheck selected artwork</button>
      <p class="pipeline-recheck-note">A recheck reads the actual image and updates its measured resolution and price guidance. It does not upscale the file. Changed files require fresh approval.</p>
    </div>
    <p id="pipeline-action-result" class="pipeline-action-result" role="status" aria-live="polite"></p>
  </section>
  <section class="pipeline-systems-section" aria-labelledby="pipeline-systems-heading"><div class="pipeline-map-heading"><h3 id="pipeline-systems-heading">Systems &amp; connections</h3><p>Installed means available locally. Configured means settings are present. Verified means the reported capability has been checked.</p></div><div id="pipeline-systems" class="pipeline-systems"><p class="pipeline-muted">Connection information will appear after a successful status check.</p></div></section>
  <section id="pipeline-issues-section" class="pipeline-issues" aria-labelledby="pipeline-issues-heading" hidden><h3 id="pipeline-issues-heading">Needs attention</h3><ul id="pipeline-issues"></ul></section>
</section>`;

export const pipelineStyles = `<style>
#pipeline-control{--pipeline-black:#000;--pipeline-surface:#111316;--pipeline-glass-fill:var(--pipeline-surface);--pipeline-teal:#98ffe3;--pipeline-amber:#ffda9d;--pipeline-violet:#d0b9ff;--pipeline-text:#fff;--pipeline-muted:#cbd2d9;--pipeline-line:rgba(238,245,255,.26);--pipeline-rim:rgba(255,255,255,.38);--pipeline-focus:#ffe5ad;--pipeline-orb-amber:244,158,65;--pipeline-orb-cyan:45,223,185;--pipeline-orb-violet:163,117,248;--pipeline-orb-rgb:var(--pipeline-orb-cyan);--pipeline-radius:24px;--pipeline-small-radius:14px;--pipeline-depth:inset 0 1px 0 rgba(255,255,255,.22),inset 1px 0 0 rgba(255,255,255,.055),inset 0 -18px 34px rgba(0,0,0,.34),0 16px 34px -12px rgba(0,0,0,.95),0 2px 7px rgba(0,0,0,.9);--pipeline-reflection:linear-gradient(145deg,rgba(255,255,255,.105),rgba(255,255,255,.018) 36%,rgba(255,255,255,.035));background:var(--pipeline-black);color:var(--pipeline-text);padding:clamp(18px,3vw,40px);border:1px solid var(--pipeline-line);border-radius:28px;font-size:18px;line-height:1.55;overflow:hidden;isolation:isolate}
#pipeline-control *{box-sizing:border-box}#pipeline-control [hidden]{display:none!important}#pipeline-control h2,#pipeline-control h3,#pipeline-control h4,#pipeline-control p{margin:0}#pipeline-control h2{color:#fff;font-size:clamp(28px,3.5vw,42px);line-height:1.2;letter-spacing:-.035em;margin:9px 0 15px}#pipeline-control h3{font-size:24px;line-height:1.3;color:#fff}#pipeline-control h4{font-size:21px;color:#fff}#pipeline-control p{overflow-wrap:anywhere}#pipeline-control .pipeline-eyebrow{font-size:13px;letter-spacing:.15em;font-weight:700;color:var(--pipeline-teal)}#pipeline-control .pipeline-intro{max-width:760px;color:#d4e4e7}#pipeline-control .pipeline-header{display:flex;align-items:flex-start;justify-content:space-between;gap:28px}#pipeline-control .pipeline-toolbar{display:flex;gap:10px;flex-wrap:wrap;max-width:390px;flex-shrink:0;justify-content:flex-end}
#pipeline-control button,#pipeline-control .pipeline-open{font:inherit;font-size:17px;line-height:1.4;font-weight:650;min-height:46px;border-radius:9px;border:1px solid var(--pipeline-teal);background:var(--pipeline-teal);color:#062219;padding:10px 16px;cursor:pointer;letter-spacing:0}#pipeline-control button.pipeline-secondary{background:#101e24;color:#e4f6f5;border-color:#7a9eaa}#pipeline-control button:hover:not(:disabled){filter:brightness(1.12)}#pipeline-control button:disabled{cursor:default;opacity:.58}#pipeline-control :is(button,select,a):focus-visible{outline:3px solid var(--pipeline-amber);outline-offset:4px}#pipeline-control .pipeline-open{display:inline-flex;align-items:center;background:transparent;border-color:#91cfc4;color:#a6ffea;text-decoration:none}#pipeline-control .pipeline-monitor-line{display:flex;gap:15px 30px;justify-content:space-between;flex-wrap:wrap;margin-top:25px;font-size:15px;color:#d2e5e7}#pipeline-control .pipeline-monitor-note{margin-top:8px;font-size:15px;color:var(--pipeline-muted)}#pipeline-control .pipeline-muted{color:var(--pipeline-muted);font-size:16px}#pipeline-control #pipeline-loading{margin-top:18px}#pipeline-control .pipeline-error{border:1px solid #ffb29c;background:#321b18;color:#ffe7df;border-radius:10px;padding:16px;margin-top:20px}
#pipeline-control .pipeline-summary{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px;margin:28px 0 34px}#pipeline-control .pipeline-summary>div{background:#0c191f;border:1px solid #304b54;border-radius:10px;padding:15px}#pipeline-control .pipeline-summary dt{font-size:14px;color:#c0d4d7}#pipeline-control .pipeline-summary dd{font-size:31px;line-height:1.2;color:#fff;font-weight:650;margin:6px 0 0}#pipeline-control .pipeline-map-heading{display:flex;justify-content:space-between;align-items:baseline;gap:14px 30px;margin-bottom:22px}#pipeline-control .pipeline-map-heading p{font-size:16px;color:var(--pipeline-muted);max-width:680px}
#pipeline-control .pipeline-flow{display:grid;gap:38px 36px;list-style:none;padding:0;margin:0 0 36px}#pipeline-control .pipeline-step{min-width:0;position:relative}#pipeline-control button.pipeline-stage{height:100%;min-height:193px;width:100%;text-align:left;display:flex;flex-direction:column;align-items:flex-start;gap:10px;border:1px solid #477078;background:linear-gradient(150deg,#112b32,#09161b 75%);color:#f2fbfb;padding:17px;border-radius:15px;box-shadow:inset 0 1px 0 #77e1cd12}#pipeline-control button.pipeline-stage[aria-pressed=true]{border:2px solid var(--pipeline-teal);padding:16px;background:linear-gradient(145deg,#16433f,#0b1b20 75%);box-shadow:0 0 24px #68eed221,inset 0 0 18px #72f3d80a}#pipeline-control .pipeline-hex{height:48px;width:52px;flex-shrink:0;display:grid;place-items:center;font-size:19px;font-weight:750;color:#08251e;background:var(--pipeline-teal);clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)}#pipeline-control .pipeline-stage-title{font-size:18px;line-height:1.3;font-weight:650;overflow-wrap:anywhere}#pipeline-control .pipeline-stage-count{font-size:14px;line-height:1.35;color:#bfd4d8;margin-top:auto;font-weight:400}#pipeline-control .pipeline-badge{display:inline-block;font-size:13px;line-height:1.4;font-weight:650;color:#d6e6e9;border:1px solid #687f88;border-radius:6px;background:#17262d;padding:4px 8px;white-space:normal}#pipeline-control .pipeline-badge[data-state=ready]{color:#a6ffe5;border-color:#4caa91;background:#102f29}#pipeline-control .pipeline-badge[data-state=running]{color:#ffdfa8;border-color:#c2914d;background:#332813}#pipeline-control .pipeline-badge[data-state=waiting],#pipeline-control .pipeline-badge[data-state=manual]{color:#ffe0b3;border-color:#ac8554;background:#2b251c}#pipeline-control .pipeline-badge[data-state=blocked],#pipeline-control .pipeline-badge[data-state=not-connected]{color:#ffc8bc;border-color:#bc877d;background:#2b1d1c}#pipeline-control .pipeline-arrow{position:absolute;width:26px;height:28px;text-align:center;font-size:27px;line-height:1;color:var(--pipeline-amber);text-shadow:0 0 12px #ffaf4b88;pointer-events:none}#pipeline-control .pipeline-step:last-child .pipeline-arrow{display:none}
${flowLayout(5)}
#pipeline-control .pipeline-detail{padding:25px;background:#0e2026;border:1px solid #6ca499;border-radius:14px;box-shadow:0 0 28px #57c8ad0b}#pipeline-control .pipeline-detail-top{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:17px}#pipeline-control .pipeline-detail-top h3{margin-top:7px}#pipeline-control .pipeline-detail-actions{display:flex;align-items:center;gap:12px 18px;flex-wrap:wrap;margin-top:20px}#pipeline-control .pipeline-artwork-controls{border-top:1px solid #47636b;margin-top:25px;padding-top:22px}#pipeline-control .pipeline-artwork-controls label{display:block;font-size:18px;color:#f2fbfc;margin-bottom:9px}#pipeline-control select{font:inherit;font-size:17px;min-height:48px;background:#061116;color:#fff;border:1px solid #9eb8be;border-radius:8px;max-width:100%;width:100%;padding:11px}#pipeline-control #pipeline-artwork-info{margin:12px 0}#pipeline-control .pipeline-recheck-note{font-size:16px;max-width:940px;color:#f1d5af;margin-top:15px}#pipeline-control .pipeline-action-result{margin-top:17px;color:#b4ffe6}#pipeline-control .pipeline-action-result:empty{display:none}
#pipeline-control .pipeline-systems-section{margin-top:38px}#pipeline-control .pipeline-systems{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:17px}#pipeline-control .pipeline-system{background:#101a21;border:1px solid #49616d;border-radius:12px;padding:21px;min-width:0}#pipeline-control .pipeline-system-role{font-size:16px;color:#cbdce0;margin:7px 0 14px}#pipeline-control .pipeline-system-facts{display:grid;grid-template-columns:auto 1fr;gap:7px 16px;font-size:15px;margin:18px 0}#pipeline-control .pipeline-system-facts dt{color:#b9d0d6}#pipeline-control .pipeline-system-facts dd{color:#f0f8f9;margin:0;text-align:right;overflow-wrap:anywhere}#pipeline-control .pipeline-system-detail{font-size:16px;color:#c6d7dd}#pipeline-control .pipeline-system-version{font-size:13px;color:#b3cbd3;margin-top:13px}#pipeline-control .pipeline-issues{margin-top:28px;border:1px solid #a78456;padding:22px;border-radius:12px;background:#221e17}#pipeline-control .pipeline-issues ul{margin:15px 0 0;padding-left:22px}#pipeline-control .pipeline-issues li{margin-bottom:10px;font-size:17px}
@media(max-width:1300px){#pipeline-control .pipeline-header{flex-direction:column}#pipeline-control .pipeline-toolbar{max-width:none;justify-content:flex-start}#pipeline-control .pipeline-systems{grid-template-columns:repeat(2,minmax(0,1fr))}${flowLayout(3)}}
@media(max-width:760px){#pipeline-control .pipeline-summary{grid-template-columns:repeat(4,minmax(0,1fr))}#pipeline-control .pipeline-summary>div{padding:12px}#pipeline-control .pipeline-map-heading{display:block}#pipeline-control .pipeline-map-heading p{margin-top:9px}#pipeline-control .pipeline-systems{grid-template-columns:1fr}#pipeline-control .pipeline-flow{gap:34px 35px}#pipeline-control .pipeline-detail{padding:19px}${flowLayout(2)}}
@media(max-width:480px){#pipeline-control{padding:17px}#pipeline-control .pipeline-summary{grid-template-columns:repeat(2,minmax(0,1fr))}#pipeline-control .pipeline-flow{gap:35px}#pipeline-control button.pipeline-stage{min-height:155px;display:grid;grid-template-columns:55px 1fr;gap:8px 16px;align-items:center}#pipeline-control .pipeline-hex{grid-column:1;grid-row:1 / 4}#pipeline-control .pipeline-stage-title,#pipeline-control .pipeline-stage-count,#pipeline-control .pipeline-stage .pipeline-badge{grid-column:2;justify-self:start}#pipeline-control .pipeline-detail-top{flex-direction:column}#pipeline-control .pipeline-toolbar button{width:100%}${flowLayout(1)}}
/* Dark frosted surfaces: ambient light is decorative; borders and labels carry state. */
#pipeline-control .pipeline-step:nth-child(3n+1),#pipeline-control .pipeline-system:nth-child(3n+1),#pipeline-control .pipeline-summary>div:nth-child(3n+1){--pipeline-orb-rgb:var(--pipeline-orb-amber)}
#pipeline-control .pipeline-step:nth-child(3n+2),#pipeline-control .pipeline-system:nth-child(3n+2),#pipeline-control .pipeline-summary>div:nth-child(3n+2){--pipeline-orb-rgb:var(--pipeline-orb-cyan)}
#pipeline-control .pipeline-step:nth-child(3n),#pipeline-control .pipeline-system:nth-child(3n),#pipeline-control .pipeline-summary>div:nth-child(3n){--pipeline-orb-rgb:var(--pipeline-orb-violet)}
#pipeline-control .pipeline-header{padding-bottom:4px}
#pipeline-control .pipeline-eyebrow{color:var(--pipeline-muted)}
#pipeline-control .pipeline-intro,#pipeline-control .pipeline-detail-copy,#pipeline-control .pipeline-artwork-controls label{color:var(--pipeline-text)}
#pipeline-control .pipeline-muted,#pipeline-control .pipeline-monitor-note,#pipeline-control .pipeline-map-heading p,#pipeline-control .pipeline-system-role,#pipeline-control .pipeline-system-detail,#pipeline-control .pipeline-system-version{color:var(--pipeline-muted);font-size:16px}
#pipeline-control .pipeline-monitor-line{color:var(--pipeline-muted);font-size:16px}
#pipeline-control .pipeline-toolbar{align-items:flex-start}
#pipeline-control button,#pipeline-control .pipeline-open{font-size:18px;color:var(--pipeline-text);border-radius:var(--pipeline-small-radius);border-color:rgba(168,255,231,.7);background:linear-gradient(145deg,rgba(142,255,223,.16),rgba(12,30,25,.35)),#121b19;box-shadow:inset 0 1px 0 rgba(255,255,255,.18),inset 0 -2px 6px rgba(0,0,0,.3),0 5px 12px rgba(0,0,0,.55)}
#pipeline-control button.pipeline-secondary,#pipeline-control .pipeline-open{background:var(--pipeline-reflection),#131519;border-color:var(--pipeline-rim);color:var(--pipeline-text)}
#pipeline-control button:hover:not(:disabled){filter:none;border-color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.38),inset 0 -2px 6px rgba(0,0,0,.35),0 6px 18px rgba(0,0,0,.75)}
#pipeline-control button:disabled{opacity:1;color:#9ea7b0;border-color:#535c65;background:#16191d;box-shadow:inset 0 1px 0 rgba(255,255,255,.06);cursor:not-allowed}
#pipeline-control :is(button,select,a):focus-visible{outline:3px solid var(--pipeline-focus);outline-offset:5px}
#pipeline-control .pipeline-open:hover{border-color:#fff;color:#fff;text-decoration:underline;text-underline-offset:4px}
#pipeline-control .pipeline-summary{gap:14px}
#pipeline-control .pipeline-summary>div{position:relative;isolation:isolate;background:var(--pipeline-reflection),radial-gradient(ellipse at 90% 120%,rgba(var(--pipeline-orb-rgb),.16),transparent 66%),var(--pipeline-glass-fill);border:1px solid var(--pipeline-line);border-top-color:var(--pipeline-rim);border-radius:18px;box-shadow:var(--pipeline-depth)}
#pipeline-control .pipeline-summary dt{font-size:18px;line-height:1.4;color:var(--pipeline-text)}
#pipeline-control .pipeline-summary dd{font-size:33px;margin-top:11px;text-shadow:0 2px 8px rgba(0,0,0,.6)}
#pipeline-control .pipeline-step{isolation:isolate}
#pipeline-control .pipeline-step::before{content:'';position:absolute;z-index:-1;left:26%;right:2%;top:24%;bottom:-9%;border-radius:50%;background:radial-gradient(ellipse,rgba(var(--pipeline-orb-rgb),.36),rgba(var(--pipeline-orb-rgb),.14) 40%,transparent 70%);filter:blur(19px);pointer-events:none}
#pipeline-control button.pipeline-stage{position:relative;isolation:isolate;overflow:hidden;border:1px solid var(--pipeline-line);border-top-color:var(--pipeline-rim);border-radius:var(--pipeline-radius);background:var(--pipeline-reflection),radial-gradient(ellipse at 88% 120%,rgba(var(--pipeline-orb-rgb),.19),transparent 72%),var(--pipeline-glass-fill);color:var(--pipeline-text);box-shadow:var(--pipeline-depth)}
#pipeline-control button.pipeline-stage::after{content:'';position:absolute;inset:3px;z-index:-1;border:1px solid rgba(255,255,255,.055);border-top-color:rgba(255,255,255,.12);border-radius:21px;pointer-events:none}
#pipeline-control button.pipeline-stage:hover:not(:disabled){border-color:rgba(255,255,255,.78);box-shadow:var(--pipeline-depth),0 0 0 1px rgba(255,255,255,.12)}
#pipeline-control button.pipeline-stage[aria-pressed=true]{border:2px solid #fff;padding:16px;background:var(--pipeline-reflection),radial-gradient(ellipse at 88% 120%,rgba(var(--pipeline-orb-rgb),.19),transparent 72%),var(--pipeline-glass-fill);box-shadow:var(--pipeline-depth),0 0 0 2px #000,0 0 0 3px rgba(255,255,255,.62)}
#pipeline-control button.pipeline-stage[aria-pressed=true]:hover:not(:disabled){border-color:#fff;box-shadow:var(--pipeline-depth),0 0 0 2px #000,0 0 0 3px rgba(255,255,255,.82)}
#pipeline-control .pipeline-hex{color:#fff;background:linear-gradient(150deg,rgba(255,255,255,.3),rgba(255,255,255,.04) 44%,rgba(var(--pipeline-orb-rgb),.2)),#21272b;text-shadow:0 1px 4px #000;box-shadow:inset 0 1px 0 rgba(255,255,255,.45),inset 0 -8px 12px rgba(0,0,0,.4)}
#pipeline-control .pipeline-stage-title{font-size:18px;color:var(--pipeline-text);text-shadow:0 1px 5px rgba(0,0,0,.75)}
#pipeline-control .pipeline-stage-count{font-size:16px;color:var(--pipeline-muted)}
#pipeline-control .pipeline-badge{font-size:15px;background:#1a1e24;border-color:#77828e;color:#f0f3f7;box-shadow:inset 0 1px 0 rgba(255,255,255,.055)}
#pipeline-control .pipeline-badge[data-state=ready]{color:#baffdf;border-color:#7bb39c;background:#14291f}
#pipeline-control .pipeline-badge[data-state=running]{color:#ffdfaa;border-color:#c6a56f;background:#30281b}
#pipeline-control .pipeline-badge[data-state=waiting],#pipeline-control .pipeline-badge[data-state=manual]{color:#ffe4bb;border-color:#b79c74;background:#2c251b}
#pipeline-control .pipeline-badge[data-state=blocked],#pipeline-control .pipeline-badge[data-state=not-connected]{color:#ffd0c6;border-color:#c3988d;background:#2c201e}
#pipeline-control .pipeline-arrow{color:var(--pipeline-amber);text-shadow:0 0 7px rgba(255,173,73,.3),0 0 16px rgba(255,173,73,.16)}
#pipeline-control .pipeline-detail{border:1px solid rgba(255,255,255,.5);border-top-color:rgba(255,255,255,.72);border-radius:var(--pipeline-radius);background:var(--pipeline-reflection),radial-gradient(ellipse at 90% 125%,rgba(var(--pipeline-orb-cyan),.105),transparent 68%),var(--pipeline-glass-fill);box-shadow:var(--pipeline-depth),0 0 24px rgba(82,214,182,.035)}
#pipeline-control .pipeline-artwork-controls{border-top-color:var(--pipeline-line)}
#pipeline-control select{font-size:18px;background:#07090c;color:var(--pipeline-text);border-color:#9ca8b3;border-radius:var(--pipeline-small-radius);box-shadow:inset 0 2px 7px rgba(0,0,0,.85),0 1px 0 rgba(255,255,255,.1)}
#pipeline-control .pipeline-recheck-note{color:#eedbc0}
#pipeline-control .pipeline-action-result{color:var(--pipeline-teal)}
#pipeline-control .pipeline-systems{gap:22px}
#pipeline-control .pipeline-system{position:relative;isolation:isolate;overflow:hidden;border:1px solid var(--pipeline-line);border-top-color:var(--pipeline-rim);border-radius:var(--pipeline-radius);background:var(--pipeline-reflection),radial-gradient(ellipse at 88% 110%,rgba(var(--pipeline-orb-rgb),.16),transparent 66%),var(--pipeline-glass-fill);box-shadow:var(--pipeline-depth)}
#pipeline-control .pipeline-system::after{content:'';position:absolute;inset:3px;border:1px solid rgba(255,255,255,.055);border-top-color:rgba(255,255,255,.12);border-radius:21px;z-index:-1;pointer-events:none}
#pipeline-control .pipeline-system h4{font-size:22px;color:var(--pipeline-text)}
#pipeline-control .pipeline-system-facts{font-size:18px;gap:10px 16px}
#pipeline-control .pipeline-system-facts dt,#pipeline-control .pipeline-system-facts dd{color:var(--pipeline-text)}
#pipeline-control .pipeline-system-version{font-size:15px}
#pipeline-control .pipeline-issues{border-color:#a28c68;border-radius:var(--pipeline-radius);background:var(--pipeline-reflection),#1b1711;box-shadow:var(--pipeline-depth)}
#pipeline-control .pipeline-error{border-color:#d5a597;border-radius:var(--pipeline-small-radius);background:var(--pipeline-reflection),#2b1915;color:#ffe4db;box-shadow:var(--pipeline-depth)}
@supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){#pipeline-control{--pipeline-glass-fill:rgba(13,15,19,.76)}#pipeline-control button.pipeline-stage,#pipeline-control .pipeline-summary>div,#pipeline-control .pipeline-detail,#pipeline-control .pipeline-system{-webkit-backdrop-filter:blur(20px) saturate(115%);backdrop-filter:blur(20px) saturate(115%)}}
#pipeline-control .pipeline-detail{scroll-margin-top:24px}
@media(prefers-reduced-transparency:reduce){#pipeline-control{--pipeline-glass-fill:#111316}#pipeline-control button.pipeline-stage,#pipeline-control .pipeline-summary>div,#pipeline-control .pipeline-detail,#pipeline-control .pipeline-system{backdrop-filter:none;-webkit-backdrop-filter:none}}
@media(prefers-reduced-motion:reduce){#pipeline-control *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
</style>`;

export const pipelineScript = String.raw`<script>
(() => {
  const root = document.querySelector('#pipeline-control');
  if (!root) return;
  const get = id => root.querySelector('#' + id);
  const text = (element, value) => { const next = String(value ?? ''); if (element.textContent !== next) element.textContent = next; };
  const create = (tag, className, value) => { const element = document.createElement(tag); if (className) element.className = className; if (value !== undefined) text(element, value); return element; };
  const states = { ready: 'Ready', waiting: 'Waiting', running: 'Running', blocked: 'Blocked', manual: 'Manual step', 'not-connected': 'Not connected' };
  const recheckStages = new Set(['originals', 'resolution', 'pricing']);
  const refreshButton = get('pipeline-refresh'), pauseButton = get('pipeline-pause'), restartButton = get('pipeline-restart');
  const stageButton = get('pipeline-check'), recheckButton = get('pipeline-recheck'), artworkSelect = get('pipeline-artwork');
  const stageButtons = new Map([...root.querySelectorAll('[data-pipeline-stage]')].map(button => [button.dataset.pipelineStage, button]));
  const systemCards = new Map();
  let snapshot = null, selectedStage = 'brief', selectedArtwork = '', monitoring = true, failed = false, busy = false, timer;
  let artworkSignature = '', deferredArtworks = null, issueSignature = '';
  function visible() { return document.visibilityState !== 'hidden' && root.getClientRects().length > 0; }
  function currentStage() { return snapshot?.stages.find(stage => stage.id === selectedStage); }
  function statusBadge(element, status) { const known = Object.hasOwn(states, status); text(element, known ? states[status] : 'Not reported'); element.dataset.state = known ? status : 'unknown'; }
  function monitorLabel() {
    text(get('pipeline-monitor-state'), !monitoring ? 'Monitoring paused.' : failed ? 'Monitoring paused after an error. Refresh or restart to retry.' : !visible() ? 'Monitoring waits while this view is hidden.' : 'Monitoring on · status refreshes every 15 seconds.');
    pauseButton.disabled = !monitoring;
  }
  function controls() {
    refreshButton.disabled = busy;
    restartButton.disabled = busy;
    artworkSelect.disabled = busy;
    for (const button of stageButtons.values()) button.disabled = busy;
    stageButton.disabled = busy || !currentStage();
    const stage = currentStage();
    recheckButton.disabled = busy || !stage?.canCheckArtwork || !recheckStages.has(stage.id) || !snapshot?.artworks.some(artwork => artwork.id === selectedArtwork);
    monitorLabel();
  }
  async function request(url, options = {}) {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, { ...options, credentials: 'same-origin', signal: controller.signal, cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The status request could not be completed.');
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The check timed out after 30 seconds. Refresh status to retry.');
      throw error;
    } finally { clearTimeout(deadline); }
  }
  function showError(error) {
    failed = true;
    text(get('pipeline-error'), (error.message || 'Pipeline status is unavailable.') + ' The last successful information is kept below. Use Refresh status or Restart monitoring to retry.');
    get('pipeline-error').hidden = false;
    get('pipeline-loading').hidden = true;
  }
  function syncArtworks(artworks) {
    const signature = JSON.stringify(artworks.map(artwork => [artwork.id, artwork.title]));
    if (signature === artworkSignature) { deferredArtworks = null; return; }
    if (document.activeElement === artworkSelect) { deferredArtworks = artworks; return; }
    const options = [create('option', '', 'Select an artwork…')]; options[0].value = '';
    for (const artwork of artworks) { const option = create('option', '', artwork.title || 'Untitled artwork'); option.value = artwork.id; options.push(option); }
    artworkSelect.replaceChildren(...options);
    if (!artworks.some(artwork => artwork.id === selectedArtwork)) selectedArtwork = '';
    artworkSelect.value = selectedArtwork;
    artworkSignature = signature;
    deferredArtworks = null;
  }
  function artworkDetails() {
    const artwork = snapshot?.artworks.find(item => item.id === selectedArtwork);
    if (!artwork) { text(get('pipeline-artwork-info'), snapshot?.artworks.length === 0 ? 'No artworks are available to recheck yet.' : 'Select an artwork to see its saved file and review information.'); controls(); return; }
    const facts = [artwork.hasLocalOriginal ? 'Original saved locally' : 'Original not available locally', artwork.hasQuality && artwork.width && artwork.height ? artwork.width + ' × ' + artwork.height + ' px' : 'Dimensions not yet checked'];
    if (artwork.price !== null && artwork.price !== undefined && artwork.price !== '') facts.push('Saved price: USD ' + artwork.price);
    text(get('pipeline-artwork-info'), facts.join(' · '));
    controls();
  }
  function details() {
    const stage = currentStage();
    if (!stage) { stageButton.disabled = true; get('pipeline-artwork-controls').hidden = true; return; }
    text(get('pipeline-detail-title'), String(stage.number).padStart(2, '0') + ' · ' + stage.title);
    statusBadge(get('pipeline-detail-status'), stage.status);
    text(get('pipeline-detail-copy'), stage.detail || 'No further stage information was reported.');
    text(stageButton, stage.id === 'provider' ? 'Check BFL connection' : 'Check stage');
    text(get('pipeline-check-note'), stage.id === 'provider' ? 'Checks BFL account access and credits. No images are generated.' : 'Checks the saved stage information.');
    const link = get('pipeline-open');
    const safeHash = typeof stage.openHash === 'string' && /^#[A-Za-z][A-Za-z0-9_-]*$/.test(stage.openHash);
    link.hidden = !safeHash;
    if (safeHash) link.setAttribute('href', stage.openHash); else link.removeAttribute('href');
    get('pipeline-artwork-controls').hidden = !(stage.canCheckArtwork && recheckStages.has(stage.id));
    artworkDetails();
  }
  function renderSystems(systems) {
    const container = get('pipeline-systems');
    if (!systems.length) { if (systemCards.size || !container.querySelector('[data-empty]')) { systemCards.clear(); const empty = create('p', 'pipeline-muted', 'No systems have been reported. Refresh status to retry.'); empty.dataset.empty = 'true'; container.replaceChildren(empty); } return; }
    if (!systemCards.size) container.replaceChildren();
    const active = new Set();
    for (const system of systems) {
      if (!system || typeof system.id !== 'string') continue;
      active.add(system.id);
      let card = systemCards.get(system.id);
      if (!card) {
        const element = create('article', 'pipeline-system'), heading = create('h4'), role = create('p', 'pipeline-system-role'), status = create('span', 'pipeline-badge'), facts = create('dl', 'pipeline-system-facts');
        const installed = create('dd'), configured = create('dd'), verified = create('dd');
        facts.append(create('dt', '', 'Installed'), installed, create('dt', '', 'Configured'), configured, create('dt', '', 'Verified'), verified);
        const detail = create('p', 'pipeline-system-detail'), version = create('p', 'pipeline-system-version');
        element.append(heading, role, status, facts, detail, version); container.append(element);
        card = { element, heading, role, status, installed, configured, verified, detail, version }; systemCards.set(system.id, card);
      }
      text(card.heading, system.name || system.id); text(card.role, system.role || 'Role not reported');
      statusBadge(card.status, system.status);
      text(card.installed, system.installed === true ? 'Yes' : system.installed === false ? 'No' : 'Not reported');
      text(card.configured, system.configured === true ? 'Yes' : system.configured === false ? 'No' : 'Not reported');
      text(card.verified, system.verified === true ? 'Yes' : 'Not verified');
      text(card.detail, system.detail || 'No connection details reported.');
      text(card.version, system.version ? 'Version ' + system.version : 'Version not reported');
    }
    for (const [id, card] of systemCards) if (!active.has(id)) { card.element.remove(); systemCards.delete(id); }
  }
  function render(data) {
    if (!data || !Array.isArray(data.stages) || !Array.isArray(data.systems) || !Array.isArray(data.artworks) || !data.summary || !data.checkedAt || !Number.isFinite(Date.parse(data.checkedAt))) throw new Error('The server returned incomplete pipeline status.');
    if (!data.stages.length) throw new Error('No pipeline stages were reported.');
    snapshot = data;
    if (!data.stages.some(stage => stage.id === selectedStage)) selectedStage = data.stages[0].id;
    for (const key of ['total', 'pending', 'approved', 'rejected', 'queued', 'running', 'failed']) text(get('pipeline-total-' + key), Number.isFinite(data.summary[key]) ? data.summary[key] : '—');
    for (const [id, button] of stageButtons) {
      const stage = data.stages.find(item => item.id === id);
      button.setAttribute('aria-pressed', String(id === selectedStage));
      if (!stage) { statusBadge(button.querySelector('[data-pipeline-status]'), 'unknown'); text(button.querySelector('[data-pipeline-count]'), 'No stage information'); continue; }
      text(button.querySelector('.pipeline-stage-title'), stage.title);
      statusBadge(button.querySelector('[data-pipeline-status]'), stage.status);
      text(button.querySelector('[data-pipeline-count]'), Number.isFinite(stage.count) ? stage.count + (stage.count === 1 ? ' item' : ' items') : 'No item count');
      button.setAttribute('aria-label', 'Stage ' + stage.number + ': ' + stage.title + '. ' + (states[stage.status] || 'Not reported'));
    }
    syncArtworks(data.artworks); details(); renderSystems(data.systems);
    const issues = Array.isArray(data.issues) ? data.issues : [], signature = JSON.stringify(issues);
    if (signature !== issueSignature) { get('pipeline-issues').replaceChildren(...issues.map(issue => create('li', '', typeof issue === 'string' ? issue : issue.message || issue.detail || issue.title || 'An issue needs attention.'))); issueSignature = signature; }
    get('pipeline-issues-section').hidden = !issues.length;
    text(get('pipeline-last-success'), 'Last successful status check: ' + new Date(data.checkedAt).toLocaleString());
    get('pipeline-loading').hidden = true; get('pipeline-error').hidden = true; failed = false;
  }
  async function refresh() {
    if (busy) return;
    busy = true; controls();
    if (!snapshot) { text(get('pipeline-loading'), 'Checking the current pipeline status…'); get('pipeline-loading').hidden = false; }
    try { render(await request('/api/pipeline/status')); }
    catch (error) { showError(error); }
    finally { busy = false; controls(); }
  }
  async function check(includeArtwork) {
    const stage = currentStage();
    if (busy || !stage) return;
    const payload = { stageId: stage.id };
    if (includeArtwork) {
      if (!stage.canCheckArtwork || !recheckStages.has(stage.id) || !snapshot.artworks.some(artwork => artwork.id === selectedArtwork)) return;
      payload.artworkId = selectedArtwork;
    }
    busy = true; controls();
    text(get('pipeline-action-result'), includeArtwork ? 'Rechecking the selected artwork…' : stage.id === 'provider' ? 'Checking BFL account access and credits…' : 'Checking saved stage information…');
    try {
      const result = await request('/api/pipeline/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      render(result.snapshot);
      text(get('pipeline-action-result'), result.message || (includeArtwork ? 'Artwork recheck completed.' : 'Stage check completed.'));
    } catch (error) { text(get('pipeline-action-result'), 'The check could not finish. You can retry it.'); showError(error); }
    finally { busy = false; controls(); }
  }
  for (const [id, button] of stageButtons) button.addEventListener('click', () => {
    if (busy) return;
    selectedStage = id;
    for (const [otherId, other] of stageButtons) other.setAttribute('aria-pressed', String(otherId === id));
    text(get('pipeline-action-result'), ''); details();
    get('pipeline-stage-detail').scrollIntoView?.({ block: 'start', behavior: 'instant' });
  });
  artworkSelect.addEventListener('change', () => { selectedArtwork = artworkSelect.value; artworkDetails(); text(get('pipeline-action-result'), ''); });
  artworkSelect.addEventListener('blur', () => { if (deferredArtworks) { syncArtworks(deferredArtworks); artworkDetails(); } });
  refreshButton.addEventListener('click', refresh);
  stageButton.addEventListener('click', () => check(false));
  recheckButton.addEventListener('click', () => check(true));
  pauseButton.addEventListener('click', () => { monitoring = false; controls(); });
  restartButton.addEventListener('click', () => { monitoring = true; failed = false; controls(); if (visible()) void refresh(); });
  function schedule() { clearTimeout(timer); timer = setTimeout(() => { if (monitoring && !failed && visible()) void refresh(); monitorLabel(); schedule(); }, 15000); }
  function onVisibility() { monitorLabel(); if (monitoring && !failed && visible()) void refresh(); }
  document.addEventListener('visibilitychange', onVisibility);
  const observer = new MutationObserver(onVisibility); observer.observe(root, { attributes: true, attributeFilter: ['class', 'hidden'] });
  window.addEventListener('pagehide', () => { clearTimeout(timer); observer.disconnect(); });
  window.addEventListener('pageshow', () => { observer.observe(root, { attributes: true, attributeFilter: ['class', 'hidden'] }); schedule(); onVisibility(); });
  controls(); schedule(); if (visible()) void refresh();
})();
</script>`;
