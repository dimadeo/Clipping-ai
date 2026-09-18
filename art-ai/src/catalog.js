import fs from 'node:fs';
import path from 'node:path';

function parseCsvLine(line) {
  const values = []; let value = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { values.push(value); value = ''; }
    else value += char;
  }
  values.push(value); return values;
}

export function loadCatalog(file = path.resolve('50_luxury_digital_art_prompts.csv')) {
  if (!fs.existsSync(file)) return new Map();
  const [header, ...lines] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const keys = parseCsvLine(header);
  return new Map(lines.filter(Boolean).map((line) => {
    const row = Object.fromEntries(keys.map((key, index) => [key, parseCsvLine(line)[index] || '']));
    return [row.Product_Title.toLowerCase(), row];
  }));
}
