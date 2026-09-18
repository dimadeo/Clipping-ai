/**
 * Theme layer: black ground, pink and deep-blue glass.
 *
 * Injected last in the root route so it wins the cascade over dashboard.js and canvas-studio.js
 * without editing their minified rules. Keeping it as one isolated file means the whole look can be
 * reverted by removing a single import.
 */
export const themeStyles = String.raw`<style id="dm-theme">
:root{
  --dm-pink:#ff4d9d; --dm-pink-soft:#ff86bd; --dm-pink-deep:#b82e6d;
  --dm-blue:#1b2a6b; --dm-blue-deep:#0d1436; --dm-blue-lift:#2d43a8;
  --bg:#000; --panel:rgba(18,22,48,.55); --line:rgba(255,255,255,.14);
  --ink:#f6f3f9; --muted:#a9a3c0; --cyan:var(--dm-pink); --gold:var(--dm-pink);
  --bad:#ff6b7d; --green:#7fd8c4;
  --studio-black:#000; --studio-glass:rgba(18,22,48,.55); --studio-rim:rgba(255,255,255,.22);
  --studio-accent:var(--dm-pink); --studio-text:#f6f3f9; --studio-muted:#a9a3c0;
  --studio-focus:var(--dm-pink-soft);
  --studio-depth:0 24px 48px #000c,0 5px 12px #0009,inset 0 1px 0 #ffffff2e,inset 0 -1px 0 #0009;
  --node-glow:255,77,157;
}
/* Black ground with a pink glow top-left and a deep-blue one low-right. */
body{
  background:
    radial-gradient(circle at 12% -6%, rgba(255,77,157,.20) 0, transparent 42rem),
    radial-gradient(circle at 88% 108%, rgba(45,67,168,.26) 0, transparent 46rem),
    #000 !important;
  background-attachment:fixed;
  color:var(--ink);
}
/* Glass surfaces: deep-blue tinted, blurred, with a light rim. */
.card,.node-body,.recipe-item,.approval-card,.studio-shell,.studio-directions,
.canvas-node,.studio-bar,.workspace-panels{
  background:linear-gradient(145deg, rgba(255,255,255,.07), rgba(14,18,42,.72) 72%) !important;
  backdrop-filter:blur(20px) saturate(135%);
  -webkit-backdrop-filter:blur(20px) saturate(135%);
  border-color:rgba(255,255,255,.15) !important;
}
.canvas-node{
  background:
    radial-gradient(ellipse at 5% 0%, rgba(255,77,157,.22), transparent 62%),
    linear-gradient(140deg, rgba(255,255,255,.09), rgba(13,20,54,.85) 75%) !important;
}
.studio-bar{
  background:linear-gradient(135deg, rgba(255,255,255,.10), rgba(10,14,36,.88)) !important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.18), 0 8px 32px #000a;
}
.studio-shell{box-shadow:0 24px 80px #000, 0 0 0 1px rgba(255,255,255,.06);}
.workspace-panels,.canvas-preview-image{background:#000 !important;}
.canvas-viewport{
  background-color:#000 !important;
  background-image:radial-gradient(rgba(255,77,157,.16) .7px, transparent .7px) !important;
}
/* Primary actions in pink; secondary as blue glass. Stage cards are buttons too, so they are
   excluded here and styled as glass below — a wall of solid pink is unreadable. */
button:not(.pipeline-stage):not(.secondary),.button,.studio-logo{
  background:linear-gradient(135deg, var(--dm-pink), var(--dm-pink-deep)) !important;
  color:#fff !important; border:0;
}
.pipeline-stage{
  background:linear-gradient(145deg, rgba(255,255,255,.07), rgba(14,18,42,.75) 72%) !important;
  backdrop-filter:blur(16px) saturate(130%);
  -webkit-backdrop-filter:blur(16px) saturate(130%);
  border:1px solid rgba(255,255,255,.15) !important;
  color:var(--ink) !important;
}
.pipeline-stage[aria-pressed=true]{
  border-color:var(--dm-pink) !important;
  box-shadow:0 0 0 1px var(--dm-pink), 0 8px 30px rgba(255,77,157,.22);
}
.pipeline-hex{color:var(--dm-pink) !important;}
.pipeline-stage-title{color:var(--ink) !important;}
.pipeline-stage-count{color:var(--muted) !important;}
button.secondary,.secondary{
  background:linear-gradient(145deg, rgba(255,255,255,.08), rgba(20,28,72,.75)) !important;
  color:var(--dm-pink-soft) !important;
  border:1px solid rgba(255,77,157,.45) !important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.14);
}
input,textarea,select{
  background:rgba(8,11,28,.72) !important;
  border:1px solid rgba(255,255,255,.16) !important;
  color:var(--ink) !important;
}
input:focus,textarea:focus,select:focus,button:focus-visible,a:focus-visible{
  outline:2px solid var(--dm-pink-soft); outline-offset:2px;
}
/* Picture studio and pipeline panels ship their own green palette; bring them onto the glass. */
.picture-studio,.picture-upload,.picture-card,.picture-plan-item,.picture-approval,
.pipeline-detail,.pipeline-issues,.pipeline-system,.pipeline-secondary{
  background:linear-gradient(145deg, rgba(255,255,255,.06), rgba(14,18,42,.72) 72%) !important;
  backdrop-filter:blur(16px) saturate(130%);
  -webkit-backdrop-filter:blur(16px) saturate(130%);
  border-color:rgba(255,255,255,.15) !important;
  color:var(--ink) !important;
}
.picture-upload{border-style:dashed !important;border-color:rgba(255,77,157,.40) !important;}
.picture-approval{border-color:rgba(255,77,157,.35) !important;}
.pipeline-error{background:rgba(255,107,125,.14) !important;border-color:rgba(255,107,125,.45) !important;color:#ffd9de !important;}
.pipeline-badge{background:rgba(255,77,157,.18) !important;border-color:rgba(255,77,157,.45) !important;color:var(--dm-pink-soft) !important;}
input[type=file]::file-selector-button{
  background:linear-gradient(135deg, var(--dm-pink), var(--dm-pink-deep)) !important;
  color:#fff !important; border:0 !important;
}
.eyebrow,.num,.metric b,.state{color:var(--dm-pink) !important;}
nav span{color:var(--muted) !important;}
a{color:var(--dm-pink-soft);}
@media (prefers-reduced-motion:no-preference){
  .card,.canvas-node{transition:border-color .25s ease, box-shadow .25s ease;}
  .card:hover,.canvas-node:hover{
    border-color:rgba(255,77,157,.42) !important;
    box-shadow:0 10px 40px rgba(255,77,157,.10);
  }
}
</style>`;
