import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {CoverEditor,covers,assertCoversVerified,sameCoverPixels} from '../codex-upload/scripts/cover_editor.mjs';
import {dismissKnown,submitOnce} from '../codex-upload/scripts/forms.mjs';

const browserTest={skip:!process.env.CUP_BROWSER};let browser,tmp;
before(async()=>{
  if(!process.env.CUP_BROWSER)return;
  const {default:puppeteer}=await import(process.env.CUP_PUPPETEER_MODULE?pathToFileURL(process.env.CUP_PUPPETEER_MODULE).href:'puppeteer-core');
  tmp=fs.mkdtempSync(path.join(os.tmpdir(),'codex-cover-regression-'));
  browser=await puppeteer.launch({executablePath:process.env.CUP_BROWSER,headless:true,defaultViewport:{width:1200,height:1000},userDataDir:path.join(tmp,'isolated-profile'),args:['--disable-background-networking','--no-first-run']});
});
after(async()=>{if(browser)await browser.close();if(tmp)fs.rmSync(tmp,{recursive:true,force:true});});
async function fixture(options={},run){
  const page=await browser.newPage();const network=[];
  await page.setRequestInterception(true);page.on('request',r=>{if(/^(?:data:|about:|file:)/.test(r.url()))r.continue();else{network.push(r.url());r.abort();}});
  try{
    await page.setContent('<!doctype html><meta charset="utf-8"><title>Isolated native cover contract</title>');
    await page.addScriptTag({path:fileURLToPath(new URL('./fixtures/native-cover.js',import.meta.url))});await page.evaluate(o=>installCoverFixture(o),options);
    const wanted={};
    for(const [slot,w,h,offset]of [['four_three',800,600,40],['sixteen_nine',960,540,140]]){
      const data=await page.evaluate(({w,h,offset})=>{const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,w,h);x.fillStyle='#01a1fe';x.fillRect(offset,20,w*.12,h*.45);x.fillStyle='#111';x.font='bold 45px sans-serif';x.fillText('Native cover '+w,40,h*.7);return c.toDataURL('image/png').split(',')[1];},{w,h,offset});
      const file=path.join(tmp,slot+'.png'),bytes=Buffer.from(data,'base64');fs.writeFileSync(file,bytes);wanted[slot]={path:file,sha256:createHash('sha256').update(bytes).digest('hex')};
      if(options.fineArtwork){
        const dense=await page.evaluate(({w,h})=>{const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,w,h);x.fillStyle='#111';for(let y=15;y<h-15;y+=3)x.fillRect(15,y,w-30,1);return c.toDataURL('image/png').split(',')[1];},{w,h});
        const replacement=Buffer.from(dense,'base64');fs.writeFileSync(file,replacement);wanted[slot].sha256=createHash('sha256').update(replacement).digest('hex');
      }
    }
    await run(page,wanted);assert.deepEqual(network,[],'all external requests are blocked; no platform traffic is permitted');
  }finally{await page.close();}
}
test('native contract: inert labels, trusted crop centre, hidden decoys, offset crop and independent persisted covers',browserTest,async()=>{
  await fixture({autoOpen:true,cropX:30,syncChecked:true},async(page,wanted)=>{
    await dismissKnown(page);assert.equal(await page.evaluate(()=>coverFixture.close),1);
    const result=await covers(page,wanted);await assertCoversVerified(page,wanted);
    assert.equal(result.four_three.crop.x,30);assert.equal(result.four_three.persisted,true);assert.equal(result.sixteen_nine.persisted,true);
    assert.deepEqual(await page.evaluate(()=>coverFixture.uploads),['four_three','sixteen_nine']);
    assert.equal(await page.evaluate(()=>coverFixture.sync),0);
    assert.equal(await page.$$eval('.sync-checkbox input',es=>es.some(e=>e.checked)),false);
  });
});
for(const slot of ['four_three','sixteen_nine'])test('manual sync warning identifies either missing ratio: '+slot,browserTest,async()=>{
  await fixture({syncWarning:slot,loadDelay:180,saveDelay:180},async(page,wanted)=>{
    await covers(page,wanted);assert.equal(await page.evaluate(()=>coverFixture.manual),1);assert.equal(await page.evaluate(()=>coverFixture.sync),0);
    assert.deepEqual(await page.evaluate(()=>coverFixture.uploads),['four_three','sixteen_nine','four_three','sixteen_nine']);await assertCoversVerified(page,wanted);
  });
});
test('manual choice may save and close directly without editing a detached dialog',browserTest,async()=>{
  await fixture({syncWarning:'sixteen_nine',manualSaves:true},async(page,wanted)=>{await covers(page,wanted);await assertCoversVerified(page,wanted);assert.equal(await page.evaluate(()=>coverFixture.manual),1);});
});
test('delayed editor, image decode and save are awaited before readback',browserTest,async()=>{
  await fixture({openDelay:350,loadDelay:350,saveDelay:350},async(page,wanted)=>{await covers(page,wanted);assert.equal(await page.evaluate(()=>coverFixture.saves),1);});
});
test('visible native shell waits for lazy ratio canvases, including reopen',browserTest,async()=>{
  await fixture({mountDelay:450},async(page,wanted)=>{await covers(page,wanted);await assertCoversVerified(page,wanted);assert.equal(await page.evaluate(()=>coverFixture.saves),1);});
});
test('fine cover artwork compares through the native raster sampling path',browserTest,async()=>{
  await fixture({fineArtwork:true},async(page,wanted)=>{await covers(page,wanted);await assertCoversVerified(page,wanted);});
});
for(const [name,options,code]of [
  ['two active upload inputs',{duplicateInput:true},'COVER_INPUT_MISSING'],
  ['native shell never mounts',{mountDelay:450,neverMount:true},'COVER_DIALOG_MISSING'],
  ['ratio activation ignored',{blockActivation:true},'COVER_INPUT_MISSING'],
  ['unrecognized native structure',{autoOpen:true,unknownContract:true},'UNKNOWN_DIALOG'],
  ['ambiguous native ratio editors',{autoOpen:true,duplicateEditor:true},'UNKNOWN_DIALOG'],
  ['source image never reached canvas',{ignoreLoad:true},'COVER_NOT_LOADED'],
  ['saved content corrupt on reopening',{corruptReadback:true},'COVER_READBACK_FAILED'],
  ['same warning recurs without progress',{syncWarning:'sixteen_nine',repeatWarning:true},'COVER_SAVE_FAILED'],
  ['unknown modal during save',{unknownModal:true},'UNKNOWN_DIALOG']
])test('submission blocked: '+name,browserTest,async()=>{
  await fixture(options,async(page,wanted)=>{
    await assert.rejects(new CoverEditor(page,wanted,{timeout:1500,poll:60}).run(),e=>e.code===code&&Array.isArray(e.details.cover_trace));
    await assert.rejects(assertCoversVerified(page,wanted),e=>e.code==='COVER_VERIFICATION_REQUIRED');
    assert.equal(await page.evaluate(()=>coverFixture.sync),0);
  });
});
test('final submission refuses unverified, mismatched and navigated document proofs',browserTest,async()=>{
  await fixture({},async(page,wanted)=>{
    await assert.rejects(submitOnce(page,{mode:'publish',meta:{covers:wanted}}),e=>e.code==='COVER_VERIFICATION_REQUIRED');
    await covers(page,wanted);
    await assert.rejects(assertCoversVerified(page,{...wanted,four_three:{...wanted.four_three,sha256:'changed'}}),e=>e.code==='COVER_VERIFICATION_REQUIRED');
    await page.reload();await assert.rejects(assertCoversVerified(page,wanted),e=>e.code==='COVER_VERIFICATION_REQUIRED');
  });
});
test('mostly white covers cannot conceal a wrong small title block',()=>{
  const pixels=new Array(128*128*4).fill(255),other=[...pixels];
  for(let y=20;y<28;y++)for(let x=20;x<28;x++)for(let k=0;k<3;k++)other[(y*128+x)*4+k]=0;
  const a={pixels,width:315,height:236};assert.equal(sameCoverPixels(a,{...a,pixels:other}),false);
  assert.ok(sameCoverPixels(a,{...a,pixels:[...pixels]}));
});
