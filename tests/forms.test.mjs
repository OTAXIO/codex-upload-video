import {sameCoverPixels} from '../codex-upload/scripts/forms.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {chooseActivity,popularity,compareFields,applyFields,waitUpload,submitOnce} from '../codex-upload/scripts/forms.mjs';

test('relevant free activity, measured popularity, no paid promotion',()=>{
  assert.equal(popularity('9.6亿次播放'),960000000);
  const rows=[{id:'1',name:'AI test',views:100,index:0},{id:'2',name:'科技 test',views:200,index:1},{id:'3',name:'生活',views:1e12,index:2},{id:'4',name:'AI付费',paid:true,views:1e15,index:3}];
  assert.equal(chooseActivity(rows,{strategy:'relevant_popular_free',keywords:['AI','科技']}).id,'2');
});
test('both creator declarations and all requested tags are mandatory',()=>{
  const got={tags:['AI'],declarations:{original:true,ai_generated:false,no_reprint:true},activity_tags:[]};
  const bad=compareFields(got,{tags:['AI','OpenAI'],declarations:{original:true,ai_generated:true,no_reprint:true}});
  assert.ok(bad.tags);assert.ok(bad['declarations.ai_generated']);
});
test('offline browser: two covers, duplicate collection names, tags, declarations and receipt', {skip:!process.env.CUP_BROWSER},async()=>{
  const imported=process.env.CUP_PUPPETEER_MODULE?await import(pathToFileURL(process.env.CUP_PUPPETEER_MODULE).href):await import('puppeteer-core');
  const browser=await imported.default.launch({executablePath:process.env.CUP_BROWSER,headless:true});
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'codex-upload-test-'));
  try{
    // A valid tiny PNG is sufficient: no production media or logged-in profile.
    const crc=bytes=>{let c=0xffffffff;for(const x of bytes){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
    const chunk=(name,data)=>{const body=Buffer.concat([Buffer.from(name),data]),n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(data.length);c.writeUInt32BE(crc(body));return Buffer.concat([n,body,c]);};
    const png=(w,h,color)=>{const header=Buffer.alloc(13);header.writeUInt32BE(w,0);header.writeUInt32BE(h,4);header[8]=8;header[9]=2;const rows=[];for(let y=0;y<h;y++)rows.push(Buffer.concat([Buffer.from([0]),Buffer.from(Array.from({length:w},()=>color).flat())]));return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);};
    const a=path.join(temporary,'four.png'),b=path.join(temporary,'wide.png');fs.writeFileSync(a,png(4,3,[255,0,0]));fs.writeFileSync(b,png(16,9,[0,0,255]));
    const page=await browser.newPage();let submits=0,unexpectedNetwork=0;
    await page.setRequestInterception(true);
    page.on('request',request=>{
      if(request.url()==='https://member.bilibili.com/x/vu/web/add/v3'){submits++;request.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({code:0,data:{aid:123,bvid:'BV1aaaaaaaaa'}})});}
      else if(/^(file:|data:|about:)/.test(request.url()))request.continue();
      else{unexpectedNetwork++;request.abort();}
    });
    await page.goto(pathToFileURL(fileURLToPath(new URL('./fixtures/form.html',import.meta.url))).href);
    const wanted={title:'Offline title',description:'First line\nSecond line',declarations:{original:true,ai_generated:true,no_reprint:true},partition:'科技数码',tags:['AI','OpenAI'],activity:{strategy:'relevant_popular_free',keywords:['AI','科技']},collection:{name:'News',id:12,required:true},visibility:'public',covers:{four_three:{path:a,sha256:'test-a'},sixteen_nine:{path:b,sha256:'test-b'}}};
    await page.$eval('.setting',e=>e.style.display='none');
    // Reproduce production: the platform auto-opened the cover editor before metadata.
    await page.evaluate(()=>{
      showCover();
      const open=showCover;window.showCover=()=>setTimeout(open,800);
      window.collectionClicks=0;
      document.querySelectorAll('.season-item').forEach(e=>e.addEventListener('click',()=>window.collectionClicks++));
      // Classification updates late after saving covers. Repair only partition.
      const done=[...document.querySelectorAll('#cover-dialog button')].find(e=>e.innerText==='完成');
      done.addEventListener('click',()=>{if(!window.lostPartition){window.lostPartition=true;document.querySelector('.select-item-cont').textContent='知识';}});
    });
    const fields=await applyFields(page,wanted,[{id:11,name:'News',episodes:1},{id:12,name:'News',episodes:0},{id:13,name:'Other',episodes:3}]);
    assert.equal(fields.collection.id,12);assert.equal(await page.evaluate(()=>window.chosenCollectionIndex),1);
    assert.equal(fields.activity.name,'科技猎手');assert.equal(fields.readback.declarations.ai_generated,true);assert.equal(fields.readback.declarations.no_reprint,true);
    assert.equal(fields.covers.four_three.persisted,true);assert.equal(fields.covers.sixteen_nine.persisted,true);
    assert.equal(await page.evaluate(()=>window.collectionClicks),1,'late partition repair must not replay collection');
    // Unknown dialogs still block; no blind confirmation of arbitrary popups.
    await page.evaluate(()=>{const d=document.createElement('div');d.className='bcc-dialog';d.id='unknown';d.innerText='请支付推广费用';document.body.append(d)});
    await assert.rejects(applyFields(page,{title:'must stop'},[]),e=>e.code==='UNKNOWN_DIALOG');
    await page.$eval('#unknown',e=>e.remove());
    const repeat=await applyFields(page,{collection:wanted.collection},[{id:11,name:'News',episodes:1},{id:12,name:'News',episodes:0},{id:13,name:'Other',episodes:3}]);
    assert.equal(repeat.collection.id,12);assert.equal(await page.evaluate(()=>window.chosenCollectionIndex),1);
    await waitUpload(page,1000);
    const progress=path.join(temporary,'progress.json');const receipt=await submitOnce(page,{mode:'publish',progress});
    assert.equal(receipt.aid,123);assert.equal(submits,1);assert.equal(unexpectedNetwork,0);assert.equal(JSON.parse(fs.readFileSync(progress)).submit_started,true);
    await assert.rejects(submitOnce(page,{mode:'publish',progress}),e=>e.code==='RECONCILE_REQUIRED');assert.equal(submits,1);
    const edited=await applyFields(page,{title:'Edited offline title'},[]);
    assert.equal(edited.readback.title,'Edited offline title');assert.deepEqual(edited.readback.tags,fields.readback.tags);assert.deepEqual(edited.readback.declarations,fields.readback.declarations);
    await page.$eval('.creation-statement-container .bcc-select',e=>e.classList.add('disabled'));
    await assert.rejects(applyFields(page,{declarations:{original:true,ai_generated:false,no_reprint:true}},[]),e=>e.code==='DECLARATION_IMMUTABLE');
    const fixed={strategy:'explicit',id:1325166,name:'明日方舟终末地创作者应援计划'};
    const switched=await applyFields(page,{activity:fixed},[]);
    assert.deepEqual(switched.readback.activity_tags,[fixed.name]);assert.ok(!switched.readback.tags.includes('科技猎手'));
    const again=await applyFields(page,{activity:fixed},[]);assert.deepEqual(again.readback.activity_tags,[fixed.name]);
    await assert.rejects(applyFields(page,{activity:{strategy:'explicit',id:999999,name:'未识别的普通标签'}},[]),e=>e.code==='ACTIVITY_NOT_AVAILABLE');
    assert.equal(submits,1,'unrecognized activity must never submit or silently substitute another activity');

  }finally{await browser.close();if(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep+'codex-upload-test-'))fs.rmSync(temporary,{recursive:true,force:true});}
});

test('cover readback compares pixels and rejects changed aspect/content',()=>{
 const a={pixels:[255,255,255,255,0,0,0,255],width:2,height:1};
 assert.ok(sameCoverPixels(a,{...a,pixels:[252,253,254,255,1,1,1,255]}));
 assert.equal(sameCoverPixels(a,{...a,pixels:[0,0,255,255,255,0,0,255]}),false);
 assert.equal(sameCoverPixels(a,{...a,width:1,height:2}),false);
});

test('explicit activity requires exact ID and name and never popularity fallback',()=>{
 const row={id:1325166,name:'明日方舟终末地创作者应援计划',views:1,index:0};
 assert.equal(chooseActivity([row,{id:3447,name:'科技猎手',views:1e12,index:1}],{strategy:'explicit',id:1325166,name:row.name}).id,1325166);
 assert.throws(()=>chooseActivity([row],{strategy:'explicit',id:1325166,name:'错误名称'}),e=>e.code==='ACTIVITY_NOT_AVAILABLE');
 assert.throws(()=>chooseActivity([{...row,disabled:true}],{strategy:'explicit',id:1325166,name:row.name}),e=>e.code==='ACTIVITY_NOT_AVAILABLE');
});
