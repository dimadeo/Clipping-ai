import crypto from 'node:crypto';

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

function integer(value, label, maximum) {
  if (!/^[0-9]+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) {
    throw badRequest(`${label} must be an integer between 0 and ${maximum}`);
  }
  return Number(value);
}

function ratio(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(value) ||
      value.split(':').some((part) => !Number.isSafeInteger(Number(part)))) {
    throw badRequest('Midjourney aspectRatio must contain positive integers, for example 4:5');
  }
  return value;
}

/** Prepare an operator handoff. This module never contacts or automates Midjourney. */
export function buildMidjourneyHandoff(input = {}) {
  if (typeof input.compiledPrompt !== 'string' || !input.compiledPrompt.trim() || input.compiledPrompt.length > 12000) {
    throw badRequest('Midjourney requires a compiledPrompt of 1 to 12000 characters');
  }
  const parameters = { ar: [], seed: [], stylize: [], no: [] };
  const stripParameters = (text) => text.replace(/(?:^|\s)--(ar|aspect|seed|stylize|s|no)(?=\s|$)\s*([\s\S]*?)(?=\s--[a-z][a-z-]*(?:\s|$)|$)/gi, (_, flag, value) => {
    const name = ({ aspect: 'ar', s: 'stylize' })[flag.toLowerCase()] || flag.toLowerCase();
    parameters[name].push(value.trim());
    return ' ';
  }).replace(/\s+/g, ' ').trim();
  const body = stripParameters(input.compiledPrompt);
  if (!body) throw badRequest('Midjourney compiledPrompt must include a creative description');
  if (input.negativePrompt !== undefined && typeof input.negativePrompt !== 'string') throw badRequest('negativePrompt must be text');
  const negativeText = stripParameters(input.negativePrompt || '');
  if (negativeText) parameters.no.push(negativeText);
  parameters.ar.forEach(ratio);
  parameters.seed.forEach((value) => integer(value, 'Midjourney seed', 4294967295));
  parameters.stylize.forEach((value) => integer(value, 'Midjourney stylize', 1000));
  const aspectRatio = input.aspectRatio === null ? null : ratio(input.aspectRatio ?? parameters.ar.at(-1) ?? '4:5');
  const seed = integer(input.seed ?? parameters.seed.at(-1) ?? Number.parseInt(crypto.createHash('sha256').update(body).digest('hex').slice(0, 8), 16), 'Midjourney seed', 4294967295);
  const stylize = integer(parameters.stylize.at(-1) ?? 700, 'Midjourney stylize', 1000);
  const exclusions = [...new Set(parameters.no.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))];
  const negativePrompt = (exclusions.length ? exclusions : ['watermark', 'signature', 'text']).join(', ');
  return {
    executor: 'midjourney', mode: 'manual', createUrl: 'https://www.midjourney.com/imagine',
    prompt: `${body}${aspectRatio ? ` --ar ${aspectRatio}` : ''} --seed ${seed} --stylize ${stylize} --no ${negativePrompt}`,
    aspectRatio, seed, stylize, negativePrompt,
    instructions: 'Copy this prompt into Midjourney, create and select the final artwork, then submit its cdn.midjourney.com image URL to resume this job.'
  };
}

export function validateMidjourneyResult({ assetUrl, sourceJobId } = {}) {
  if (typeof assetUrl !== 'string' || assetUrl.length > 2048 || !/^https:\/\/cdn\.midjourney\.com\//i.test(assetUrl) || /[\s\\]/.test(assetUrl)) {
    throw badRequest('assetUrl must be a public HTTPS image URL on cdn.midjourney.com without credentials or a port');
  }
  let url;
  try { url = new URL(assetUrl); } catch { throw badRequest('assetUrl is invalid'); }
  if (url.protocol !== 'https:' || url.hostname !== 'cdn.midjourney.com' || url.username || url.password || url.port || url.hash || !/\.(png|jpe?g|webp)$/i.test(url.pathname)) {
    throw badRequest('assetUrl must be a public HTTPS PNG, JPEG, or WebP image on cdn.midjourney.com');
  }
  if (sourceJobId !== undefined && (typeof sourceJobId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(sourceJobId))) {
    throw badRequest('sourceJobId must contain 1 to 128 letters, numbers, underscores, or hyphens');
  }
  return { assetUrl: url.href, ...(sourceJobId === undefined ? {} : { sourceJobId }) };
}
