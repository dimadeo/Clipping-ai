import crypto from 'node:crypto';
import { highestFluxSize } from './creation-formats.js';
import { ANTI_DIGITAL } from './style-lexicon.js';

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const clean = (value, maximum = 400) => String(value || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, maximum);
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const INJECTION = /--|::|\bar\s*\d+\s*:\s*\d+\b/i;
const ROLES = Object.freeze(['centrepiece', 'supporting']);

/**
 * Validate a brief. The model writes these fields and nothing else; any parameter syntax
 * inside them is an injection and is refused rather than passed through.
 */
export function validateBrief(input = {}) {
  const brief = {
    pieceIndex: Number(input.pieceIndex),
    role: String(input.role || ''),
    title: clean(input.title, 90),
    subject: clean(input.subject, 260),
    focalMoment: clean(input.focalMoment, 200),
    light: clean(input.light, 160),
    composition: clean(input.composition, 200),
  };
  if (!Number.isInteger(brief.pieceIndex) || brief.pieceIndex < 1 || brief.pieceIndex > 5) fail('pieceIndex must be 1 to 5');
  if (!ROLES.includes(brief.role)) fail(`role must be one of ${ROLES.join(', ')}`);
  for (const [field, value] of Object.entries(brief)) {
    if (typeof value !== 'string') continue;
    if (['title', 'subject', 'focalMoment', 'light'].includes(field) && !value) fail(`Brief field "${field}" is required`);
    if (INJECTION.test(value)) fail(`Brief field "${field}" contains parameter syntax. Briefs describe the artwork; the compiler owns every parameter.`);
  }
  return brief;
}

/**
 * Pure. (brief, locked identity) -> structured prompt. No network, no randomness: the seed is
 * derived from the brief and the identity, so the same inputs compile to the same bytes.
 */
export function compileArtworkPrompt({ brief: rawBrief, identity } = {}) {
  if (!identity || identity.status !== 'locked') fail('Compile only against a locked collection identity', 409);
  const brief = validateBrief(rawBrief);
  const clauses = [
    brief.subject,
    brief.focalMoment,
    brief.composition,
    ...identity.surface,
    brief.light,
    `palette: ${identity.palette}`,
    ...ANTI_DIGITAL,
  ].filter(Boolean);
  const body = clauses.join('. ').replace(/\.\./g, '.') + '.';
  const briefHash = digest(JSON.stringify(brief));
  const seed = Number.parseInt(digest(`${identity.id}:${identity.lock.lockVersion}:${briefHash}`).slice(0, 8), 16);
  const parameters = {
    ar: identity.ratioFamily,
    v: identity.version,
    sref: identity.lock.sref,
    sw: identity.lock.sref ? 250 : null,
    stylize: identity.stylize,
    raw: identity.raw,
    no: identity.exclusions,
  };
  const compiled = { identityId: identity.id, lockVersion: identity.lock.lockVersion, pieceIndex: brief.pieceIndex, role: brief.role, title: brief.title, body, parameters, seed, briefHash };
  compiled.promptHash = digest(JSON.stringify({ body, parameters, seed }));
  return compiled;
}

/** Midjourney V8-family syntax. No --q (V7 only), bare --raw (not --style raw), version pinned. */
export function serializeMidjourney(compiled) {
  const p = compiled.parameters;
  const parts = [compiled.body, `--ar ${p.ar}`, `--v ${p.v}`];
  if (p.sref) parts.push(`--sref ${p.sref}`, `--sw ${p.sw}`);
  parts.push(`--stylize ${p.stylize}`);
  if (p.raw) parts.push('--raw');
  parts.push(`--seed ${compiled.seed}`);
  if (p.no.length) parts.push(`--no ${p.no.join(', ')}`);
  return parts.join(' ');
}

/** FLUX speaks no Midjourney syntax. Emit a clean body, explicit pixel size, and the seed. */
export function serializeFlux(compiled, { plateReference = null } = {}) {
  const size = highestFluxSize(compiled.parameters.ar);
  const exclusion = compiled.parameters.no.length ? ` No ${compiled.parameters.no.join(', no ')}.` : '';
  const anchor = plateReference ? ' Match the painted style, palette and surface of the reference image exactly; compose a new scene.' : '';
  return { prompt: `${compiled.body}${exclusion}${anchor}`, width: size.width, height: size.height, seed: compiled.seed, plateReference };
}
