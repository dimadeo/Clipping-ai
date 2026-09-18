import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 20_000_000;
const MAX_PROVIDER_PIXELS = 4_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const decoderOptions = { failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS };
const pictureError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

function pictureId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw pictureError('Choose a valid uploaded picture.');
  return id.toLowerCase();
}

function displayName(name) {
  // Windows and POSIX separators are handled identically on either host.
  return path.posix.basename(String(name || 'Picture').replaceAll('\\', '/'))
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim().slice(0, 180) || 'Picture';
}

function publicRecord(record) {
  return {
    id: record.id, name: record.name, width: record.width, height: record.height,
    bytes: record.bytes, previewUrl: `/api/creative/pictures/${record.id}/image`, createdAt: record.createdAt
  };
}

/** Private, persistent reference pictures. Only normalized JPEGs leave this store. */
export class PictureInputs {
  constructor({ root = path.resolve('data/picture-inputs') } = {}) {
    this.root = path.resolve(root);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }

  list() {
    const records = [];
    for (const name of readdirSync(this.root)) {
      if (!name.endsWith('.json') || !UUID.test(name.slice(0, -5))) continue;
      try { records.push(this.get(name.slice(0, -5))); }
      catch (error) { if (error.statusCode !== 404) throw error; }
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }

  get(id) {
    id = pictureId(id);
    let record;
    try { record = JSON.parse(readFileSync(path.join(this.root, `${id}.json`), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) throw pictureError('This uploaded picture is no longer available. Upload it again.', 404);
      throw error;
    }
    // Rebuild public data from validated fields; metadata never selects a path.
    if (!record || record.id !== id || typeof record.name !== 'string'
      || !Number.isInteger(record.width) || record.width < 64
      || !Number.isInteger(record.height) || record.height < 64
      || record.width * record.height > MAX_INPUT_PIXELS
      || !Number.isInteger(record.bytes) || record.bytes < 1 || record.bytes > MAX_PICTURE_BYTES
      || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))
      || !existsSync(path.join(this.root, `${id}.jpg`))) {
      throw pictureError('This uploaded picture is no longer available. Upload it again.', 404);
    }
    return publicRecord({ ...record, name: displayName(record.name) });
  }

  async add(bytes, { name, contentType } = {}) {
    if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw pictureError('Upload a JPEG or PNG picture.');
    if (bytes.byteLength > MAX_PICTURE_BYTES) throw pictureError('Pictures must be no larger than 10 MiB.', 413);
    if (!bytes.byteLength) throw pictureError('This picture is empty. Upload a JPEG or PNG picture.');
    bytes = Buffer.from(bytes);
    const claimedType = String(contentType || '').split(';')[0].trim().toLowerCase();
    const signatureType = bytes.subarray(0, 8).equals(PNG_SIGNATURE) ? 'image/png'
      : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg' : null;
    if (!signatureType || (claimedType && claimedType !== signatureType)) {
      throw pictureError('Upload a valid JPEG or PNG picture with the matching file type.');
    }

    let normalized;
    try {
      const metadata = await sharp(bytes, decoderOptions).metadata();
      if (!['jpeg', 'png'].includes(metadata.format) || (metadata.pages || 1) !== 1) {
        throw pictureError('Upload a single JPEG or PNG picture.');
      }
      if (!metadata.width || !metadata.height || metadata.width < 64 || metadata.height < 64) {
        throw pictureError('Pictures must be at least 64 pixels wide and 64 pixels high.');
      }
      if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
        throw pictureError('Pictures must contain no more than 20 million pixels.', 413);
      }
      // Metadata alone does not decode pixels. Re-encoding validates the complete
      // image, applies orientation, strips metadata and discards trailing content.
      normalized = await sharp(bytes, decoderOptions).autoOrient()
        .flatten({ background: '#ffffff' }).toColourspace('srgb')
        .jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer({ resolveWithObject: true });
    } catch (error) {
      if (error.statusCode) throw error;
      if (/pixel limit/i.test(error.message)) throw pictureError('Pictures must contain no more than 20 million pixels.', 413);
      throw pictureError('This picture could not be decoded. Upload a complete, valid JPEG or PNG file.');
    }

    const id = randomUUID();
    const record = publicRecord({ id, name: displayName(name), width: normalized.info.width,
      height: normalized.info.height, bytes: bytes.byteLength, createdAt: new Date().toISOString() });
    const imagePath = path.join(this.root, `${id}.jpg`);
    const metadataPath = path.join(this.root, `${id}.json`);
    const pendingPath = path.join(this.root, `${id}.json.tmp`);
    try {
      await writeFile(imagePath, normalized.data, { flag: 'wx', mode: 0o600 });
      await writeFile(pendingPath, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
      // Publish metadata only when both files are complete, so list/get never
      // expose a partially written upload, including during simultaneous adds.
      await rename(pendingPath, metadataPath);
    } catch (error) {
      await Promise.allSettled([unlink(imagePath), unlink(pendingPath)]);
      throw error;
    }
    return record;
  }

  async image(id) {
    const record = this.get(id);
    try {
      return { bytes: await readFile(path.join(this.root, `${record.id}.jpg`)), contentType: 'image/jpeg' };
    } catch (error) {
      if (error.code === 'ENOENT') throw pictureError('This uploaded picture is no longer available. Upload it again.', 404);
      throw error;
    }
  }

  async providerImage(id) {
    const record = this.get(id);
    const { bytes } = await this.image(record.id);
    const scale = Math.min(1, 2048 / record.width, 2048 / record.height,
      Math.sqrt(MAX_PROVIDER_PIXELS / (record.width * record.height)));
    const jpeg = await sharp(bytes, decoderOptions).autoOrient().resize({
      width: Math.max(1, Math.floor(record.width * scale)),
      height: Math.max(1, Math.floor(record.height * scale)), fit: 'inside', withoutEnlargement: true
    }).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
    return jpeg.toString('base64');
  }
}
