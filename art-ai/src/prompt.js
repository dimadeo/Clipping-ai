import crypto from 'node:crypto';

const negative = '--no text, watermark, signature, blurry, low resolution, frame, mockup, border';
export function compilePrompt({ productTitle, properties = {}, catalog }) {
  const product = catalog.get((productTitle || '').toLowerCase());
  const subject = properties.pet_name
    ? `${properties.pet_name}, ${properties.pet_type || 'beloved companion'}, ${properties.portrait_direction || 'a dignified portrait'}`
    : product?.Subject || productTitle || 'abstract biomorphic gallery composition';
  const prompt = product?.Full_Automated_Prompt ||
    `Fine art creation: ${subject}, archival Giclee texture on Hahnemuhle German Etching paper, soft museum lighting, quiet luxury palette, gallery exhibition quality --ar 4:5 --stylize 700`;
  const seed = Number.parseInt(crypto.createHash('sha256').update(`${productTitle}:${JSON.stringify(properties)}`).digest('hex').slice(0, 8), 16);
  return {
    compiledPrompt: properties.pet_name ? `${prompt.replace(product?.Subject || '', subject)}` : prompt,
    negativePrompt: product?.Negative_Prompt || negative,
    aspectRatio: (product?.Aspect_Ratio_DPI.match(/--ar\s+([^\s]+)/)?.[1]) || '4:5',
    seed,
    overlayLayers: { templateId: properties.template_id || 'portrait-canvas-v1', layers: properties }
  };
}
