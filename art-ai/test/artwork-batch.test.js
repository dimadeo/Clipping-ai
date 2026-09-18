import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArtworkBatch } from '../src/artwork-batch.js';

const examples = [
  ['BLUE HOUR', 'Create an original seascape. Landscape ratio 7:5; intended size 70 × 50 cm.', '7:5'],
  ['AFTER EVERYONE LEFT', 'An intimate still life. Landscape ratio 5:4; intended size 50 × 40 cm.', '5:4'],
  ['TWELVE QUIET PLACES', 'Generate one miniature landscape. Ratio 4:3; intended size 20 × 15 cm.', '4:3'],
  ['THE ROOM REMEMBERS', 'A surreal room with shallow water. Portrait ratio 3:4; intended size 60 × 80 cm.', '3:4'],
  ['INHERITED THREADS', 'Textile artwork with hand stitching. Portrait ratio 5:7; intended size 50 × 70 cm.', '5:7'],
  ['CITY BENEATH THE CITY', 'A layered city collage. Portrait ratio 4:5; intended size 40 × 50 cm.', '4:5'],
  ['WEATHER WITHIN', 'A large abstract painting. Landscape ratio 6:5; intended size 120 × 100 cm.', '6:5'],
  ['GARDEN AFTER RAIN', 'Wet leaves and dark earth. Portrait ratio 2:3; intended size 40 × 60 cm.', '2:3'],
  ['SMALL GUARDIANS', 'One ceramic sculpture approximately 20 cm tall. Neutral background. Square image.', '1:1'],
  ['SUNDAY, REMEMBERED', 'A narrative family painting. Portrait ratio 3:4; intended size 60 × 80 cm.', '3:4']
];

test('ten distinct artwork briefs retain order, separate bodies and their own ratios', () => {
  const preamble = 'Create 10 separate images.\n\nWORKFLOW\n1. Accept all 10 prompts as one batch.\n2. Generate one image per prompt.\n3. Keep artworks separate.\n\n';
  const source = preamble + examples.map(([title, prompt], i) => `${String(i + 1).padStart(2, '0')} — ${title}\\\n${prompt}`).join('\n\n');
  const batch = parseArtworkBatch(source);
  assert.equal(batch.originalText, source);
  assert.equal(batch.artworks.length, 10);
  assert.deepEqual(batch.artworks.map(art => art.number), [1,2,3,4,5,6,7,8,9,10]);
  assert.deepEqual(batch.artworks.map(art => art.aspectRatio), examples.map(item => item[2]));
  for (const [index, art] of batch.artworks.entries()) {
    assert.equal(art.title, examples[index][0]);
    assert.equal(art.prompt, examples[index][1]);
    assert.equal(art.issue, null);
    assert.ok(!art.prompt.includes('WORKFLOW'));
  }
});

test('Markdown, plain dash, en dash and CRLF headings preserve complete multiline prompts', () => {
  const longBody = 'Layered pigment with hand-worked texture. '.repeat(30) + '\nKeep every detail intact. Ratio 7:5.';
  const source = `**01 — BLUE HOUR**\\\r\n${longBody}\r\n\r\n02 – STILL LIFE\r\nRatio 5:4.\r\n\r\n03 - SCULPTURE\r\nSquare image.`;
  const batch = parseArtworkBatch(source);
  assert.deepEqual(batch.artworks.map(art => art.title), ['BLUE HOUR', 'STILL LIFE', 'SCULPTURE']);
  assert.equal(batch.artworks[0].prompt, longBody);
  assert.deepEqual(batch.artworks.map(art => art.aspectRatio), ['7:5', '5:4', '1:1']);
});

test('a conflicting item is flagged without changing or failing the other artworks', () => {
  const batch = parseArtworkBatch('01 — CONFLICT\nPortrait ratio 4:5; intended size 70 × 50 cm.\n\n02 — CLEAR\nLandscape ratio 7:5.\n\n03 — FREE\nA quiet abstract painting.');
  assert.equal(batch.artworks[0].aspectRatio, null);
  assert.match(batch.artworks[0].issue, /Conflicting/);
  assert.equal(batch.artworks[1].aspectRatio, '7:5');
  assert.equal(batch.artworks[1].issue, null);
  assert.equal(batch.artworks[2].aspectRatio, null);
  assert.equal(batch.artworks[2].issue, null);
});

test('a single numbered artwork or workflow-only input is not a batch', () => {
  assert.equal(parseArtworkBatch('01 — BLUE HOUR\nCreate a seascape. Ratio 7:5.'), null);
  assert.equal(parseArtworkBatch('WORKFLOW\n1. Accept prompts.\n2. Generate each image.\n3. Save the results.'), null);
  assert.equal(parseArtworkBatch('A square image.'), null);
  assert.equal(parseArtworkBatch(null), null);
});

test('duplicate, out-of-order and out-of-range numbers produce actionable errors', () => {
  assert.throws(() => parseArtworkBatch('01 — FIRST\nArt.\n01 — SECOND\nArt.'), /appears more than once/);
  assert.throws(() => parseArtworkBatch('02 — SECOND\nArt.\n01 — FIRST\nArt.'), /out of order/);
  assert.throws(() => parseArtworkBatch('00 — ZERO\nArt.\n01 — FIRST\nArt.'), /between 1 and 50/);
  assert.throws(() => parseArtworkBatch('01 — FIRST\nArt.\n51 — TOO MANY\nArt.'), /between 1 and 50/);
});

test('limits prevent silent source, title and prompt truncation', () => {
  assert.throws(() => parseArtworkBatch('x'.repeat(60001)), /60,000/);
  assert.throws(() => parseArtworkBatch(`01 — ${'X'.repeat(201)}\nArt.\n02 — SECOND\nArt.`), /200 characters/);
  assert.throws(() => parseArtworkBatch(`01 — FIRST\n${'x'.repeat(9001)}\n02 — SECOND\nArt.`), /9,000 characters/);
  const tooMany = Array.from({ length: 51 }, (_, i) => `${i + 1} — ART\nA painting.`).join('\n');
  assert.throws(() => parseArtworkBatch(tooMany), /at most 50/);
  const maximum = Array.from({ length: 50 }, (_, i) => `${i + 1} — ART\nA painting.`).join('\n');
  assert.equal(parseArtworkBatch(maximum).artworks.length, 50);
});

test('empty prompt is an isolated issue and ratio is never borrowed from the next item', () => {
  const batch = parseArtworkBatch('01 — EMPTY\n\n02 — SQUARE\nSquare image.');
  assert.equal(batch.artworks[0].prompt, '');
  assert.equal(batch.artworks[0].aspectRatio, null);
  assert.match(batch.artworks[0].issue, /Add a creative prompt/);
  assert.equal(batch.artworks[1].aspectRatio, '1:1');
});

const csvHeader = ['prompt_id', 'batch_id', 'title', 'subject', 'setting', 'composition', 'focal_motif', 'palette', 'lighting', 'atmosphere', 'medium', 'narrative', 'aspect_ratio', 'originality_signature'];
const csvCell = value => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
const csvText = (rows, headers = csvHeader) => [headers, ...rows.map(row => headers.map(name => row[name] ?? ''))].map(row => row.map(csvCell).join(',')).join('\r\n');
const csvArtwork = (index, changes = {}) => ({
  prompt_id: `B001-P${String(index).padStart(2, '0')}`, batch_id: 'B001', title: `Artwork ${index}`,
  subject: 'A repaired porcelain bowl', setting: 'A walnut tabletop', composition: 'An oval bowl with negative space',
  focal_motif: 'Three iron staples', palette: 'Ivory, warm umber, walnut brown', lighting: 'Upper-left window light',
  atmosphere: 'Intimate and grounded', medium: 'Simulated oil on wood panel', narrative: 'Objects remain worthy of care',
  aspect_ratio: '4:5', originality_signature: 'STILL-LIFE|stapled-bowl|oval|oil-panel', ...changes
});

test('CSV imports ten independent records and preserves original columns and metadata', () => {
  const ratios = ['4:5', '4:5', '3:2', '1:1', '4:5', '1:1', '16:9', '3:2', '3:2', '1:1'];
  const rows = ratios.map((ratio, index) => csvArtwork(index + 1, { aspect_ratio: ratio }));
  const source = csvText(rows);
  const batch = parseArtworkBatch(source);
  assert.equal(batch.originalText, source);
  assert.equal(batch.batchId, 'B001');
  assert.equal(batch.artworks.length, 10);
  assert.deepEqual(batch.artworks.map(art => art.aspectRatio), ratios);
  for (const [index, art] of batch.artworks.entries()) {
    assert.deepEqual(art.fields, rows[index]);
    assert.equal(art.promptId, rows[index].prompt_id);
    assert.equal(art.batchId, 'B001');
    assert.equal(art.issue, null);
    assert.ok(art.prompt.includes('Subject: A repaired porcelain bowl'));
    assert.ok(art.prompt.includes('Palette: Ivory, warm umber, walnut brown'));
    assert.ok(!art.prompt.includes(rows[index].originality_signature));
    assert.ok(!art.prompt.includes('originality_signature'));
    assert.ok(!art.prompt.includes(rows[index].prompt_id));
  }
});

test('CSV reader handles quoted commas, embedded newlines, escaped quotes and UTF-8 BOM', () => {
  const row = csvArtwork(1, {
    title: 'Greyhound, "Off Duty"',
    subject: ' First line\nSecond line with "quoted" words, and a comma ',
    medium: 'Simulated soft-ground etching, aquatint\r\nand sparse watercolor',
    aspect_ratio: '1:1'
  });
  const source = '\uFEFF' + csvText([row]) + '\r\n';
  const batch = parseArtworkBatch(source);
  assert.equal(batch.originalText, source);
  assert.equal(batch.artworks[0].title, row.title);
  assert.deepEqual(batch.artworks[0].fields, row);
  assert.ok(batch.artworks[0].prompt.includes(row.subject));
  assert.ok(batch.artworks[0].prompt.includes(row.medium));
});

test('CSV ratio field and body cross-check without treating square motifs as image shapes', () => {
  const batch = parseArtworkBatch(csvText([
    csvArtwork(1, { composition: 'A square window beside a ceramic bowl.', aspect_ratio: '4:5' }),
    csvArtwork(2, { subject: 'A square image of ceramic forms.', aspect_ratio: '4:5' }),
    csvArtwork(3, { composition: 'Portrait ratio 4:5; intended size 70 × 50 cm.' }),
    csvArtwork(4, { aspect_ratio: 'square' }),
    csvArtwork(5, { aspect_ratio: '' }),
    csvArtwork(6, { aspect_ratio: '70:50' }),
    csvArtwork(7, { aspect_ratio: 'wide' })
  ]));
  assert.equal(batch.artworks[0].aspectRatio, '4:5');
  assert.equal(batch.artworks[0].issue, null);
  assert.match(batch.artworks[1].issue, /Conflicting/);
  assert.equal(batch.artworks[1].aspectRatio, null);
  assert.match(batch.artworks[2].issue, /Conflicting/);
  assert.equal(batch.artworks[3].aspectRatio, '1:1');
  assert.equal(batch.artworks[4].aspectRatio, null);
  assert.equal(batch.artworks[4].issue, null);
  assert.equal(batch.artworks[5].aspectRatio, '7:5');
  assert.match(batch.artworks[6].issue, /positive width:height ratio/);
});

test('CSV validates required headers, identifiers, duplicate IDs and mixed batches', () => {
  assert.throws(() => parseArtworkBatch('prompt_id,batch_id,title\nP1,B001,A'), /missing required columns/);
  const duplicateHeader = csvHeader.join(',') + ',title\n';
  assert.throws(() => parseArtworkBatch(duplicateHeader), /duplicate column headers/);
  assert.throws(() => parseArtworkBatch(csvText([csvArtwork(1), csvArtwork(1)])), /prompt_id B001-P01 appears more than once/);
  assert.throws(() => parseArtworkBatch(csvText([csvArtwork(1), csvArtwork(2, { batch_id: 'B002' })])), /mixed batch_id/);
  assert.throws(() => parseArtworkBatch(csvText([csvArtwork(1, { prompt_id: '' })])), /needs prompt_id and batch_id/);
  assert.throws(() => parseArtworkBatch(csvText([csvArtwork(1, { subject: '' })])), /needs a subject/);
  assert.throws(() => parseArtworkBatch(csvText([])), /at least one artwork row/);
});

test('CSV malformed quoting and column counts fail with actionable messages', () => {
  const header = csvHeader.join(',');
  assert.throws(() => parseArtworkBatch(`${header}\n"unclosed`), /quoted field is not closed/);
  assert.throws(() => parseArtworkBatch(`${header}\nB001-P01,"B001"x`), /unexpected text after a closing quote/);
  assert.throws(() => parseArtworkBatch(`${header}\nB001-P01,B00"1`), /entire field in double quotes/);
  assert.throws(() => parseArtworkBatch(`${header}\nB001-P01,B001,Missing columns`), /has 3 columns; expected 14/);
  assert.throws(() => parseArtworkBatch(csvText([csvArtwork(1)]) + ',unquoted extra comma'), /has 15 columns; expected 14/);
});

test('CSV limits reject excessive rows, titles and composed prompts without truncation', () => {
  assert.throws(() => parseArtworkBatch(csvText(Array.from({ length: 51 }, (_, index) => csvArtwork(index + 1)))), /at most 50/);
  assert.throws(() => parseArtworkBatch(csvText([csvArtwork(1, { title: 'x'.repeat(201) })])), /1–200 characters/);
  assert.throws(() => parseArtworkBatch(csvText([csvArtwork(1, { subject: 'x'.repeat(9001) })])), /field longer than 9,000/);
  assert.throws(() => parseArtworkBatch(csvText([csvArtwork(1, { subject: 'x'.repeat(5000), medium: 'y'.repeat(5000) })])), /complete artwork prompt within 9,000/);
});
