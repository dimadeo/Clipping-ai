// BFL documents up to 4 MP (2048 × 2048), with dimensions in multiples of 16.
// Keep exact aspect ratios, choosing the largest aligned size within that limit.
export const FLUX_MAX_PIXELS = 2048 * 2048;
export const CREATION_FORMATS = [
  { ratio: '4:5', label: 'Portrait · vertical' },
  { ratio: '5:4', label: 'Portrait · horizontal' },
  { ratio: '1:1', label: 'Square' },
  { ratio: '3:2', label: 'Landscape' },
  { ratio: '16:9', label: 'Wide landscape' }
];
export function highestFluxSize(ratio='4:5') {
  if (typeof ratio !== 'string' || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(ratio)) throw Object.assign(new Error('Add a ratio to the prompt before FLUX generation, for example 7:5 or square image.'), {statusCode:409});
  const parts=ratio.split(':').map(Number);
  if (parts.some(n=>!Number.isSafeInteger(n)||n>10000)) throw Object.assign(new Error('Aspect ratio is too large.'), {statusCode:409});
  const gcd=(a,b)=>b?gcd(b,a%b):a;const divisor=gcd(...parts);
  const [w,h]=parts.map(n=>n/divisor);
  const multiple=Math.min(Math.floor(Math.sqrt(FLUX_MAX_PIXELS / (w*h*16*16))),Math.floor(4096/(Math.max(w,h)*16)));
  if (multiple<1 || Math.min(w,h)*multiple*16<64 || Math.max(w,h)*multiple*16>4096) throw Object.assign(new Error('This ratio exceeds the supported FLUX dimensions. Adjust the ratio in the prompt.'), {statusCode:409});
  return {width:w*multiple*16,height:h*multiple*16};
}
