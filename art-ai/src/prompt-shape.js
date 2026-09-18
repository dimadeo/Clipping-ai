// Pure and shared with the browser: no provider call, no silent default ratio.
export function resolveArtworkRatio(prompt) {
  const text = String(prompt || '');
  if ([...text.matchAll(/^\s*\d{1,2}\s*[—–]\s*\S/gm)].length > 1) {
    throw new Error('Multiple artwork prompts detected. This form still prepares one artwork at a time; no shared shape will be applied to the batch.');
  }
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const normalize = (a, b) => {
    a = Number(a); b = Number(b);
    if (![a,b].every(n => Number.isSafeInteger(n) && n > 0 && n <= 10000)) throw new Error('Use a positive width:height ratio, for example 7:5.');
    const divisor = gcd(a,b); return `${a/divisor}:${b/divisor}`;
  };
  const ratios = [...text.matchAll(/\b(\d+)\s*:\s*(\d+)\b/g)].map(match => normalize(match[1],match[2]));
  if (/\bsquare\s+(?:image|artwork|format|composition)\b|^\s*square\s*[.!]?\s*$/i.test(text)) ratios.push('1:1');
  const dimensions = [...text.matchAll(/\b(\d+)\s*[×x]\s*(\d+)\s*cm\b/gi)].map(match => normalize(match[1],match[2]));
  const unique = [...new Set([...ratios, ...dimensions])];
  if (unique.length > 1) throw new Error('Conflicting ratios or dimensions in this prompt. Keep one artwork ratio before preparing it.');
  return unique[0] || null;
}
