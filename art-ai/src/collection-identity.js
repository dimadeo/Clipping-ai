import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PRINT_SIZES } from './print-sizes.js';
import { filterExclusions, resolveSurfaceClauses } from './style-lexicon.js';

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const clean = (value, maximum = 400) => String(value || '').replace(/[<>]/g, '').trim().slice(0, maximum);

export const MIDJOURNEY_VERSIONS = Object.freeze(['8.2', '8.1', '7']);
export const RATIO_FAMILIES = Object.freeze(Object.fromEntries(
  [...new Set(PRINT_SIZES.map((size) => size.ratio))].map((ratio) => [ratio, PRINT_SIZES.filter((size) => size.ratio === ratio).map((size) => size.key)])
));
const SREF_CODE = /^[0-9]{1,12}$/;
const SHA256 = /^[a-f0-9]{64}$/;

/**
 * One visual identity per collection, chosen once and inherited by every piece.
 * A locked identity is immutable; relock() records history rather than overwriting it.
 */
export class CollectionIdentity {
  constructor({ file = path.resolve('data/collections.json') } = {}) {
    this.file = file;
    this.records = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(this.records, null, 2));
    fs.renameSync(temporary, this.file);
  }

  list() { return Object.values(this.records).map((record) => structuredClone(record)); }
  get(id) { return this.records[id] ? structuredClone(this.records[id]) : fail('Collection not found', 404); }

  create(input = {}) {
    const name = clean(input.name, 120);
    if (!name) fail('A collection needs a name');
    const thesis = clean(input.thesis, 1200);
    if (thesis.length < 80) fail('The collection thesis must be at least 80 characters: what this collection is and what it is not');
    if (!Object.hasOwn(RATIO_FAMILIES, input.ratioFamily)) fail(`ratioFamily must be one of ${Object.keys(RATIO_FAMILIES).join(', ')}`);
    const version = String(input.version ?? '8.2');
    if (!MIDJOURNEY_VERSIONS.includes(version)) fail(`version must be one of ${MIDJOURNEY_VERSIONS.join(', ')}`);
    const pieces = Number(input.pieces ?? 4);
    if (!Number.isInteger(pieces) || pieces < 3 || pieces > 5) fail('A connected collection has 3 to 5 pieces');
    const surface = resolveSurfaceClauses(Array.isArray(input.surface) ? input.surface : []);
    if (!surface.length) fail('Choose at least one surface clause so every piece shares the same physical texture');
    const exclusions = filterExclusions(input.exclusions ?? ['watermark', 'signature', 'text', 'frame', 'mockup']);
    const palette = clean(input.palette, 300);
    if (!palette) fail('Name the shared palette');
    const stylize = Number(input.stylize ?? 250);
    if (!Number.isInteger(stylize) || stylize < 0 || stylize > 1000) fail('stylize must be an integer from 0 to 1000');
    const id = crypto.randomUUID();
    const record = {
      id, name, thesis, ratioFamily: input.ratioFamily, printSizeKeys: RATIO_FAMILIES[input.ratioFamily], version, pieces,
      surface, surfaceKeys: input.surface, exclusions: exclusions.kept, droppedExclusions: exclusions.dropped, palette, stylize,
      raw: input.raw !== false, status: 'draft', lock: null, lockHistory: [], createdAt: new Date().toISOString(),
    };
    this.records[id] = record;
    this.save();
    return structuredClone(record);
  }

  /** Lock the identity to one --sref code (Midjourney) and/or one style-anchor plate hash (FLUX). */
  lock(id, { sref, plateHash } = {}) {
    const record = this.records[id] || fail('Collection not found', 404);
    if (record.status === 'locked') fail('This collection is already locked. Use relock() to change it deliberately.', 409);
    return this.#applyLock(record, { sref, plateHash });
  }

  relock(id, { sref, plateHash, reason } = {}) {
    const record = this.records[id] || fail('Collection not found', 404);
    if (record.status !== 'locked') fail('Only a locked collection can be relocked', 409);
    const why = clean(reason, 300);
    if (!why) fail('State why the lock is changing');
    record.lockHistory.push({ ...record.lock, replacedAt: new Date().toISOString(), reason: why });
    return this.#applyLock(record, { sref, plateHash });
  }

  #applyLock(record, { sref, plateHash }) {
    if (sref !== undefined && sref !== null && !SREF_CODE.test(String(sref))) fail('sref must be a Midjourney style code of 1 to 12 digits');
    if (plateHash !== undefined && plateHash !== null && !SHA256.test(String(plateHash))) fail('plateHash must be a sha256 hex digest of the archived plate');
    if (!sref && !plateHash) fail('A lock needs a Midjourney sref code, a FLUX plate hash, or both');
    record.lock = { sref: sref ? String(sref) : null, plateHash: plateHash || null, lockedAt: new Date().toISOString(), lockVersion: record.lockHistory.length + 1 };
    record.status = 'locked';
    this.save();
    return structuredClone(record);
  }
}

/** Resolve one ratio family from a set of print-size keys. Mixed families throw 400 naming both. */
export function resolveProductRatio(printSizeKeys = []) {
  const families = [...new Set(printSizeKeys.map((key) => PRINT_SIZES.find((size) => size.key === key)?.ratio).filter(Boolean))];
  if (!families.length) fail('Choose at least one print size so the artwork ratio is known');
  if (families.length > 1) fail(`The chosen print sizes span ${families.length} ratio families (${families.join(', ')}). One artwork is one ratio; choose sizes from one family.`);
  return families[0];
}
