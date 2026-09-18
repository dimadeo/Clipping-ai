import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PRINT_SIZES } from '../src/print-sizes.js';
import { highestFluxSize } from '../src/creation-formats.js';
import { DEPICTABLE_EXCLUSIONS, filterExclusions, resolveSurfaceClauses } from '../src/style-lexicon.js';
import { CollectionIdentity, RATIO_FAMILIES, resolveProductRatio } from '../src/collection-identity.js';
import { compileArtworkPrompt, serializeMidjourney, serializeFlux, validateBrief } from '../src/prompt-compiler.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-collections-'));
const store = () => new CollectionIdentity({ file: path.join(tmp, `${Math.random().toString(36).slice(2)}.json`) });
const thesis = 'Four USA landscapes in saturated sunset colour with a physical painted surface: knife ridges, canvas weave, glazes. Not photographic, not smooth, not restrained.';
const baseCollection = { name: 'American Light', thesis, ratioFamily: '3:4', pieces: 4, surface: ['impasto', 'knife', 'weave'], palette: 'hot pink, burnt orange, teal, magenta, ivory', stylize: 250 };
const brief = (pieceIndex = 1, role = 'centrepiece') => ({
  pieceIndex, role, title: 'Sierra Pool at Dusk',
  subject: 'A desert-modernist pool terrace opening onto layered mountain ridges at dusk',
  focalMoment: 'the last orange light striking one concrete pillar while the water holds the pink sky',
  light: 'low raking sunset light from the left',
  composition: 'stacked horizontal planes with a single vertical counterweight',
});
const locked = (s = store()) => { const c = s.create(baseCollection); return s.lock(c.id, { sref: '4093812267' }); };

test('ratio families are derived from PRINT_SIZES and resolveProductRatio refuses mixed families', () => {
  for (const size of PRINT_SIZES) assert.ok(RATIO_FAMILIES[size.ratio].includes(size.key), size.key);
  assert.equal(resolveProductRatio(['30×40 cm']), '3:4');
  assert.equal(resolveProductRatio(['60×90 cm', '80×120 cm', '100×150 cm']), '2:3');
  assert.throws(() => resolveProductRatio(['30×40 cm', '40×50 cm']), (e) => e.statusCode === 400 && /3:4/.test(e.message) && /4:5/.test(e.message));
  assert.throws(() => resolveProductRatio([]), (e) => e.statusCode === 400);
});

test('filterExclusions keeps depictable objects and drops quality adjectives with a reason', () => {
  const { kept, dropped } = filterExclusions(['watermark', 'signature', 'text', 'blurry', 'low resolution', 'frame', 'CGI glow', 'unicorns']);
  assert.deepEqual(kept, ['watermark', 'signature', 'text', 'frame']);
  assert.deepEqual(dropped.map((d) => d.word), ['blurry', 'low resolution', 'cgi glow', 'unicorns']);
  assert.match(dropped[0].reason, /quality adjective/);
  assert.match(dropped[3].reason, /allowlist/);
  for (const word of kept) assert.ok(DEPICTABLE_EXCLUSIONS.includes(word));
  assert.throws(() => resolveSurfaceClauses(['impasto', 'airbrush']), (e) => e.statusCode === 400 && /airbrush/.test(e.message));
});

test('collection create validates every field the compiler will depend on', () => {
  const s = store();
  assert.throws(() => s.create({ ...baseCollection, thesis: 'too short' }), /80 characters/);
  assert.throws(() => s.create({ ...baseCollection, ratioFamily: '9:16' }), /ratioFamily/);
  assert.throws(() => s.create({ ...baseCollection, version: '6' }), /version/);
  assert.throws(() => s.create({ ...baseCollection, pieces: 2 }), /3 to 5/);
  assert.throws(() => s.create({ ...baseCollection, pieces: 6 }), /3 to 5/);
  assert.throws(() => s.create({ ...baseCollection, surface: [] }), /surface clause/);
  assert.throws(() => s.create({ ...baseCollection, palette: '' }), /palette/);
  const c = s.create({ ...baseCollection, exclusions: ['watermark', 'blurry'] });
  assert.equal(c.status, 'draft');
  assert.equal(c.version, '8.2');
  assert.deepEqual(c.exclusions, ['watermark']);
  assert.equal(c.droppedExclusions[0].word, 'blurry');
  assert.deepEqual(c.printSizeKeys, ['30×40 cm']);
  assert.equal(c.surface.length, 3);
  assert.ok(!fs.existsSync(s.file + '.tmp'), 'atomic write must leave no .tmp behind');
});

test('lock is required, validated, immutable, and relock records history', () => {
  const s = store();
  const c = s.create(baseCollection);
  assert.throws(() => s.lock(c.id, {}), /sref code, a FLUX plate hash/);
  assert.throws(() => s.lock(c.id, { sref: 'abc' }), /1 to 12 digits/);
  assert.throws(() => s.lock(c.id, { plateHash: 'nothex' }), /sha256/);
  const l = s.lock(c.id, { sref: '4093812267', plateHash: 'a'.repeat(64) });
  assert.equal(l.status, 'locked');
  assert.equal(l.lock.lockVersion, 1);
  assert.throws(() => s.lock(c.id, { sref: '1' }), (e) => e.statusCode === 409);
  assert.throws(() => s.relock(c.id, { sref: '1' }), /why/);
  const r = s.relock(c.id, { sref: '777', reason: 'V8.3 changed the code' });
  assert.equal(r.lock.sref, '777');
  assert.equal(r.lock.lockVersion, 2);
  assert.equal(r.lockHistory.length, 1);
  assert.equal(r.lockHistory[0].sref, '4093812267');
  const reloaded = new CollectionIdentity({ file: s.file }).get(c.id);
  assert.equal(reloaded.lock.sref, '777', 'lock must survive a reload from disk');
});

test('briefs cannot smuggle parameters and must name the essentials', () => {
  assert.throws(() => validateBrief({ ...brief(), subject: 'a pool --ar 16:9' }), /parameter syntax/);
  assert.throws(() => validateBrief({ ...brief(), light: 'dusk::2' }), /parameter syntax/);
  assert.throws(() => validateBrief({ ...brief(), focalMoment: 'ar 4:5 pool' }), /parameter syntax/);
  assert.throws(() => validateBrief({ ...brief(), subject: '' }), /required/);
  assert.throws(() => validateBrief({ ...brief(), role: 'hero' }), /role/);
  assert.throws(() => validateBrief({ ...brief(6) }), /pieceIndex/);
  assert.equal(validateBrief(brief()).title, 'Sierra Pool at Dusk');
});

test('compile is pure, deterministic per piece, and refuses an unlocked identity', () => {
  const s = store();
  const draft = s.create(baseCollection);
  assert.throws(() => compileArtworkPrompt({ brief: brief(), identity: draft }), (e) => e.statusCode === 409);
  const identity = s.lock(draft.id, { sref: '4093812267' });
  const a = compileArtworkPrompt({ brief: brief(1), identity });
  const b = compileArtworkPrompt({ brief: brief(1), identity });
  const c = compileArtworkPrompt({ brief: brief(2, 'supporting'), identity });
  assert.equal(a.promptHash, b.promptHash, 'same inputs must compile to the same bytes');
  assert.equal(a.seed, b.seed);
  assert.notEqual(a.seed, c.seed, 'each piece gets its own seed');
  assert.equal(a.identityId, identity.id);
  assert.equal(a.lockVersion, 1);
  assert.ok(a.body.startsWith('A desert-modernist pool terrace'), 'subject leads the prompt');
  for (const clause of identity.surface) assert.ok(a.body.includes(clause), 'every frozen surface clause is present');
  assert.ok(a.body.includes('palette: hot pink'));
  assert.ok(a.body.includes('painted on canvas, not rendered'));
  assert.ok(!/--/.test(a.body), 'body carries no parameters');
});

test('serializeMidjourney emits V8 syntax: --v 8.2, --sref with --sw, bare --raw, no --q, depictable --no only', () => {
  const identity = locked();
  const out = serializeMidjourney(compileArtworkPrompt({ brief: brief(), identity }));
  assert.match(out, /--ar 3:4/);
  assert.match(out, /--v 8\.2/);
  assert.match(out, /--sref 4093812267 --sw 250/);
  assert.match(out, /--stylize 250/);
  assert.match(out, /\s--raw(\s|$)/);
  assert.doesNotMatch(out, /--style raw/);
  assert.doesNotMatch(out, /--q\b/);
  assert.match(out, /--seed \d+/);
  assert.match(out, /--no watermark, signature, text, frame, mockup$/);
  assert.doesNotMatch(out, /blurry|low resolution/);
  assert.ok(out.indexOf('--ar') > out.indexOf('painted on canvas'), 'parameters come after the body');
});

test('serializeFlux carries no Midjourney syntax and sizes to the ratio family', () => {
  const identity = locked();
  const compiled = compileArtworkPrompt({ brief: brief(), identity });
  const plain = serializeFlux(compiled);
  assert.doesNotMatch(plain.prompt, /--/);
  assert.deepEqual({ width: plain.width, height: plain.height }, highestFluxSize('3:4'));
  assert.equal(plain.seed, compiled.seed);
  assert.match(plain.prompt, /No watermark, no signature/);
  assert.equal(plain.plateReference, null);
  const anchored = serializeFlux(compiled, { plateReference: 'plate-1' });
  assert.match(anchored.prompt, /Match the painted style/);
  assert.equal(anchored.plateReference, 'plate-1');
});

test('a flux-only lock (plate hash, no sref) compiles and serializes without --sref', () => {
  const s = store();
  const c = s.create(baseCollection);
  const identity = s.lock(c.id, { plateHash: 'b'.repeat(64) });
  const compiled = compileArtworkPrompt({ brief: brief(), identity });
  assert.equal(compiled.parameters.sref, null);
  assert.doesNotMatch(serializeMidjourney(compiled), /--sref/);
  assert.equal(serializeFlux(compiled).width, highestFluxSize('3:4').width);
});
