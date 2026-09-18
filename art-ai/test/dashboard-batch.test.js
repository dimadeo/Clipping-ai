import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboard } from '../src/dashboard.js';
import { canvasScript } from '../src/canvas-studio.js';
import { batchStudioScript } from '../src/batch-studio.js';
import { fluxScript } from '../src/flux-panel.js';
import { reviewScript } from '../src/review-panel.js';

test('served batch detection recognises CSV and numbered headings without escaped-regex regression', () => {
  const start=dashboard.indexOf('const batchInput=');
  const end=dashboard.indexOf(';fineAgentForm',start);
  const detect=new Function('data',dashboard.slice(start,end)+';return batchInput;');
  assert.equal(detect({subject:'prompt_id,batch_id,title\nB001-P01,B001,Test'}),true);
  assert.equal(detect({subject:'01 — First\nAn image 4:5.\n02 — Second\nAnother 1:1.'}),true);
  assert.equal(detect({subject:'**01 - First**\nImage\n**02 - Second**\nImage'}),true);
  assert.equal(detect({subject:'1. Accept all prompts\n2. Keep them separate'}),false);
  assert.equal(detect({subject:'A single seascape. Ratio 7:5.'}),false);
});

test('all delivered dashboard scripts remain syntactically valid',()=>{
  for(const html of [dashboard,canvasScript,batchStudioScript,fluxScript,reviewScript]){
    for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Function(match[1]));
  }
});
