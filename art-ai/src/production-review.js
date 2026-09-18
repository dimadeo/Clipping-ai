import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { validateMidjourneyResult } from './midjourney.js';
import { PRINT_SIZES } from './print-sizes.js';
import { suggestArtworkPrice, sizeLadder } from './artwork-pricing.js';

const fail = (message, statusCode = 409) => { throw Object.assign(new Error(message), { statusCode }); };
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 64 * 1000 * 1000;
const ORIGINAL_FILE_NAME = /^[a-f0-9]{16}-[a-f0-9]{64}\.(png|jpg)$/;
export function imageDimensions(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      let marker = bytes[offset++];
      while (marker === 255) marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 7) {
        return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
      }
      offset += length;
    }
  }
  fail('Use a PNG or JPEG file for the resolution check.');
}

export function resolutionReport({ width, height }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) fail('Invalid image dimensions');
  const sizes = PRINT_SIZES.map(({widthCm:w,heightCm:h}) => {
    const ppi = Math.floor(Math.min(width / (w / 2.54), height / (h / 2.54)));
    return { label: `${w} × ${h} cm`, ppi, meets300Ppi: ppi >= 300, cropNeeded: Math.abs(width / height - w / h) > 0.005 };
  });
  return { width, height, megapixels: +(width * height / 1e6).toFixed(2),
    score: Math.min(100, Math.round(sizes[0].ppi / 300 * 100)),
    scoreLabel: 'Resolution score for 30 × 40 cm at 300 PPI; not an artistic-quality score',
    maxPrintCm: `${(width / 300 * 2.54).toFixed(1)} × ${(height / 300 * 2.54).toFixed(1)} cm`, sizes };
}

const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');
const publishingBlockers = ['Automatic Shopify upload is not implemented yet; this item is queued locally, not published.', 'Digital Products is installed. Attaching the customer download and testing delivery still need completion.'];
export const reviewZone = item => item.status === 'rejected' ? 'rejected' : item.status === 'approved_product_prepared' ? 'approved' : 'pending';
const html = (text) => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class ProductionReview {
  constructor({ sources, file = path.resolve('data/production-reviews.json'), assetRoot = path.resolve('assets'), fetchImage = fetch, archiveRoot = path.dirname(file), fileRoot = path.join(path.dirname(file), 'review-files'), pricingSamples, pricingNow } = {}) {
    Object.assign(this, { sources, file, assetRoot, fetchImage, archiveRoot: path.resolve(archiveRoot), fileRoot: path.resolve(fileRoot), pricingSamples, pricingNow });
    this.records = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    this.locks = new Map();
  }
  async locked(id, action) {
    const prior=this.locks.get(id)||Promise.resolve();
    const work=prior.catch(()=>{}).then(action);this.locks.set(id,work);
    try{return await work;}finally{if(this.locks.get(id)===work)this.locks.delete(id);}
  }
  backup(id, source, bytes, bucket, decision) {
    const hash=digest(bytes), extension=bytes[0]===137?'png':'jpg';
    const fileName=digest(id).slice(0,16)+'-'+hash+'.'+extension;
    const directory=path.join(this.archiveRoot,bucket), destination=path.join(directory,fileName);
    fs.mkdirSync(directory,{recursive:true});
    if(fs.existsSync(destination)){
      if(digest(fs.readFileSync(destination))!==hash)fail('The existing backup is damaged. Restore or repair it before approving this file.');
    }else fs.writeFileSync(destination,bytes,{flag:'wx'});
    const archive={bucket,fileName,hash,at:new Date().toISOString(),url:'/api/production-review/archive/'+bucket+'/'+fileName};
    const manifest=destination+'.json',temporary=manifest+'.tmp';
    const {archive:previousArchive,workflow:previousWorkflow,archiveError,...snapshot}=decision;
    snapshot.workflow=bucket==='Approved'?{stage:'shopify_pending',backupUrl:archive.url,blockers:[...publishingBlockers]}:{stage:'rejected_archive'};
    fs.writeFileSync(temporary,JSON.stringify({artworkId:id,title:decision.approval?.title||source.title,sourceUrl:source.assetUrl,archive,decision:snapshot},null,2));fs.renameSync(temporary,manifest);
    return archive;
  }
  archiveFile(bucket,fileName) {
    if(!['Approved','Rejected'].includes(bucket)||!/^[a-f0-9]{16}-[a-f0-9]{64}\.(png|jpg)$/.test(fileName))fail('Invalid archive file');
    const directory=path.join(this.archiveRoot,bucket),file=path.join(directory,fileName);
    if(!fs.existsSync(file))fail('Backup file is missing');
    if(!fs.realpathSync(file).startsWith(fs.realpathSync(directory)+path.sep))fail('Invalid archive path');
    const bytes=fs.readFileSync(file);
    if(digest(bytes)!==fileName.slice(17,81))fail('Backup file integrity check failed');
    return {bytes,contentType:fileName.endsWith('.png')?'image/png':'image/jpeg'};
  }
  commit(id,next){const previous=this.records[id];this.records[id]=next;try{this.save();}catch(error){this.records[id]=previous;throw error;}return next;}
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(this.records, null, 2));
    fs.renameSync(temporary, this.file);
  }
  source(id) { return this.sources().find(item => item.id === id) || fail('Artwork not found'); }
  localFileMatches(source, record = this.records[source.id]) {
    const local = record?.localFile;
    return Boolean(local && record.sourceUrl === source.assetUrl && local.sourceUrl === source.assetUrl
      && /^[a-f0-9]{64}$/.test(local.hash) && local.hash === record.hash
      && ORIGINAL_FILE_NAME.test(local.fileName)
      && local.fileName.startsWith(digest(source.id).slice(0, 16) + '-' + local.hash + '.')
      && Number.isInteger(local.bytes) && local.bytes > 0 && local.bytes <= MAX_IMAGE_BYTES
      && Number.isInteger(local.width) && Number.isInteger(local.height)
      && local.width > 0 && local.height > 0 && local.width * local.height <= MAX_IMAGE_PIXELS);
  }
  readOriginal(local) {
    if (!ORIGINAL_FILE_NAME.test(local.fileName)) fail('Invalid original file name');
    const file = path.join(this.fileRoot, local.fileName);
    if (!fs.existsSync(file)) fail('The imported original is missing. Import the original PNG/JPEG again for a pending artwork.');
    const root = fs.realpathSync(this.fileRoot), real = fs.realpathSync(file);
    if (!real.startsWith(root + path.sep) || fs.lstatSync(file).isSymbolicLink() || !fs.statSync(real).isFile()) fail('Invalid original file path');
    const size = fs.statSync(real).size;
    if (size > MAX_IMAGE_BYTES || size !== local.bytes) fail('Imported original integrity check failed. The stored file size changed.');
    const bytes = fs.readFileSync(real);
    if (digest(bytes) !== local.hash || local.fileName.slice(17, 81) !== local.hash) fail('Imported original integrity check failed. The stored file changed.');
    return { bytes, contentType: local.fileName.endsWith('.png') ? 'image/png' : 'image/jpeg' };
  }
  fileImage(id) {
    const source = this.source(id), record = this.records[id];
    if (!this.localFileMatches(source, record)) fail('No imported original is bound to this artwork.');
    return this.readOriginal(record.localFile);
  }
  attachFile(id, bytes, options = {}) {
    // Copy the request bytes before waiting on another review action.
    const original = bytes instanceof Uint8Array && bytes.byteLength <= MAX_IMAGE_BYTES ? Buffer.from(bytes) : null;
    return this.locked(id, async () => {
      const source = this.source(id), previous = this.records[id];
      if (previous && reviewZone(previous) !== 'pending') fail('Only pending artworks can receive an original file. The saved decision and price are protected.');
      if (!(bytes instanceof Uint8Array)) fail('Upload a PNG or JPEG file.', 400);
      if (bytes.byteLength > MAX_IMAGE_BYTES) fail('Image exceeds the 40 MiB upload limit.', 413);
      const name = String(options.name ?? 'original').replace(/[\u0000-\u001f\u007f]/g, '').trim();
      if (!name || name === '.' || name === '..' || /[/\\:]/.test(name)) fail('Use a file name without folders or path characters.', 400);
      if (!original.length) fail('The uploaded file is empty. Choose the original PNG or JPEG.', 400);
      let metadata;
      try {
        metadata = await sharp(original, { limitInputPixels: false, failOn: 'warning' }).metadata();
      } catch {
        fail('The file is not a readable PNG or JPEG. Choose the original downloaded image.', 400);
      }
      if (!['png', 'jpeg'].includes(metadata.format)) fail('Use a PNG or JPEG file. The actual file contents must be PNG or JPEG.', 400);
      if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) || metadata.width < 1 || metadata.height < 1) fail('Invalid image dimensions.', 400);
      if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) fail('Image exceeds the 64 megapixel upload limit.', 413);
      if ((metadata.pages || 1) > 1) fail('Use a single image PNG or JPEG; animated files are not supported.', 400);
      try {
        await sharp(original, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' }).stats();
      } catch {
        fail('The PNG or JPEG cannot be fully decoded. Choose an undamaged original file.', 400);
      }
      const hash = digest(original), now = new Date().toISOString();
      const fileName = digest(id).slice(0, 16) + '-' + hash + (metadata.format === 'png' ? '.png' : '.jpg');
      const localFile = { fileName, hash, sourceUrl: source.assetUrl, name: name.slice(0, 200), bytes: original.length, width: metadata.width, height: metadata.height, at: now };
      const quality = resolutionReport(metadata);
      const unchanged = previous?.hash === hash && previous.sourceUrl === source.assetUrl;
      const next = { ...(unchanged ? previous : {}), sourceUrl: source.assetUrl, hash, quality,
        visualReview: unchanged && previous.visualReview ? previous.visualReview : { status: 'pending', note: 'AI visual scoring needs a configured model connection. Inspect the full-size image before approval.' },
        pricing: this.pricingFor(quality), status: 'awaiting_human_review', checkedAt: now,
        fileChanged: Boolean(previous && !unchanged), localFile };
      fs.mkdirSync(this.fileRoot, { recursive: true });
      const destination = path.join(this.fileRoot, fileName);
      if (fs.existsSync(destination)) this.readOriginal(localFile);
      else fs.writeFileSync(destination, original, { flag: 'wx' });
      // Verify containment and the exact saved bytes before committing a review.
      this.readOriginal(localFile);
      return this.commit(id, next);
    });
  }
  pricingFor(dimensions) {
    return suggestArtworkPrice(dimensions, {
      ...(this.pricingSamples !== undefined ? { samples: this.pricingSamples } : {}),
      ...(this.pricingNow !== undefined ? { now: typeof this.pricingNow === 'function' ? this.pricingNow() : this.pricingNow } : {}),
    });
  }
  priceLadderFor(dimensions) {
    return sizeLadder(dimensions, {
      ...(this.pricingSamples !== undefined ? { samples: this.pricingSamples } : {}),
      ...(this.pricingNow !== undefined ? { now: typeof this.pricingNow === 'function' ? this.pricingNow() : this.pricingNow } : {}),
    });
  }
  list() {
    return this.sources().map(source => {
      const record = this.records[source.id];
      return { ...source, ...(record?.sourceUrl === source.assetUrl ? { ...record, ...(record.quality ? {quality:resolutionReport(record.quality)} : {}), ...(reviewZone(record) === 'pending' ? {pricing:this.pricingFor(record.quality),priceLadder:this.priceLadderFor(record.quality)} : {}), ...(record.status === 'approved_product_prepared' && record.quality ? {currentPriceGuide:this.pricingFor(record.quality),currentPriceLadder:this.priceLadderFor(record.quality)} : {}), ...(record.product ? {product:{...record.product,blockers:[...publishingBlockers]}} : {}) } : {}),
        status: record?.sourceUrl === source.assetUrl ? record.status : 'awaiting_quality_check',
        ...(this.localFileMatches(source, record) ? { reviewImageUrl: '/api/production-review/' + encodeURIComponent(source.id) + '/file' } : {}) };
    });
  }
  async bytes(source) {
    const record = this.records[source.id];
    if (record?.sourceUrl === source.assetUrl && record.localFile?.sourceUrl === source.assetUrl) {
      if (!this.localFileMatches(source, record)) fail('Imported original integrity check failed. Its review binding is invalid.');
      return this.readOriginal(record.localFile).bytes;
    }
    if (source.assetUrl.startsWith('/assets/')) {
      const file = path.resolve(this.assetRoot, source.assetUrl.slice('/assets/'.length));
      if (!file.startsWith(this.assetRoot + path.sep)) fail('Invalid artwork path');
      const real = fs.realpathSync(file);
      if (!real.startsWith(fs.realpathSync(this.assetRoot) + path.sep)) fail('Invalid artwork path');
      if (fs.statSync(real).size > 40 * 1024 * 1024) fail('Image exceeds 40 MB');
      return fs.readFileSync(real);
    }
    validateMidjourneyResult({ assetUrl: source.assetUrl });
    const response = await this.fetchImage(source.assetUrl, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) fail('Image download failed. Import the original PNG/JPEG from your computer to measure its resolution and suggest a price.');
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 40 * 1024 * 1024) fail('Image exceeds 40 MB');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  inspect(id) { return this.locked(id,()=>this.inspectUnlocked(id)); }
  async inspectUnlocked(id) {
    const source = this.source(id);
    const bytes = await this.bytes(source);
    const hash = digest(bytes);
    const previous = this.records[id];
    if (previous?.hash === hash && previous.sourceUrl === source.assetUrl) {
      // Re-read and measure the file on every check, preserving decisions only
      // when the exact approved bytes are unchanged.
      const next = { ...previous, quality: resolutionReport(imageDimensions(bytes)), checkedAt: new Date().toISOString(), fileChanged: false };
      if (reviewZone(previous) === 'pending') next.pricing = this.pricingFor(next.quality);
      return this.commit(id, next);
    }
    const quality = resolutionReport(imageDimensions(bytes));
    const record = { sourceUrl: source.assetUrl, hash, quality,
      ...(this.localFileMatches(source, previous) ? { localFile: previous.localFile } : {}),
      visualReview: { status: 'pending', note: 'AI visual scoring needs a configured model connection. Inspect the full-size image before approval.' },
      pricing: this.pricingFor(quality),
      status: 'awaiting_human_review', checkedAt: new Date().toISOString(), fileChanged: Boolean(previous) };
    return this.commit(id, record);
  }
  decide(id, input) { return this.locked(id,()=>this.decideUnlocked(id,input)); }
  async decideUnlocked(id, input) {
    const source = this.source(id), record = structuredClone(this.records[id]);
    if (!record || record.sourceUrl !== source.assetUrl || record.hash !== input.hash) fail('Run the quality check again before approval');
    if (!['approved', 'rejected'].includes(input.decision)) fail('Choose approve or reject');
    const bytes=await this.bytes(source);
    if(digest(bytes)!==record.hash)fail('Artwork changed. Run the quality check again.');
    if (input.decision === 'rejected') {
      record.status = 'rejected'; record.product = null; record.approval = null;
      record.decisionAt=new Date().toISOString();record.workflow={stage:'rejected_archive'};
      record.archive=this.backup(id,source,bytes,'Rejected',record);
      delete record.archiveError;
      return this.commit(id,record);
    }
    const amount = Number(input.price);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) fail('Enter a valid USD price');
    const score = Number(input.visualScore);
    if (!Number.isInteger(score) || score < 1 || score > 10 || input.visualConfirmed !== true) fail('Inspect the artwork and give a visual score from 1 to 10');
    const title = String(input.title || source.title).trim().slice(0, 200);
    if (!title) fail('Product title is required');
    const price = amount.toFixed(2);
    record.pricing = this.pricingFor(imageDimensions(bytes));
    record.approval = { at: new Date().toISOString(), hash: record.hash, price, title, visualScore: score, actor: 'dashboard-owner', pricingSuggestion: structuredClone(record.pricing) };
    record.status = 'approved_product_prepared';
    record.product = { title, vendor: 'The Dark Matters', productType: 'Digital artwork', price, currency: 'USD',
      sku: 'TDM-' + digest(id).slice(0, 12).toUpperCase(), requiresShipping: false,
      descriptionHtml: `<p>${html(title)} — digital artwork from The Dark Matters.</p><p>File dimensions: ${record.quality.width} × ${record.quality.height} pixels. No physical item is included.</p>`,
      seo: { title: title.slice(0,70), description: `Discover ${title} at The Dark Matters. Digital artwork.`.slice(0,160) },
      tags: ['digital-art', 'The Dark Matters'], imageAlt: title, sourceUrl: source.assetUrl,
      publicationStatus: 'blocked_connection',
      blockers: [...publishingBlockers] };
    record.archive=this.backup(id,source,bytes,'Approved',record);
    record.workflow={stage:'shopify_pending',queuedAt:record.approval.at,backupUrl:record.archive.url,blockers:[...publishingBlockers]};
    delete record.archiveError;
    return this.commit(id,record);
  }
  async archiveDecisions() {
    const summary={archived:0,alreadyBackedUp:0,returnedToReview:0,errors:[]};
    for(const source of this.sources())await this.locked(source.id,async()=>{
      const current=this.records[source.id];
      if(!current||reviewZone(current)==='pending')return;
      try{
        const bytes=await this.bytes(source);
        if(current.sourceUrl!==source.assetUrl||digest(bytes)!==current.hash){await this.inspectUnlocked(source.id);summary.returnedToReview++;return;}
        const bucket=reviewZone(current)==='approved'?'Approved':'Rejected';
        if(current.archive?.hash===current.hash&&current.archive.bucket===bucket){this.archiveFile(bucket,current.archive.fileName);summary.alreadyBackedUp++;return;}
        const next=structuredClone(current);next.archive=this.backup(source.id,source,bytes,bucket,next);delete next.archiveError;
        next.workflow=bucket==='Approved'?{stage:'shopify_pending',queuedAt:next.approval?.at||new Date().toISOString(),backupUrl:next.archive.url,blockers:[...publishingBlockers]}:{stage:'rejected_archive'};
        this.commit(source.id,next);summary.archived++;
      }catch(error){summary.errors.push({id:source.id,title:source.title,message:error.message});}
    });
    return summary;
  }
}
