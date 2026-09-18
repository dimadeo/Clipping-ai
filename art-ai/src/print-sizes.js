const gcd = (a, b) => b ? gcd(b, a % b) : a;
export const PRINT_SIZES = [[30,40],[40,50],[50,70],[60,90],[70,100],[80,120],[100,150],[150,100],[30,30],[40,40],[50,50],[60,60],[80,80],[100,100]].map(([widthCm,heightCm]) => {
  const divisor = gcd(widthCm,heightCm);
  return { key: `${widthCm}×${heightCm} cm`, size: `${widthCm} × ${heightCm} cm`, widthCm, heightCm,
    pixels: `${Math.ceil(widthCm / 2.54 * 300)} × ${Math.ceil(heightCm / 2.54 * 300)} px`, ratio: `${widthCm/divisor}:${heightCm/divisor}` };
});
