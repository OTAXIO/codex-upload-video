import fs from 'node:fs';

// Independently implemented actions. Selector facts were checked on the 2026-10
// creator UI; upstream references and their licenses are listed in NOTICE.
export const S={title:'.video-title input.input-val',description:'.desc-container .ql-editor',
  statement:'.creation-statement-container',statementTrigger:'.creation-statement-container .bcc-select-input-wrap',
  statementOptions:'.creation-statement-container li.bcc-option',partition:'.video-human-type .select-item-cont',
  partitionTrigger:'.video-human-type .select-controller',partitionOption:'.video-human-type .item-cont-main',
  tagInput:'.tag-container .tag-input-wrp input.input-val',tags:'.tag-container .label-item-v2-container',
  topics:'.tag-topic-list > span',collection:'.video-season .season-enter',collectionOption:'.season-dropdown .season-item',
  upload:'.file-list-v2-item, .file-item',submit:'.submit-container .submit-add',cover:'.cover-module-main .cover-slot, .cover-module .cover-img'};
export const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function fault(code,message,details={}){throw Object.assign(new Error(message),{code,details});}
export const norm=s=>(s??'').replace(/\r/g,'').replace(/\n+/g,'\n').trim();
export function popularity(text){const m=String(text??'').match(/([\d.]+)\s*(亿|万)?(?:次播放|播放)/);return m?Number(m[1])*({'亿':1e8,'万':1e4}[m[2]]??1):null;}
export function chooseActivity(rows,policy){
  if(policy.strategy==='none')return null;
  const words=policy.keywords??['AI','科技'];
  const candidates=rows.filter(x=>!x.disabled&&!x.paid&&!/付费|充值|推广购买|广告投放/.test(x.name));
  if(policy.strategy==='explicit'){
    const chosen=candidates.filter(x=>String(x.id)===String(policy.id)&&(!policy.name||x.name===policy.name));
    if(chosen.length!==1)fault('ACTIVITY_NOT_AVAILABLE','The specified activity is not eligible');return chosen[0];
  }
  const relevant=candidates.filter(x=>words.some(w=>x.name.toLowerCase().includes(w.toLowerCase())));
  relevant.sort((a,b)=>(b.views??-1)-(a.views??-1)||a.index-b.index);return relevant[0]??null;
}
export function compareFields(actual,wanted,activity=null){
  const mismatches={};
  for(const k of ['title','partition','visibility'])if(k in wanted&&actual[k]!==wanted[k])mismatches[k]=true;
  if('description'in wanted&&norm(actual.description)!==norm(wanted.description))mismatches.description=true;
  if('tags'in wanted){
    const allowed=new Set([...wanted.tags,...(actual.activity_tags??[])]);
    if(wanted.tags.some(t=>!actual.tags.includes(t))||actual.tags.some(t=>!allowed.has(t)))mismatches.tags=true;
  }
  if('declarations'in wanted)for(const k of ['original','ai_generated','no_reprint'])if(actual.declarations?.[k]!==wanted.declarations[k])mismatches['declarations.'+k]=true;
  if(wanted.collection?.required&&actual.collection_name!==wanted.collection.name)mismatches.collection=true;
  if(activity&&!actual.activity_tags?.includes(activity.name))mismatches.activity=true;
  return mismatches;
}

export async function visible(page,css,required=true){
  for(const element of await page.$$(css))if(await element.isVisible())return element;
  if(required)fault('SELECTOR_MISSING','Required visible control is missing',{selector:css});return null;
}
export async function exactText(page,text,scope='body',required=true){
  if(required){try{await page.waitForFunction((scope,text)=>{const root=[...document.querySelectorAll(scope)].find(e=>e.getClientRects().length);if(!root)return false;let all=[...root.querySelectorAll('button,span,div,p,li,label')].filter(e=>e.getClientRects().length&&e.innerText.trim()===text);all=all.filter(e=>!all.some(other=>other!==e&&e.contains(other)));return all.length===1;},{timeout:5000},scope,text);}catch{}}
  const handle=await page.evaluateHandle((scope,text)=>{
    const root=[...document.querySelectorAll(scope)].find(e=>e.getClientRects().length);if(!root)return null;
    let all=[...root.querySelectorAll('button,span,div,p,li,label')].filter(e=>e.getClientRects().length&&e.innerText.trim()===text);
    all=all.filter(e=>!all.some(other=>other!==e&&e.contains(other)));
    return all.length===1?all[0]:null;
  },scope,text);
  const element=handle.asElement();if(!element&&required)fault('AMBIGUOUS_CONTROL','Required unique text control is missing/ambiguous',{label:text});return element;
}
export async function textInput(page,css,value){
  const element=await visible(page,css);await element.click();
  const control=process.platform==='darwin'?'Meta':'Control';await page.keyboard.down(control);await page.keyboard.press('KeyA');await page.keyboard.up(control);
  await page.keyboard.press('Backspace');await page.keyboard.sendCharacter(value);await element.evaluate(e=>e.dispatchEvent(new Event('change',{bubbles:true})));
}
async function isCoverEditor(dialog){
  // Require the known dual-slot image editor, not an arbitrary matching title.
  const text=await dialog.evaluate(e=>e.innerText);
  return text.includes('封面制作')&&text.includes('首页推荐封面（4:3）')&&text.includes('个人空间封面（16:9）')&&!!await dialog.$('input[type=file][accept*=image]');
}
export async function dismissKnown(page){
  for(const dialog of await page.$$('.bcc-dialog'))if(await dialog.isVisible()){
    const text=await dialog.evaluate(e=>e.innerText);
    if(text.includes('开启后视频上传完成第一时间通知')){const close=await dialog.$('.bcc-dialog__close');if(close){await close.click();continue;}}
    if(await isCoverEditor(dialog)){
      const close=await dialog.$('.bcc-dialog__close');
      if(!close)fault('COVER_CONTROL_MISSING','Known cover editor has no safe close control');
      // Cancel an auto-open/stale editor; covers() later loads both final assets.
      await close.click();
      try{await page.waitForFunction(e=>!e.getClientRects().length,{timeout:5000},dialog);}catch{fault('COVER_SAVE_FAILED','Known cover editor did not close');}
      continue;
    }
    fault('UNKNOWN_DIALOG' ,'A dialog requires a supported handling rule; no blind confirmation',{dialog_text:text.slice(0,100)});
  }
}
export async function platformCheck(page){
  for(const css of ['.geetest_panel','.geetest_panel_box','.bili-mini-login','.passport-login-container'])if(await visible(page,css,false))fault('AUTH_OR_VERIFICATION_REQUIRED','Login or verification interrupted this operation');
}
export async function readForm(page){
  return await page.evaluate(S=>{
    const get=css=>[...document.querySelectorAll(css)].find(e=>e.getClientRects().length);
    const statement=document.querySelector(S.statement);
    const options=[...(statement?.querySelectorAll('li.bcc-option.selected')??[])].map(e=>(e.querySelector('span')?.textContent??e.textContent).trim());
    const author=statement?.querySelector('.auth-content .option-text-selected');
    const chips=[...document.querySelectorAll(S.tags)].filter(e=>e.getClientRects().length);
    return {title:get(S.title)?.value??null,description:get(S.description)?.innerText??null,partition:get(S.partition)?.innerText.trim()??null,
      declarations:{ai_generated:options.includes('含AI生成内容'),original:!options.includes('内容为转载'),no_reprint:!!author&&author.textContent.includes('内容为自制')},
      tags:chips.map(e=>e.querySelector('.label-item-v2-content')?.innerText.trim()??e.innerText.trim()),
      activity_tags:chips.filter(e=>e.querySelector('.topic-icon')).map(e=>e.querySelector('.label-item-v2-content')?.innerText.trim()??e.innerText.trim()),
      collection_name:get('.video-season .season-enter-text')?.getAttribute('title')??get('.video-season .season-enter-text-name')?.innerText.trim()??null,
      visibility:document.querySelector('.check-radio-v2-box-checked + .check-radio-v2-name')?.textContent.trim()??null};
  },S);
}
async function declarations(page,wanted){
  let actual=await readForm(page);
  if(Object.keys(wanted).every(k=>actual.declarations[k]===wanted[k]))return;
  const disabled=await page.$eval(S.statement,e=>!!e.querySelector('.bcc-select.disabled'));
  if(disabled)fault('DECLARATION_IMMUTABLE','Platform does not allow changing this submitted declaration');
  await (await visible(page,S.statementTrigger)).click();
  const primary=wanted.ai_generated?'含AI生成内容':wanted.original?'内容无需标注':'内容为转载';
  const option=await exactText(page,primary,'.creation-statement-container');await option.click();await pause(350);
  actual=await readForm(page);
  if(actual.declarations.no_reprint!==wanted.no_reprint){
    if(!await visible(page,'.creation-statement-container .auth-content',false))await (await visible(page,S.statementTrigger)).click();
    await page.waitForSelector('.creation-statement-container .auth-content',{visible:true,timeout:5000});
    await (await visible(page,'.creation-statement-container .auth-content')).click();await pause(250);
  }
  const list=await visible(page,'.creation-statement-container .bcc-select-list-wrap',false);
  if(list)await (await visible(page,S.statementTrigger)).click();
}
async function partition(page,name){
  // Upload classification and declaration popovers may redraw/close this menu.
  await pause(600);
  for(let attempt=0;attempt<2;attempt++){
    if((await readForm(page)).partition===name)return;
    await (await visible(page,S.partitionTrigger)).click();await pause(350);
    let option=null;
    for(let tick=0;tick<12&&!option;tick++){option=await exactText(page,name,'.video-human-type',false);if(!option)await pause(250);}
    if(option){await option.click();await pause(400);if((await readForm(page)).partition===name)return;}
  }
  fault('PARTITION_MISMATCH','Requested partition did not remain selected',{partition:name});
}

export async function topicRows(page){
  return await page.$$eval(S.topics,els=>els.filter(e=>e.getClientRects().length).map((e,index)=>({index,id:e.getAttribute('v-model'),name:e.querySelector('.hot-tag-item>span')?.innerText.trim()??'',raw_views:e.querySelector('.des')?.textContent??'',selected:!!e.querySelector('.hot-tag-container-selected'),disabled:!!e.querySelector('.is-disabled,[disabled]'),paid:/付费|充值/.test(e.innerText)})));
}
async function activity(page,policy){
  const rows=(await topicRows(page)).map(x=>({...x,views:popularity(x.raw_views)}));
  if(!await page.$('.tag-topic-list'))fault('ACTIVITY_CONTROL_MISSING','Cannot inspect activity eligibility');
  const missingExplicit=policy.strategy==='explicit'&&policy.name&&!rows.some(x=>String(x.id)===String(policy.id)||x.name===policy.name);
  const chosen=missingExplicit?{id:String(policy.id),name:policy.name,selected:false,views:null}:chooseActivity(rows,policy);
  for(const row of rows.filter(x=>x.selected&&String(x.id)!==String(chosen?.id))){
    const h=await page.$(`${S.topics}[v-model="${row.id}"] .hot-tag-container`);if(!h)fault('ACTIVITY_MISMATCH','Selected topic cannot be changed safely');await h.click();
  }
  if(chosen&&!chosen.selected){
    if(!/^\d+$/.test(String(chosen.id??'')))fault('ACTIVITY_ID_MISSING','Activity has no stable platform identifier');
    if(missingExplicit){
      // The creator UI says “use the activity tag to participate”. An explicit
      // event need not appear in the six recommendations. Enter its EXACT tag;
      // only a real platform topic-icon counts, never an ordinary text tag.
      const current=await readForm(page);
      if(!current.activity_tags.includes(chosen.name))await tags(page,[...current.tags.filter(t=>!current.activity_tags.includes(t)),chosen.name]);
      for(let tick=0;tick<20;tick++){
        if((await readForm(page)).activity_tags.includes(chosen.name))break;
        await pause(250);
      }
    }else await (await visible(page,`${S.topics}[v-model="${chosen.id}"] .hot-tag-container`)).click();
  }
  const actual=await readForm(page);
  if(chosen&&!actual.activity_tags.includes(chosen.name))fault('ACTIVITY_NOT_AVAILABLE','Requested activity was not recognized by the platform; do not substitute another event',{name:chosen.name});
  if(policy.strategy==='explicit'&&actual.activity_tags.some(name=>name!==chosen.name))fault('ACTIVITY_MISMATCH','Another activity is still selected; do not submit');
  return chosen?{...chosen,verification:missingExplicit?'exact_tag_and_platform_topic_icon':'recommended_topic_and_readback',popularity_evidence:chosen.views===null?'explicit_user_selection':'platform_displayed_views'}:null;
}
async function tags(page,wanted){
  for(let round=0;round<15;round++){
    let removed=false;
    for(const chip of await page.$$(S.tags)){
      if(!await chip.isVisible())continue;
      const text=await chip.evaluate(e=>e.querySelector('.label-item-v2-content')?.innerText.trim()??e.innerText.trim());
      if(wanted.includes(text)||await chip.$('.topic-icon'))continue;
      const close=await chip.$('svg.close');if(!close)fault('TAG_NOT_REMOVABLE','Cannot remove an unwanted platform tag');
      await close.click();removed=true;break;
    }if(!removed)break;
  }
  for(const tag of wanted){
    if((await readForm(page)).tags.includes(tag))continue;
    if((await readForm(page)).tags.length>=10)fault('TAG_CAPACITY','Activity consumes a tag; reduce ordinary tags before publishing');
    const input=await visible(page,S.tagInput);await input.click();await input.type(tag);await input.press('Enter');await pause(180);
    if(!(await readForm(page)).tags.includes(tag))fault('TAG_REJECTED','Platform did not accept a required tag',{tag});
  }
}
export async function collection(page,wanted,catalog){
  if(!wanted?.required&&!wanted?.name)return null;
  const matches=catalog.filter(x=>wanted.id?String(x.id)===String(wanted.id):x.name===wanted.name);
  const useful=matches.filter(x=>x.episodes>0);
  const chosen=matches.length===1?matches[0]:useful.length===1?useful[0]:null;
  if(!chosen)fault('COLLECTION_AMBIGUOUS','Resolve the required collection by stable ID once; do not create it or pick a duplicate name');
  const control=await visible(page,S.collection);await control.click();
  await page.waitForSelector('.season-dropdown',{visible:true,timeout:5000});
  const rows=await page.$$eval(S.collectionOption,els=>els.filter(e=>e.getClientRects().length).map(e=>e.querySelector('.season-item-title')?.innerText.trim()??e.innerText.trim()));
  // The current UI omits IDs; map the complete API order only when every title
  // matches, rather than selecting the first duplicated label.
  if(rows.length!==catalog.length||rows.some((name,i)=>name!==catalog[i].name))fault('COLLECTION_ORDER_MISMATCH','Cannot safely map dropdown to authenticated collection IDs');
  const index=catalog.findIndex(x=>x.id===chosen.id);const options=await page.$$(S.collectionOption);const visibleOptions=[];
  for(const e of options)if(await e.isVisible())visibleOptions.push(e);
  await visibleOptions[index].click();await pause(750);
  // A recovered/auto-filled form may already have this row selected. Bilibili
  // toggles it OFF on click. Reopen and select the SAME catalog-mapped row once.
  if((await readForm(page)).collection_name!==chosen.name){
    await (await visible(page,S.collection)).click();
    await page.waitForSelector('.season-dropdown',{visible:true,timeout:5000});
    const retryRows=[];
    for(const e of await page.$$(S.collectionOption))if(await e.isVisible())retryRows.push(e);
    const names=await Promise.all(retryRows.map(e=>e.evaluate(e=>e.querySelector('.season-item-title')?.innerText.trim()??e.innerText.trim())));
    if(names.length!==catalog.length||names.some((name,i)=>name!==catalog[i].name))fault('COLLECTION_ORDER_MISMATCH','Collection list changed during same-form recovery');
    await retryRows[index].click();await pause(750);
  }
  const current=await readForm(page);if(current.collection_name!==chosen.name)fault('COLLECTION_MISMATCH','Collection readback differs');
  return {id:chosen.id,name:chosen.name,basis:'complete_catalog_order_and_name_readback'};
}
async function coverPixels(dialog,index){
  return await dialog.evaluate((root,index)=>{
    const canvases=[...root.querySelectorAll('canvas.lower-canvas')];
    let image=canvases[index];
    if(!image){const imgs=[...root.querySelectorAll('img')].filter(i=>i.getClientRects().length&&i.naturalWidth>0);imgs.sort((a,b)=>b.getBoundingClientRect().width*b.getBoundingClientRect().height-a.getBoundingClientRect().width*a.getBoundingClientRect().height);image=imgs[0];}
    if(!image)return null;
    const c=document.createElement('canvas');c.width=64;c.height=64;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,64,64);ctx.drawImage(image,0,0,64,64);
    return {pixels:Array.from(ctx.getImageData(0,0,64,64).data),width:image.width,height:image.height,kind:canvases.length?'rendered_canvas':'image'};
  },index);
}
export function sameCoverPixels(a,b){
  if(!a||!b||a.pixels.length!==b.pixels.length||a.width!==b.width||a.height!==b.height)return false;
  let total=0;for(let i=0;i<a.pixels.length;i++)total+=Math.abs(a.pixels[i]-b.pixels[i]);
  return total/a.pixels.length<=8;
}
async function waitCoverEditor(page){
  try{await page.waitForFunction(()=>[...document.querySelectorAll('.bcc-dialog')].some(e=>e.getClientRects().length&&e.innerText.includes('封面制作')&&e.querySelector('input[type=file][accept*=image]')),{timeout:10000});}
  catch{fault('COVER_DIALOG_MISSING','Dual-cover editor did not mount before deadline');}
}
async function covers(page,wanted){
  await (await visible(page,S.cover)).click();await waitCoverEditor(page);
  const dialogs=[];for(const e of await page.$$('.bcc-dialog'))if(await e.isVisible()&&(await e.evaluate(e=>e.innerText)).includes('封面制作'))dialogs.push(e);
  if(dialogs.length!==1)fault('COVER_DIALOG_MISSING','Cannot locate the unique dual-cover editor');
  const dialog=dialogs[0];await dialog.evaluate(e=>e.setAttribute('data-codex-cover-dialog','true'));
  const scope='[data-codex-cover-dialog="true"]';const recorded={};
  for(const [name,label] of [['four_three','首页推荐封面（4:3）'],['sixteen_nine','个人空间封面（16:9）']]){
    await (await exactText(page,label,scope)).click();await pause(250);
    const input=await dialog.$('input[type=file][accept*=image]');if(!input)fault('COVER_INPUT_MISSING','Cover image input is missing');
    await input.uploadFile(wanted[name].path);await pause(2200);
    recorded[name]=await coverPixels(dialog,name==='four_three'?0:1);
    if(!recorded[name])fault('COVER_NOT_LOADED','Uploaded cover is not visible in its slot');
  }
  await (await exactText(page,'完成',scope)).click();await pause(500);
  try{await page.waitForSelector(scope,{hidden:true,timeout:30000});}catch{fault('COVER_SAVE_FAILED','Cover editor did not finish saving');}
  await (await visible(page,S.cover)).click();await waitCoverEditor(page);
  let checkDialog=null;for(const e of await page.$$('.bcc-dialog'))if(await e.isVisible()&&(await e.evaluate(e=>e.innerText)).includes('封面制作'))checkDialog=e;
  if(!checkDialog)fault('COVER_READBACK_FAILED','Cannot reopen saved covers');
  await checkDialog.evaluate(e=>e.setAttribute('data-codex-cover-dialog','true'));
  for(const [name,label] of [['four_three','首页推荐封面（4:3）'],['sixteen_nine','个人空间封面（16:9）']]){
    await (await exactText(page,label,scope)).click();await pause(200);
    const actual=await coverPixels(checkDialog,name==='four_three'?0:1);
    if(!sameCoverPixels(actual,recorded[name]))fault('COVER_READBACK_FAILED','Saved cover pixels differ from the uploaded slot',{slot:name});
  }
  const close=await checkDialog.$('.bcc-dialog__close');if(close)await close.click();else await (await exactText(page,'完成',scope)).click();await pause(350);
  return {four_three:{sha256:wanted.four_three.sha256,slot_loaded:true,persisted:true,verification:'rendered_pixels'},sixteen_nine:{sha256:wanted.sixteen_nine.sha256,slot_loaded:true,persisted:true,verification:'rendered_pixels'}};
}
async function visibility(page,wanted){
  const desiredLabel=wanted==='public'?'公开可见':'仅自己可见';
  if((await readForm(page)).visibility===desiredLabel)return;
  if(!await visible(page,'.setting',false)){
    const toggle=await exactText(page,'更多设置 （含声明与权益、视频元素、互动管理等）','body',false);
    if(toggle)await toggle.click();else{
      for(const e of await page.$$('span.label'))if((await e.evaluate(e=>e.innerText)).includes('更多设置')){await e.click();break;}
    }
  }
  await pause(400);
  const label=wanted==='public'?'公开可见':'仅自己可见';
  const option=await exactText(page,label,'.setting',true);
  if(!option){if((await readForm(page)).visibility!==label)fault('VISIBILITY_MISSING','Cannot verify requested visibility');return;}
  await option.click();await pause(250);
}

export async function applyFields(page,wanted,catalog){
  await platformCheck(page);await dismissKnown(page);
  const before=await readForm(page),result={},attempts={};
  const setters={
    title:async()=>{if((await readForm(page)).title!==wanted.title)await textInput(page,S.title,wanted.title);},
    description:async()=>{if(norm((await readForm(page)).description)!==norm(wanted.description))await textInput(page,S.description,wanted.description);},
    declarations:async()=>declarations(page,wanted.declarations),
    partition:async()=>partition(page,wanted.partition),
    tags:async()=>tags(page,wanted.tags),
    activity:async()=>{result.activity=await activity(page,wanted.activity);},
    collection:async()=>{result.collection=await collection(page,wanted.collection,catalog);},
    covers:async()=>{result.covers=await covers(page,wanted.covers);},
    visibility:async()=>visibility(page,wanted.visibility)
  };
  const retryable={partition:['PARTITION_MISMATCH'],collection:['COLLECTION_MISMATCH'],covers:['COVER_DIALOG_MISSING','COVER_READBACK_FAILED','COVER_SAVE_FAILED','COVER_NOT_LOADED']};
  async function set(field){
    attempts[field]=(attempts[field]??0)+1;
    try{await setters[field]();}catch(error){
      if(attempts[field]>=2||!retryable[field]?.includes(error.code))throw error;
      await platformCheck(page);await dismissKnown(page);
      attempts[field]++;await setters[field]();
    }
  }
  // No whole-form replay: a late partition readback must not re-toggle News,
  // declarations, activity or replace covers that already passed verification.
  for(const field of ['title','description','declarations','partition','tags','activity','collection','covers','visibility'])if(field in wanted)await set(field);
  if('tags'in wanted)await tags(page,wanted.tags);
  let after;
  for(let check=0;check<2;check++){
    await platformCheck(page);await dismissKnown(page);after=await readForm(page);
    after.visibility=({'公开可见':'public','仅自己可见':'self'})[after.visibility]??after.visibility;
    const mismatches=compareFields(after,wanted,result.activity);
    for(const field of ['title','description','partition','tags','declarations','collection_name']){
      const key=field==='collection_name'?'collection':field;
      if(field==='tags'&&'activity'in wanted){
        const a=before.tags.filter(t=>!before.activity_tags.includes(t)),b=after.tags.filter(t=>!after.activity_tags.includes(t));
        if(!('tags'in wanted)&&JSON.stringify(a)!==JSON.stringify(b))mismatches['unrequested.tags']=true;
      }else if(!(key in wanted)&&JSON.stringify(before[field])!==JSON.stringify(after[field]))mismatches['unrequested.'+field]=true;
    }
    const fields=Object.keys(mismatches);
    if(!fields.length)return {...result,readback:after};
    const repair=[...new Set(fields.map(x=>x.split('.')[0]))];
    if(check||repair.some(f=>!(f in wanted)||!setters[f]||(attempts[f]??0)>=2))fault('READBACK_MISMATCH','Final fields differ from requested metadata',{fields});
    for(const field of repair)await set(field);
    if('tags'in wanted&&repair.includes('activity'))await tags(page,wanted.tags);
  }
}
export async function waitUpload(page,timeout=1800000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    await dismissKnown(page);await platformCheck(page);
    const items=await page.$$eval(S.upload,els=>els.filter(e=>e.getClientRects().length).map(e=>e.innerText));
    const text=items.join(' ');
    if(/失败|错误/.test(text))fault('UPLOAD_FAILED','Platform reports failed media upload');
    if(items.length&&/上传完成|已完成|处理完成|100(?:\.0+)?%/.test(text)&&!/(?:上传中|等待上传|剩余时间)/.test(text))return {items:items.length,complete:true};
    if(/0\.0\s*MB\s*\/\s*0\.0\s*MB/.test(text))fault('UPLOAD_WIDGET_STALLED','Upload widget did not accept the selected file; do not select it twice');
    await pause(2000);
  }fault('UPLOAD_TIMEOUT','Upload did not complete before deadline; reconcile before retry');
}
export async function submitOnce(page,job,target=null){
  if(job.progress&&fs.existsSync(job.progress)){
    const previous=JSON.parse(fs.readFileSync(job.progress,'utf8'));
    if(previous.submit_started)fault('RECONCILE_REQUIRED','Submit was already started for this attempt; do not click again');
  }
  await platformCheck(page);await dismissKnown(page);
  const button=await visible(page,S.submit);
  if(await button.evaluate(e=>e.classList.contains('disabled')||e.classList.contains('is-disabled')||e.disabled))fault('SUBMIT_DISABLED','Platform has disabled submission');
  let handler;let timeout;
  const response=new Promise((resolve,reject)=>{
    handler=async r=>{try{
      if(r.request().method()!=='POST')return;
      const url=new URL(r.url());
      if(url.hostname!=='member.bilibili.com'||!/^\/x\/vu\/(?:web|client)\/(?:add|edit)(?:\/v\d+)?$/.test(url.pathname))return;
      const d=await r.json();resolve({code:d.code,message:typeof d.message==='string'?d.message.slice(0,100):'',aid:d.data?.aid??d.data?.archive?.aid??null,bvid:d.data?.bvid??null});
    }catch{}};
    page.on('response',handler);timeout=setTimeout(()=>reject(Object.assign(new Error('Submission receipt timed out'),{code:'SUBMISSION_UNKNOWN'})),60000);
  });
  if(job.progress)fs.writeFileSync(job.progress,JSON.stringify({video_selected:job.mode==='publish',submit_started:true,at:new Date().toISOString()}));
  try{
    await button.click();const result=await response;
    if(result.code!==0)fault([-101,-111].includes(result.code)?'AUTH_REQUIRED':[-412,-352].includes(result.code)?'PLATFORM_VERIFICATION':'SUBMISSION_REJECTED','Platform rejected submission',{platform_code:result.code});
    if(target&&!result.bvid&&/^BV/.test(target))result.bvid=target;
    if(target&&!result.aid&&/^\d+$/.test(target))result.aid=Number(target);
    if(!result.aid&&!result.bvid)fault('SUBMISSION_UNKNOWN','Success response had no verifiable archive identifier');
    return {...result,url:result.bvid?'https://www.bilibili.com/video/'+result.bvid:'https://www.bilibili.com/video/av'+result.aid,submitted_at:new Date().toISOString()};
  }finally{clearTimeout(timeout);page.off('response',handler);}
}
