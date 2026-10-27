import {S,sameCoverPixels,uploadEntryUrl} from '../codex-upload/scripts/forms.mjs';
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
test('explicit activity uses the verified official campaign upload entry',()=>{
  const p={strategy:'explicit',id:1325166,name:'明日方舟终末地创作者应援计划'};
  const u=new URL(uploadEntryUrl(p));assert.equal(u.origin,'https://member.bilibili.com');
  assert.equal(u.searchParams.get('topic_id'),'1325166');assert.equal(u.searchParams.get('topic_name'),p.name);assert.equal(u.searchParams.get('from'),'activity');
  assert.equal(new URL(uploadEntryUrl({strategy:'none'})).search,'');
});
test('both creator declarations and all requested tags are mandatory',()=>{
  const got={tags:['AI'],declarations:{original:true,ai_generated:false,no_reprint:true},activity_tags:[]};
  const bad=compareFields(got,{tags:['AI','OpenAI'],declarations:{original:true,ai_generated:true,no_reprint:true}});
  assert.ok(bad.tags);assert.ok(bad['declarations.ai_generated']);
});
test('offline browser: two covers, duplicate collection names, tags, declarations and receipt', {skip:!process.env.CUP_BROWSER},async()=>{
  const imported=process.env.CUP_PUPPETEER_MODULE?await import(pathToFileURL(process.env.CUP_PUPPETEER_MODULE).href):await import('puppeteer-core');
  const browser=await imported.default.launch({executablePath:process.env.CUP_BROWSER,headless:true,defaultViewport:{width:1440,height:1050}});
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
    // Reproduce delayed platform tag commits and stale input content.
    await page.evaluate(()=>{
      const input=document.querySelector('.tag-input-wrp input');
      input.value='stale';
      input.onkeydown=e=>{
        if(e.key==='Backspace'&&!input.value){document.querySelector('.chips .label-item-v2-container:last-child')?.remove();}
        if(e.key==='Enter'){
        e.preventDefault();const value=e.target.value;
        setTimeout(()=>{addTag(value,value==='明日方舟终末地创作者应援计划');setTimeout(()=>{input.value='';},150);},650);
      }};
    });
    const wanted={title:'Offline title',description:'First line\nSecond line',declarations:{original:true,ai_generated:true,no_reprint:true},partition:'科技数码',tags:['AI','OpenAI'],activity:{strategy:'relevant_popular_free',keywords:['AI','科技']},collection:{name:'News',id:12,required:true},visibility:'public',covers:{four_three:{path:a,sha256:'test-a'},sixteen_nine:{path:b,sha256:'test-b'}}};
    await page.$eval('.setting',e=>e.style.display='none');
    await page.addScriptTag({path:fileURLToPath(new URL('./fixtures/native-cover.js',import.meta.url))});
    await page.evaluate(()=>{
      installCoverFixture({autoOpen:true,openDelay:800,syncWarning:'sixteen_nine'});
      window.collectionClicks=0;
      document.querySelectorAll('.season-item').forEach(e=>e.addEventListener('click',()=>window.collectionClicks++));
      document.querySelector('#cover-dialog .done').addEventListener('click',()=>{if(!window.lostPartition){window.lostPartition=true;document.querySelector('.select-item-cont').textContent='知识';}});
    });
    const fields=await applyFields(page,wanted,[{id:11,name:'News',episodes:1},{id:12,name:'News',episodes:0},{id:13,name:'Other',episodes:3}]);
    assert.equal(fields.collection.id,12);assert.equal(await page.evaluate(()=>window.chosenCollectionIndex),1);
    assert.equal(fields.activity.name,'科技猎手');assert.equal(fields.readback.declarations.ai_generated,true);assert.equal(fields.readback.declarations.no_reprint,true);
    assert.deepEqual(await page.evaluate(()=>window.coverFixture.uploads.slice(0,2)),['four_three','sixteen_nine']);assert.equal(await page.evaluate(()=>window.coverFixture.manual>0),true);
    assert.equal(fields.covers.four_three.persisted,true);assert.equal(fields.covers.sixteen_nine.persisted,true);
    assert.equal(await page.evaluate(()=>window.collectionClicks),1,'late partition repair must not replay collection');
    // Unknown dialogs still block; no blind confirmation of arbitrary popups.
    await page.evaluate(()=>{const d=document.createElement('div');d.className='bcc-dialog';d.id='unknown';d.innerText='请支付推广费用';document.body.append(d)});
    await assert.rejects(applyFields(page,{title:'must stop'},[]),e=>e.code==='UNKNOWN_DIALOG');
    await page.$eval('#unknown',e=>e.remove());
    const repeat=await applyFields(page,{collection:wanted.collection},[{id:11,name:'News',episodes:1},{id:12,name:'News',episodes:0},{id:13,name:'Other',episodes:3}]);
    assert.equal(repeat.collection.id,12);assert.equal(await page.evaluate(()=>window.chosenCollectionIndex),1);
    await waitUpload(page,1000);
    const progress=path.join(temporary,'progress.json');const receipt=await submitOnce(page,{mode:'publish',progress,meta:{covers:wanted.covers}});
    assert.equal(receipt.aid,123);assert.equal(submits,1);assert.equal(unexpectedNetwork,0);assert.equal(JSON.parse(fs.readFileSync(progress)).submit_started,true);
    await assert.rejects(submitOnce(page,{mode:'publish',progress,meta:{covers:wanted.covers}}),e=>e.code==='RECONCILE_REQUIRED');assert.equal(submits,1);
    const edited=await applyFields(page,{title:'Edited offline title'},[]);
    assert.equal(edited.readback.title,'Edited offline title');assert.deepEqual(edited.readback.tags,fields.readback.tags);assert.deepEqual(edited.readback.declarations,fields.readback.declarations);
    await page.$eval('.creation-statement-container .bcc-select',e=>e.classList.add('disabled'));
    await assert.rejects(applyFields(page,{declarations:{original:true,ai_generated:false,no_reprint:true}},[]),e=>e.code==='DECLARATION_IMMUTABLE');
    const fixed={strategy:'explicit',id:1325166,name:'明日方舟终末地创作者应援计划'};
    await page.evaluate(()=>{
      const more=document.createElement('button');more.textContent='搜索更多话题';document.body.append(more);
      const dialog=document.createElement('div');dialog.style.display='none';dialog.innerHTML='<input class="bcc-search-input"><div class="dialog-item"><span class="check-radio-v2-container" style="display:inline-block;width:24px;height:24px;border:1px solid"></span><span class="topic-tag-name">明日方舟终末地创作者应援计划</span><svg class="topic-activity-icon"></svg></div><button class="submit-add">确定</button>';
      document.body.append(dialog);more.onclick=()=>dialog.style.display='block';
      const input=dialog.querySelector('input');input.oninput=()=>dialog.querySelector('.dialog-item').style.display=input.value.includes('明日方舟终末地创作者应援计划')?'block':'none';
      dialog.querySelector('.check-radio-v2-container').onclick=()=>window.activitySelected=true;
      dialog.querySelector('button').onclick=()=>{if(window.activitySelected)addTag('明日方舟终末地创作者应援计划',true);dialog.style.display='none'};
    });
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

// Exercise the real polling function without a logged-in browser or network.
test('upload initialization may report zero bytes before completion',async()=>{
  let reads=0;
  const empty={getClientRects:()=>[],innerText:''};
  const page={$$:async()=>[],evaluate:async()=>'', $$eval:async(selector,fn)=>{
    if(selector===S.upload)return [++reads===1?'上传中 0.0 MB / 0.0 MB':'上传完成 100%'];
    return fn([]);
  }};
  assert.deepEqual(await waitUpload(page,5000),{items:1,complete:true});
  assert.equal(reads,2);
});

test('sustained zero progress stops before submission and never reselects a video',async()=>{
  const original=Date.now;let time=0,reads=0;Date.now=()=>time;
  const page={$$:async()=>[],$$eval:async()=>{reads++;time+=31000;return ['上传中 0.0 MB / 0.0 MB'];}};
  try{await assert.rejects(waitUpload(page,200000),e=>e.code==='UPLOAD_WIDGET_STALLED');assert.equal(reads,3);}finally{Date.now=original;}
});

test('an intermediate nonzero upload update resets the zero-progress window',async()=>{
  const original=Date.now;let time=0,reads=0;Date.now=()=>time;
  const rows=['上传中 0.0 MB / 0.0 MB','上传中 1 MB / 4 MB','上传中 0.0 MB / 0.0 MB','上传完成 100%'];
  const page={$$:async()=>[],$$eval:async()=>{time+=31000;return [rows[reads++]];}};
  try{assert.deepEqual(await waitUpload(page,200000),{items:1,complete:true});assert.equal(reads,4);}finally{Date.now=original;}
});
