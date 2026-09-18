import { resolveArtworkRatio } from './prompt-shape.js';

const invalidBatch = message => Object.assign(new Error(message), { statusCode: 400 });

const csvHeaders = ['prompt_id', 'batch_id', 'title', 'subject', 'setting', 'composition', 'focal_motif', 'palette', 'lighting', 'atmosphere', 'medium', 'narrative', 'aspect_ratio', 'originality_signature'];
const creativeFields = [['subject', 'Subject'], ['setting', 'Setting'], ['composition', 'Composition'], ['focal_motif', 'Focal motif'], ['palette', 'Palette'], ['lighting', 'Lighting'], ['atmosphere', 'Atmosphere'], ['medium', 'Medium'], ['narrative', 'Narrative']];

/** Small strict CSV reader: quoted commas/newlines and doubled quotes are data. */
function readCsv(text) {
  const rows = [];
  let row = [], value = '', quoted = false, closedQuote = false;
  const endField = () => { row.push(value); value = ''; closedQuote = false; };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { value += '"'; index++; }
        else { quoted = false; closedQuote = true; }
      } else value += char;
      continue;
    }
    if (char === ',') { endField(); continue; }
    if (char === '\n' || char === '\r') {
      endRow();
      if (char === '\r' && text[index + 1] === '\n') index++;
      continue;
    }
    if (closedQuote) {
      if (char === ' ' || char === '\t') continue;
      throw invalidBatch('Malformed CSV: unexpected text after a closing quote. Separate columns with commas.');
    }
    if (char === '"') {
      if (value) throw invalidBatch('Malformed CSV: put the entire field in double quotes, and escape an internal quote as two double quotes.');
      quoted = true;
    } else value += char;
  }
  if (quoted) throw invalidBatch('Malformed CSV: a quoted field is not closed. Check the final double quote.');
  if (row.length || value || closedQuote) endRow();
  return rows;
}

function parseCsvBatch(originalText) {
  const rows = readCsv(originalText.replace(/^\uFEFF/, '').trimStart());
  const header = rows.shift().map(value => value.trim().toLowerCase());
  if (new Set(header).size !== header.length) throw invalidBatch('The CSV has duplicate column headers. Give every column a unique name.');
  const missing = csvHeaders.filter(name => !header.includes(name));
  if (missing.length) throw invalidBatch(`The CSV is missing required columns: ${missing.join(', ')}.`);
  if (header.length > 50 || header.some(name => !/^[a-z][a-z0-9_]{0,63}$/.test(name))) throw invalidBatch('Use at most 50 CSV columns with plain letter, number and underscore header names.');
  if (!rows.length) throw invalidBatch('Add at least one artwork row beneath the CSV header.');
  if (rows.length > 50) throw invalidBatch('A batch can contain at most 50 artworks. Split these prompts into smaller batches.');

  const identifiers = new Set();
  let batchId;
  const artworks = rows.map((row, index) => {
    const number = index + 1;
    if (row.length !== header.length) throw invalidBatch(`CSV artwork row ${number} has ${row.length} columns; expected ${header.length}. Put fields containing commas or newlines inside double quotes.`);
    if (row.some(value => value.length > 9000)) throw invalidBatch(`CSV artwork row ${number} contains a field longer than 9,000 characters.`);
    // Store every original field, including metadata, without rewriting values.
    const fields = Object.fromEntries(header.map((name, column) => [name, row[column]]));
    const promptId = fields.prompt_id.trim();
    const rowBatchId = fields.batch_id.trim();
    if (![promptId, rowBatchId].every(value => /^[a-z0-9][a-z0-9_-]{0,99}$/i.test(value))) throw invalidBatch(`CSV artwork row ${number} needs prompt_id and batch_id values of 1–100 letters, numbers, hyphens or underscores.`);
    if (identifiers.has(promptId)) throw invalidBatch(`CSV prompt_id ${promptId} appears more than once. Give each artwork a unique prompt_id.`);
    identifiers.add(promptId);
    if (batchId && batchId !== rowBatchId) throw invalidBatch('The CSV contains mixed batch_id values. Keep one batch per submission.');
    batchId = rowBatchId;
    const title = fields.title.trim();
    if (!title || title.length > 200) throw invalidBatch(`CSV artwork ${promptId} needs a title of 1–200 characters.`);
    if (!fields.subject.trim()) throw invalidBatch(`CSV artwork ${promptId} needs a subject.`);

    // originality_signature is deduplication metadata, not visible lettering.
    const body = creativeFields.map(([name, label]) => `${label}: ${fields[name]}`).join('\n');
    const ratioText = fields.aspect_ratio.trim();
    const prompt = body + (ratioText ? `\nAspect ratio: ${ratioText}` : '');
    if (prompt.length > 9000) throw invalidBatch(`Artwork ${promptId} is too long. Keep each complete artwork prompt within 9,000 characters.`);
    let aspectRatio = null;
    let issue = null;
    try {
      let declaredRatio = null;
      if (ratioText) {
        if (!/^(?:\d+\s*:\s*\d+|square)$/i.test(ratioText)) throw new Error('Use a positive width:height ratio in aspect_ratio, for example 4:5, or leave it empty for a free shape.');
        declaredRatio = resolveArtworkRatio(ratioText);
      }
      // Use the same deliberate ratio hints as plain prompts. A square bowl,
      // window or relief motif alone does not force a square image.
      aspectRatio = resolveArtworkRatio(body + (declaredRatio ? `\nAspect ratio: ${declaredRatio}` : ''));
    } catch (error) { issue = error.message; }
    return { number, title, prompt, aspectRatio, issue, fields, promptId, batchId: rowBatchId };
  });
  return { originalText, batchId, artworks };
}

/** Split numbered artwork briefs only; preparation never calls an image provider. */
export function parseArtworkBatch(text) {
  if (typeof text !== 'string') return null;
  if (text.length > 60000) throw invalidBatch('The batch is too long. Keep the complete batch within 60,000 characters.');

  const firstLine = text.replace(/^\uFEFF/, '').trimStart().split(/\r?\n/, 1)[0];
  if (/^(?:"?prompt_id"?|"?batch_id"?)[ \t]*,/i.test(firstLine)) return parseCsvBatch(text);

  // Require a dash-separated title on its own line, not workflow steps such as
  // "1. Accept all prompts". CRLF and Markdown bold headings are accepted.
  const headings = [...text.matchAll(/^[ \t]*(?:\*\*)?(\d{1,3})[ \t]*[—–-][ \t]+([^\r\n]+?)[ \t]*\r?$/gm)];
  if (headings.length < 2) return null;
  if (headings.length > 50) throw invalidBatch('A batch can contain at most 50 artworks. Split these prompts into smaller batches.');

  const seen = new Set();
  let previousNumber = 0;
  const artworks = headings.map((heading, index) => {
    const number = Number(heading[1]);
    if (number < 1 || number > 50) throw invalidBatch('Artwork numbers must be between 1 and 50. Renumber the artwork headings before preparing this batch.');
    if (seen.has(number)) throw invalidBatch(`Artwork number ${number} appears more than once. Give each artwork a unique number.`);
    if (number < previousNumber) throw invalidBatch(`Artwork ${number} is out of order after artwork ${previousNumber}. Arrange the headings in increasing numerical order.`);
    seen.add(number);
    previousNumber = number;

    const title = heading[2].replace(/[ \t]*\\[ \t]*$/, '').replace(/\*\*[ \t]*$/, '').replace(/[ \t]*\\[ \t]*$/, '').trim();
    if (!title) throw invalidBatch(`Artwork ${number} needs a title on its numbered heading.`);
    if (title.length > 200) throw invalidBatch(`The title for artwork ${number} is too long. Keep it within 200 characters.`);

    const prompt = text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length).trim();
    if (prompt.length > 9000) throw invalidBatch(`Artwork ${number} is too long. Keep each artwork prompt within 9,000 characters.`);

    let aspectRatio = null;
    let issue = null;
    if (!prompt) {
      issue = 'Add a creative prompt beneath this artwork title.';
    } else {
      try { aspectRatio = resolveArtworkRatio(prompt); }
      catch (error) { issue = error.message; }
    }
    return { number, title, prompt, aspectRatio, issue };
  });

  return { originalText: text, artworks };
}
