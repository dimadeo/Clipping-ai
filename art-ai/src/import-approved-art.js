import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { imageDimensions } from './production-review.js';

const root=path.resolve('assets/imports/midjourney-session-12sept');
const manifest=path.resolve('data/imported-artworks.json');
const existing=fs.existsSync(manifest)?JSON.parse(fs.readFileSync(manifest,'utf8')):[];
const seen=new Set(existing.map(item=>item.sha256));
let added=0;
for(const filename of fs.readdirSync(root).filter(name=>name.endsWith('.png')).sort()){
  const bytes=fs.readFileSync(path.join(root,filename));
  const dimensions=imageDimensions(bytes);
  const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  if(seen.has(sha256))continue;
  const stem=filename.replace(/_[0-9a-f]{8}-[0-9a-f-]{27}_(\d+)\.png$/i,(_,index)=>` — Option ${Number(index)+1}`)
    .replace(/^Fine_art_creation_/, '').replaceAll('_',' ').trim();
  existing.push({id:'import:'+sha256.slice(0,24),sha256,title:stem,originalFilename:filename,
    collection:'Midjourney · Approved · 12 September',assetUrl:'/assets/imports/midjourney-session-12sept/'+filename,
    selectionStatus:'selected_by_owner',dimensions,importedAt:new Date().toISOString()});
  seen.add(sha256);added++;
}
fs.mkdirSync(path.dirname(manifest),{recursive:true});
fs.writeFileSync(manifest+'.tmp',JSON.stringify(existing,null,2));fs.renameSync(manifest+'.tmp',manifest);
console.log(JSON.stringify({added,total:existing.length,resolutions:[...new Set(existing.map(a=>a.dimensions.width+' × '+a.dimensions.height))]}));
