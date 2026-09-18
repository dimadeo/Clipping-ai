import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { MAX_PICTURE_BYTES, PictureInputs } from '../src/picture-inputs.js';

async function storeFor(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aura-picture-inputs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return new PictureInputs({ root });
}

function fixture(width = 160, height = 100, format = 'png') {
  return sharp({ create: { width, height, channels: 4, background: { r: 41, g: 108, b: 171, alpha: 0.5 } } })
    .toFormat(format).toBuffer();
}

test('pictures persist as UUID-named normalized images and safe public records', async t => {
  const store = await storeFor(t);
  const source = await fixture();
  const record = await store.add(source, { name: ' C:\\private\\..\\portraits\\ First picture.png \n', contentType: 'image/png' });
  assert.match(record.id, /^[0-9a-f-]{36}$/);
  assert.equal(record.name, 'First picture.png');
  assert.equal(record.width, 160);
  assert.equal(record.height, 100);
  assert.equal(record.bytes, source.length);
  assert.equal(record.previewUrl, `/api/creative/pictures/${record.id}/image`);
  assert.deepEqual(Object.keys(record).sort(), ['bytes', 'createdAt', 'height', 'id', 'name', 'previewUrl', 'width']);
  assert.ok(Number.isFinite(Date.parse(record.createdAt)));
  assert.deepEqual((await readdir(store.root)).sort(), [`${record.id}.jpg`, `${record.id}.json`]);
  assert.deepEqual(store.get(record.id), record);
  assert.deepEqual(new PictureInputs({ root: store.root }).list(), [record]);
  const image = await store.image(record.id);
  assert.equal(image.contentType, 'image/jpeg');
  assert.equal((await sharp(image.bytes).metadata()).format, 'jpeg');
  assert.notDeepEqual(image.bytes, source);
  assert.deepEqual(await readFile(path.join(store.root, `${record.id}.jpg`)), image.bytes);
});

test('normalization applies EXIF rotation and removes embedded metadata and trailing bytes', async t => {
  const store = await storeFor(t);
  const jpeg = await sharp(await fixture(160, 100)).jpeg().withMetadata({ orientation: 6 })
    .withExifMerge({ IFD0: { Artist: 'PRIVATE TEST METADATA' } }).toBuffer();
  const source = Buffer.concat([jpeg, Buffer.from('<script>private trailing text</script>')]);
  const record = await store.add(source, { name: 'photo.jpg', contentType: 'image/jpeg' });
  assert.equal(record.width, 100);
  assert.equal(record.height, 160);
  const preview = await store.image(record.id);
  const metadata = await sharp(preview.bytes).metadata();
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.equal(preview.bytes.includes(Buffer.from('PRIVATE TEST METADATA')), false);
  assert.equal(preview.bytes.includes(Buffer.from('<script>')), false);
  const provider = await sharp(Buffer.from(await store.providerImage(record.id), 'base64')).metadata();
  assert.equal(provider.width, 100);
  assert.equal(provider.height, 160);
});

test('provider JPEGs preserve aspect ratio while staying within 2048 per side and 4 MP', async t => {
  const store = await storeFor(t);
  for (const [width, height] of [[4000, 4000], [4000, 2000], [2000, 4000], [64, 64]]) {
    const record = await store.add(await fixture(width, height), { name: 'art.png', contentType: 'image/png' });
    const encoded = await store.providerImage(record.id);
    assert.equal(encoded.startsWith('data:'), false);
    const metadata = await sharp(Buffer.from(encoded, 'base64')).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.ok(metadata.width <= 2048 && metadata.height <= 2048);
    assert.ok(metadata.width * metadata.height <= 4_000_000);
    assert.ok(metadata.width <= width && metadata.height <= height);
    assert.equal(metadata.width / metadata.height, width / height);
  }
});

test('empty, disguised, unsupported and truncated images are rejected before persistence', async t => {
  const store = await storeFor(t);
  const png = await fixture();
  const webp = await fixture(160, 100, 'webp');
  for (const [bytes, contentType] of [
    [Buffer.alloc(0), 'image/png'], [Buffer.from('<svg></svg>'), 'image/png'],
    [webp, 'image/png'], [png, 'image/jpeg'], [png, 'text/html'],
    [png.subarray(0, 40), 'image/png'], [png.subarray(0, png.length - 25), 'image/png']
  ]) {
    await assert.rejects(store.add(bytes, { contentType }), { statusCode: 400 });
  }
  await assert.rejects(store.add('C:\\private\\file.png', { contentType: 'image/png' }), { statusCode: 400 });
  assert.deepEqual(store.list(), []);
  assert.deepEqual(await readdir(store.root), []);
});

test('byte, minimum dimension and decoded pixel limits reject excessive input', async t => {
  const store = await storeFor(t);
  await assert.rejects(store.add(Buffer.alloc(MAX_PICTURE_BYTES + 1), { contentType: 'image/png' }),
    error => error.statusCode === 413 && /10 MiB/.test(error.message));
  for (const [width, height] of [[63, 100], [100, 63]]) {
    await assert.rejects(store.add(await fixture(width, height)),
      error => error.statusCode === 400 && /64 pixels/.test(error.message));
  }
  await assert.rejects(store.add(await fixture(5000, 4001)),
    error => error.statusCode === 413 && /20 million/.test(error.message));
  assert.deepEqual(store.list(), []);
});

test('IDs cannot select arbitrary paths and missing or damaged records are unavailable', async t => {
  const store = await storeFor(t);
  for (const id of ['../../outside', 'photo.jpg', '', null, {}, randomUUID() + '/../../outside']) {
    assert.throws(() => store.get(id), { statusCode: 400 });
    await assert.rejects(store.image(id), { statusCode: 400 });
    await assert.rejects(store.providerImage(id), { statusCode: 400 });
  }
  const missing = randomUUID();
  assert.throws(() => store.get(missing), { statusCode: 404 });
  await assert.rejects(store.image(missing), { statusCode: 404 });
  await assert.rejects(store.providerImage(missing), { statusCode: 404 });
  await writeFile(path.join(store.root, `${missing}.json`), '{incomplete');
  assert.throws(() => store.get(missing), { statusCode: 404 });
  assert.deepEqual(store.list(), []);
});

test('simultaneous uploads remain independent and unknown persisted properties stay private', async t => {
  const store = await storeFor(t);
  const source = await fixture();
  const records = await Promise.all(['one', 'two', 'three'].map(name => store.add(source, { name })));
  assert.equal(new Set(records.map(record => record.id)).size, 3);
  assert.equal(store.list().length, 3);
  const record = records[0];
  await writeFile(path.join(store.root, `${record.id}.json`), JSON.stringify({ ...record,
    previewUrl: 'https://untrusted.invalid/', privatePath: '../outside', token: 'private-test-value' }));
  assert.deepEqual(store.get(record.id), record);
  record.name = 'local mutation';
  assert.equal(store.get(record.id).name, 'one');
});
