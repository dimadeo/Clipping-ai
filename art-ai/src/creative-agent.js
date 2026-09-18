import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PRINT_SIZES } from './print-sizes.js';
import { resolveArtworkRatio } from './prompt-shape.js';

const defaults = {
  movements: ['Japandi quiet luxury', 'Neo-Deco geometry', 'Luminous botanical surrealism', 'Heritage Renaissance revival', 'Biomorphic kinetic sculpture'],
  mediums: ['Giclee impression on textured Hahnemuhle German Etching paper', 'oil paint and raw plaster on Belgian linen', 'stone-plate lithograph with matte ink and deckled edge'],
  lightings: ['soft north-facing gallery daylight', 'dramatic museum spot lighting and deep volumetric shadows', 'warm late-afternoon architectural light'],
  compositions: ['a calm editorial composition with generous negative space', 'a tactile central form balanced by restrained supporting detail', 'a cinematic composition that leads the eye toward one focal moment'],
  negative: '--no watermark, signature, text, frame, mockup, plastic surface, CGI glow, blurry, distorted details'
};

const cleanText = (value, fallback = '', maximum = 500) => String(value || fallback).replace(/[<>]/g, '').trim().slice(0, maximum);
const boundedNumber = (value, fallback, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : fallback));
const printSizes = Object.fromEntries(PRINT_SIZES.map(size => [size.key, size]));
const pick = (choices, key, offset = 0) => choices[Number.parseInt(crypto.createHash('sha256').update(`${key}:${offset}`).digest('hex').slice(0, 8), 16) % choices.length];

export class CreativeMemory {
  constructor(file = path.resolve('data/creative-memory.json')) {
    this.file = file;
    this.data = { feedback: [], directions: {} };
    if (file && fs.existsSync(file)) {
      try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* A corrupt learning cache must not stop fulfillment. */ }
    }
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  record({ promptId, score, tags = [], note = '' }) {
    const rating = Number(score);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('Score must be an integer from 1 to 5');
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) throw new Error('Tags must be a list of creative directions');
    const safeTags = tags.map((tag) => cleanText(tag)).filter(Boolean).slice(0, 8);
    const entry = { promptId: cleanText(promptId), score: rating, tags: safeTags, note: cleanText(note), at: new Date().toISOString() };
    this.data.feedback = [...this.data.feedback, entry].slice(-250);
    for (const tag of safeTags) {
      this.data.directions[tag] = (this.data.directions[tag] || 0) + (rating >= 4 ? 1 : -1);
    }
    this.save();
    return entry;
  }

  insights() {
    const ranked = Object.entries(this.data.directions).sort((a, b) => b[1] - a[1]);
    const averageScore = this.data.feedback.length ? this.data.feedback.reduce((total, item) => total + item.score, 0) / this.data.feedback.length : null;
    return { feedbackCount: this.data.feedback.length, averageScore, preferredDirections: ranked.filter(([, score]) => score > 0).slice(0, 6).map(([tag]) => tag), avoidDirections: ranked.filter(([, score]) => score < 0).slice(-6).map(([tag]) => tag) };
  }
}

export class CreativePromptAgent {
  constructor({ catalog = new Map(), memory = new CreativeMemory() } = {}) { this.catalog = catalog; this.memory = memory; }

  create(brief = {}) {
    const subject = cleanText(brief.subject, 'an abstract luxury-art composition', 9000);
    const promptRatio = resolveArtworkRatio(brief.subject);
    const goal = cleanText(brief.goal, 'create a memorable gallery-quality art concept');
    const audience = cleanText(brief.audience, 'a discerning interior-design customer');
    const key = `${subject}:${goal}:${brief.palette || ''}:${brief.mood || ''}`;
    const catalogItem = this.catalog.get(cleanText(brief.productTitle).toLowerCase());
    const learning = this.memory.insights();
    const requestedMovement = cleanText(brief.movement);
    const requestedMedium = cleanText(brief.medium);
    const requestedPalette = cleanText(brief.palette, catalogItem?.Color_Palette || 'a refined, restrained palette');
    const requestedMood = cleanText(brief.mood, 'considered, tactile, and emotionally resonant');
    const collectionName = cleanText(brief.collectionName, 'Untitled collection');
    const imageCount = boundedNumber(brief.imageCount, 3, 1, 50);
    const deliverySizes = Array.isArray(brief.deliverySizes) ? [...new Set(brief.deliverySizes.filter((size) => printSizes[size]))] : [];
    const printTexture = Boolean(brief.printTexture);
    const creativeDirection = requestedMovement || learning.preferredDirections[0] || pick(defaults.movements, key);
    const base = {
      subject,
      goal,
      audience,
      movement: creativeDirection,
      palette: requestedPalette,
      mood: requestedMood,
      medium: requestedMedium || catalogItem?.Medium_Texture || pick(defaults.mediums, key),
      aspectRatio: promptRatio || (!brief.aspectRatio || brief.aspectRatio === 'auto' ? null : cleanText(brief.aspectRatio)),
      stylize: boundedNumber(brief.stylize, 650, 0, 1000),
      chaos: boundedNumber(brief.chaos, 0, 0, 100),
      styleRaw: Boolean(brief.styleRaw),
      collectionName,
      imageCount,
      deliverySizes,
      printTexture
    };
    const candidates = [0, 1, 2].map((variation) => {
      const composition = defaults.compositions[(defaults.compositions.indexOf(pick(defaults.compositions, key)) + variation) % defaults.compositions.length];
      const lighting = defaults.lightings[(defaults.lightings.indexOf(pick(defaults.lightings, key)) + variation) % defaults.lightings.length];
      const textureDirection = base.printTexture ? ' Print-ready tactile surface: visible authentic paint grain, pigment variation, natural canvas or paper fibre, and subtle hand-worked material depth; artwork only, never a room mockup.' : '';
      const prompt = `Fine art creation: ${base.subject}. Creative intention: ${base.goal}, for ${base.audience}. Direction: ${base.movement}. Composition: ${composition}. Physical medium: ${base.medium}. Illumination: ${lighting}. Mood: ${base.mood}. Color space: ${base.palette}.${textureDirection} Gallery exhibition quality, tactile material authenticity, deliberate artistic restraint${base.styleRaw ? ' --style raw' : ''}${base.aspectRatio ? ` --ar ${base.aspectRatio}` : ''} --stylize ${Math.min(1000, base.stylize + variation * 50)} --chaos ${base.chaos} ${defaults.negative}`;
      return { label: ['Foundation', 'Contrast', 'Editorial'][variation], prompt, creativeRationale: `${composition}; ${lighting}.` };
    });
    return { promptId: crypto.randomUUID(), brief: base, candidates, delivery: { collectionName, requestedImages: imageCount, printTexture, uhdNote: 'Create the final customer files at 300 DPI after selecting and upscaling the approved artwork. Midjourney prompts can request texture but cannot guarantee a print-ready UHD file.', printSizes: deliverySizes.map((size) => printSizes[size]) }, learning: { preferredDirections: learning.preferredDirections, avoidDirections: learning.avoidDirections, feedbackCount: learning.feedbackCount }, guidance: 'Choose one candidate, then give feedback using: keep / change / because / try. Rate the result after it is rendered so the agent can favor useful creative directions.' };
  }

  learn(feedback) { return { feedback: this.memory.record(feedback), insights: this.memory.insights() }; }
  insights() { return this.memory.insights(); }
}
