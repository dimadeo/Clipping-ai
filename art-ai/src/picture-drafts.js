import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { highestFluxSize, FLUX_MAX_PIXELS } from './creation-formats.js';

const fail = message => { throw Object.assign(new Error(message), {statusCode:400}); };
const gcd = (a,b) => b ? gcd(b,a%b) : a;
const ratioOf = (width,height) => { const d=gcd(width,height); return `${width/d}:${height/d}`; };

// Photos need not have a standard print ratio. Match their proportions as closely
// as the provider's 16-pixel increments permit, without cropping the input.
export function pictureFormat(picture, selected='source', {resolution='highest',pixelWidth,pixelHeight}={}) {
  if(!['highest','2mp','1mp','custom'].includes(resolution))fail('Choose an output resolution.');
  if(resolution==='custom'){
    if(![pixelWidth,pixelHeight].every(n=>Number.isInteger(n)&&n>=64&&n<=4096&&n%16===0)||pixelWidth*pixelHeight>FLUX_MAX_PIXELS)fail('Custom pixels must be 64–4096 per side, in multiples of 16, and no more than 2048 × 2048 pixels in total. Choose a smaller size or use a preset.');
    return {aspectRatio:ratioOf(pixelWidth,pixelHeight),generation:{width:pixelWidth,height:pixelHeight},shapeNote:'Custom pixel dimensions determine the output shape; the composition may change to fit.'};
  }
  const pixelLimit=resolution==='2mp'?2_000_000:resolution==='1mp'?1_000_000:FLUX_MAX_PIXELS;
  if (selected !== 'source') {
    highestFluxSize(selected); // Validate and normalize through the common provider bounds.
    const [rawWidth,rawHeight]=selected.split(':').map(Number),divisor=gcd(rawWidth,rawHeight);
    const w=rawWidth/divisor,h=rawHeight/divisor;
    const multiple=Math.min(Math.floor(Math.sqrt(pixelLimit/(w*h*256))),Math.floor(4096/(Math.max(w,h)*16)));
    if(multiple<1||Math.min(w,h)*multiple*16<64)fail('This shape cannot fit the selected resolution. Choose a higher resolution or another shape.');
    return {aspectRatio:ratioOf(w,h),generation:{width:w*multiple*16,height:h*multiple*16},shapeNote:'Requested output shape; the composition may change to fit.'};
  }
  const ratio=picture.width/picture.height;
  if (!Number.isFinite(ratio)||ratio<=0) fail('Picture dimensions are not valid.');
  let best=null;
  for(let width=64;width<=4096;width+=16){
    const height=Math.round(width/ratio/16)*16;
    const pixels=width*height;
    if(height<64||height>4096||pixels>pixelLimit||pixels<pixelLimit*.7)continue;
    const error=Math.abs(width/height/ratio-1);
    if(!best||error<best.error-1e-9||(Math.abs(error-best.error)<1e-9&&pixels>best.pixels))best={width,height,error,pixels};
  }
  if(!best||best.error>.02)fail('This picture is too panoramic for FLUX. Choose an output ratio or upload a less extreme shape.');
  return {aspectRatio:ratioOf(best.width,best.height),generation:{width:best.width,height:best.height},shapeNote:best.error<1e-9?'Original picture proportions.':'Picture proportions approximated to fit the provider’s pixel increments; no source crop is applied.'};
}

export class PictureDrafts {
  constructor({pictures,file=path.resolve('data/picture-drafts.json')}={}) {
    this.pictures=pictures;this.file=file;
    this.drafts=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
  }
  save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.drafts,null,2));fs.renameSync(this.file+'.tmp',this.file);}
  get(id){const draft=this.drafts.find(d=>d.id===id);if(!draft)throw Object.assign(new Error('Picture plan not found. Prepare it again.'),{statusCode:404});return structuredClone(draft);}
  prepare(input){
    const {pictureIds,mode,title,instructions,aspectRatio='source',resolution='highest',pixelWidth,pixelHeight}=input;
    if(!Array.isArray(pictureIds)||pictureIds.length<1||pictureIds.length>8||new Set(pictureIds).size!==pictureIds.length)fail('Select between 1 and 8 different pictures.');
    if(!['single','collection'].includes(mode))fail('Choose one artwork or a collection.');
    if(typeof title!=='string'||!title.trim()||title.trim().length>200)fail('Add a title of 1 to 200 characters.');
    if(typeof instructions!=='string'||!instructions.trim()||instructions.length>9000)fail('Describe the transformation in 1 to 9000 characters.');
    if(typeof aspectRatio!=='string')fail('Choose a valid output shape.');
    const pictures=pictureIds.map(id=>this.pictures.get(id));
    if(new Set(pictures.map(p=>p.id)).size!==pictures.length)fail('Select different pictures; the same picture cannot be included twice.');
    const groups=mode==='single'?[pictures]:pictures.map(p=>[p]);
    const artworks=groups.map((references,index)=>{
      const format=pictureFormat(references[0],aspectRatio,{resolution,pixelWidth,pixelHeight});
      if(mode==='single'&&references.length>1&&aspectRatio==='source'&&resolution!=='custom')format.shapeNote='The first selected picture determines this output shape. '+format.shapeNote;
      const prompt=[instructions.trim(),mode==='collection'?'Create one separate finished artwork from this reference picture. Do not make a collage or contact sheet. Keep the visual treatment consistent with the collection brief.':'Create one finished artwork using the attached reference pictures and the transformation instructions above.',`Output width-to-height ratio: ${format.aspectRatio}.`].join('\n\n');
      return {number:index+1,title:mode==='single'?title.trim():`${title.trim().slice(0,185)} · ${index+1}`,prompt,referenceIds:references.map(p=>p.id),referenceNames:references.map(p=>p.name),...format};
    });
    const draft={id:crypto.randomUUID(),title:title.trim(),mode,instructions:instructions.trim(),resolution,pictureIds:pictures.map(p=>p.id),artworks,createdAt:new Date().toISOString()};
    // Keep a bounded history of unsubmitted plans; submitted jobs retain their own metadata.
    this.drafts.push(draft);this.drafts=this.drafts.slice(-100);this.save();
    return structuredClone(draft);
  }
}
