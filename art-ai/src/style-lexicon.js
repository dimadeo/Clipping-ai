// Vocabulary rules for compiled prompts. Pure data and pure functions; shared by every executor.

// Midjourney's --no removes depicted things. It cannot act on quality adjectives, and putting
// them in the list adds weighting noise. Only entries on this allowlist may reach a --no clause.
export const DEPICTABLE_EXCLUSIONS = Object.freeze([
  'watermark', 'signature', 'text', 'caption', 'typography', 'logo', 'frame', 'border', 'mockup',
  'room', 'furniture', 'wall', 'people', 'person', 'face', 'hands', 'animals', 'vehicles',
  'buildings', 'photograph', 'camera', 'lens flare', 'glitter', 'sparkles', 'neon',
]);

// Quality words that were in the old library's --no lists and do nothing there.
export const UNDEPICTABLE = Object.freeze([
  'blurry', 'blur', 'low resolution', 'low quality', 'ugly', 'distorted', 'deformed', 'bad', 'poor',
  'amateur', 'noise', 'noisy', 'artifact', 'artifacts', 'pixelated', 'jpeg', 'grainy', 'oversaturated',
  'cgi glow', 'plastic surface', 'distorted details',
]);

const normalise = (value) => String(value || '').toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ').trim();

/** Keep only exclusions Midjourney can act on. Returns what was kept and what was dropped, with the reason. */
export function filterExclusions(list = []) {
  const kept = [], dropped = [];
  for (const raw of Array.isArray(list) ? list : String(list).split(',')) {
    const word = normalise(raw);
    if (!word) continue;
    if (DEPICTABLE_EXCLUSIONS.includes(word)) { if (!kept.includes(word)) kept.push(word); continue; }
    dropped.push({ word, reason: UNDEPICTABLE.includes(word) ? 'quality adjective, not a depictable object' : 'not on the depictable allowlist' });
  }
  return { kept, dropped };
}

// The physical-surface vocabulary for a painted collection. These are the frozen style clauses
// a collection identity may carry; the compiler emits them verbatim so every piece shares them.
export const SURFACE_CLAUSES = Object.freeze({
  impasto: 'thick impasto oil paint with visible palette-knife ridges and raking-light shadows across the paint body',
  knife: 'broad palette-knife strokes dragging pigment into sharp-edged geometric planes',
  weave: 'coarse linen canvas weave visible through thin passages of paint',
  glaze: 'transparent glazes layered over opaque strokes, edges bleeding where wet paint met wet paint',
  poured: 'poured and tilted fluid paint forming marbled cells and lacing, sealed under a matte varnish',
  scrape: 'scraped-back layers revealing underpainting in thin ragged lines',
});

// Words that signal a smooth digital surface, which this collection must not read as.
export const ANTI_DIGITAL = Object.freeze(['painted on canvas, not rendered', 'no airbrush smoothness, no digital gradient']);

/** Validate a list of clause keys against SURFACE_CLAUSES. Throws 400 on an unknown key. */
export function resolveSurfaceClauses(keys = []) {
  const out = [];
  for (const key of keys) {
    if (!Object.hasOwn(SURFACE_CLAUSES, key)) throw Object.assign(new Error(`Unknown surface clause "${key}". Choose from: ${Object.keys(SURFACE_CLAUSES).join(', ')}`), { statusCode: 400 });
    out.push(SURFACE_CLAUSES[key]);
  }
  return out;
}
