import fs from 'node:fs';
import path from 'node:path';

const guideFiles = ['START HERE.md','Dashboard Instructions.md','Pipeline and Connections.md','Agent Directory.md','Pricing Guide.md','Glossary.md','Creative Brief Vocabulary.md','Pipeline Glass Design.md'];
export function readUserGuide() {
  return guideFiles.map(name => ({ name, content: fs.readFileSync(path.resolve('User Guide',name),'utf8') }));
}

export const guideScript = String.raw`<script>
(() => {
const host=document.querySelector('#user-guide');if(!host)return;
const make=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
const title=make('h1','User Guide');const intro=make('p','FLUX is the image-generation model from Black Forest Labs. In this studio, it turns an approved creative brief into images that return for your review.');
const label=make('label','Choose a guide');const select=make('select');select.id='guide-file';label.htmlFor=select.id;
const article=make('article');article.className='guide-document';const status=make('p','Loading your guide files…');status.setAttribute('role','status');
host.append(title,intro,label,select,status,article);
let files=[];
function inline(element,text){
  const parts=text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  for(const part of parts){if(part.startsWith('**')&&part.endsWith('**'))element.append(make('strong',part.slice(2,-2)));
    else {const match=part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);if(match){const target=files.find(f=>f.name===match[2]);if(target){const a=make('button',match[1]);a.type='button';a.className='guide-link';a.onclick=()=>{select.value=target.name;render(target.content);article.scrollIntoView({block:'start'});};element.append(a);}else if(/^https?:\/\//.test(match[2])){const a=make('a',match[1]);a.href=match[2];a.target='_blank';a.rel='noopener';element.append(a);}else element.append(document.createTextNode(match[1]));}else element.append(document.createTextNode(part));}}
}
function render(content){article.replaceChildren();let list=null,table=null;
for(const line of content.split(/\r?\n/)){if(!line.trim()){list=null;table=null;continue;}
if(line.startsWith('|')){if(/^\|[\s:|-]+\|$/.test(line))continue;if(!table){const wrap=make('div');wrap.className='guide-table';table=make('table');wrap.append(table);article.append(wrap);}const row=make('tr'),first=!table.rows.length;for(const cell of line.slice(1,-1).split('|')){const c=make(first?'th':'td');inline(c,cell.trim());row.append(c);}table.append(row);continue;}table=null;
const heading=line.match(/^(#{1,3})\s+(.*)/);if(heading){const h=make('h'+Math.min(heading[1].length+1,4));inline(h,heading[2]);article.append(h);list=null;continue;}
const item=line.match(/^(?:- |\d+\. )(.*)/);if(item){if(!list){list=make(/^\d/.test(line)?'ol':'ul');article.append(list);}const li=make('li');inline(li,item[1]);list.append(li);continue;}list=null;
const p=make(line.startsWith('> ')?'blockquote':'p');inline(p,line.replace(/^> /,''));article.append(p);
}}
select.onchange=()=>{const f=files.find(f=>f.name===select.value);if(f)render(f.content);};
fetch('/api/user-guide').then(r=>{if(!r.ok)throw Error('Could not load User Guide');return r.json();}).then(data=>{files=data.documents;for(const file of files){const option=make('option',file.name.replace('.md',''));option.value=file.name;select.append(option);}status.textContent='Read directly from your User Guide folder.';if(files.length)render(files[0].content);}).catch(e=>{status.textContent=e.message;});
})();
</script>`;
