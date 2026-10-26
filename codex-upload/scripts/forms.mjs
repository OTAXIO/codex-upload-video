import fs from 'node:fs';

// Independently implemented actions. Selector facts were checked on the 2026-10
// creator UI; upstream references and their licenses are listed in NOTICE.
export const S={title:'.video-title input.input-val',description:'.desc-container .ql-editor',
  statement:'.creation-statement-container',statementTrigger:'.creation-statement-container .bcc-select-input-wrap',
  statementOptions:'.creation-statement-container li.bcc-option',partition:'.video-human-type .select-item-cont',
  partitionTrigger:'.video-human-type .select-controller',partitionOption:'.video-human-type .item-cont-main',
  tagInput:'.tag-container .tag-input-wrp input.input-val',tags:'.tag-container .label-item-v2-container',
  topics:'.tag-topic-list > span',collection:'.video-season .season-enter',collectionOption:'.season-dropdown .season-item',
  upload:'.file-list-v2-item, .file-item',submit:'.submit-container .submit-add',cover:'.cover-module .cover-img'};
export const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function fault(code,message,details={}){throw Object.assign(new Error(message),{code,details});}
export const norm=s=>(s??'').replace(/\r/g,'').replace(/\n+/g,'\n').trim();
export function popularity(text){const m=String(text??'').match(/([\d.]+)\s*(亿|万)?(?:次播放|播放)/);return m?Number(m[1])*({'亿':1e8,'万':1e4}[m[2]]??1):null;}
export function chooseActivity(rows,policy){
  if(policy.strategy==='none')return null;
  const words=policy.keywords??['AI','科技'];
  const candidates=rows.filter(x=>!x.disabled&&!x.paid&&!/付费|充值|推广购买|广告投放/.test(x.name));
  if(policy.strategy==='explicit'){
    const chosen=candidates.filter(x=>String(x.id)===String(policy.id));
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
export async function dismissKnown(page){
  for(const dialog of await page.$$('.bcc-dialog'))if(await dialog.isVisible()){
    const text=await dialog.evaluate(e=>e.innerText);
    if(text.includes('开启后视频上传完成第一时间通知')){const close=await dialog.$('.bcc-dialog__close');if(close){await close.click();continue;}}
    fault('UNKNOWN_DIALOG','A dialog requires a supported handling rule; no blind confirmation',{dialog_text:text.slice(0,100)});
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
      visibility:get('.check-radio-v2-box-checked + .check-radio-v2-name')?.innerText.trim()??null};
  },S);
}
async function declarations(page,wanted){
  let actual=await readForm(page);
  if(Object.keys(wanted).every(k=>actual.declarations[k]===wanted[k]))return;
  const disabled=await page.$eval(S.statement,e=>!!e.querySelector('.bcc-select.disabled'));
  if(disabled)fault('DECLARATION_IMMUTABLE','Platform does not allow changing this submitted declaration');
  await (await visible(page,S.statementTrigger)).click();
  const primary=wanted.ai_generated?'含AI生成内容':wanted.original?'内容无需标注':'内容为转载';
  const option=await exactText(page,primary,'.creation-statement-container');await option.click();
  actual=await readForm(page);
  if(actual.declarations.no_reprint!==wanted.no_reprint){
    if(!await visible(page,'.creation-statement-container .auth-content',false))await (await visible(page,S.statementTrigger)).click();
    await (await visible(page,'.creation-statement-container .auth-content')).click();
  }
  const list=await visible(page,'.creation-statement-container .bcc-select-list-wrap',false);
  if(list)await (await visible(page,S.statementTrigger)).click();
}
async function partition(page,name){
  if((await readForm(page)).partition===name)return;
  await (await visible(page,S.partitionTrigger)).click();
  await (await exactText(page,name,'.video-human-type')).click();
}
export async function topicRows(page){
  return await page.$$eval(S.topics,els=>els.filter(e=>e.getClientRects().length).map((e,index)=>({index,id:e.getAttribute('v-model'),name:e.querySelector('.hot-tag-item>span')?.innerText.trim()??'',raw_views:e.querySelector('.des')?.textContent??'',selected:!!e.querySelector('.hot-tag-container-selected'),disabled:!!e.querySelector('.is-disabled,[disabled]'),paid:/付费|充值/.test(e.innerText)})));
}
async function activity(page,policy){
  const rows=(await topicRows(page)).map(x=>({...x,views:popularity(x.raw_views)}));
  if(!await page.$('.tag-topic-list'))fault('ACTIVITY_CONTROL_MISSING','Cannot inspect activity eligibility');
  const chosen=chooseActivity(rows,policy);
  for(const row of rows.filter(x=>x.selected&&x.id!==chosen?.id)){
    const h=await page.$(`${S.topics}[v-model="${row.id}"] .hot-tag-container`);if(!h)fault('ACTIVITY_MISMATCH','Selected topic cannot be changed safely');await h.click();
  }
  if(chosen&&!chosen.selected){
    if(!/^\d+$/.test(chosen.id??''))fault('ACTIVITY_ID_MISSING','Activity has no stable platform identifier');
    await (await visible(page,`${S.topics}[v-model="${chosen.id}"] .hot-tag-container`)).click();
  }
  return chosen?{...chosen,popularity_evidence:chosen.views===null?'platform_recommendation_order':'platform_displayed_views'}:null;
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
  await visibleOptions[index].click();await pause(300);
  const current=await readForm(page);if(current.collection_name!==chosen.name)fault('COLLECTION_MISMATCH','Collection readback differs');
  return {id:chosen.id,name:chosen.name,basis:'complete_catalog_order_and_name_readback'};
}
async function covers(page,wanted){
  await (await visible(page,S.cover)).click();await pause(400);
  const dialogs=[];for(const e of await page.$$('.bcc-dialog'))if(await e.isVisible()&&(await e.evaluate(e=>e.innerText)).includes('封面制作'))dialogs.push(e);
  if(dialogs.length!==1)fault('COVER_DIALOG_MISSING','Cannot locate the unique dual-cover editor');
  const dialog=dialogs[0];await dialog.evaluate(e=>e.setAttribute('data-codex-cover-dialog','true'));
  const scope='[data-codex-cover-dialog="true"]';const recorded={};
  for(const [name,label] of [['four_three','首页推荐封面（4:3）'],['sixteen_nine','个人空间封面（16:9）']]){
    await (await exactText(page,label,scope)).click();await pause(250);
    const input=await dialog.$('input[type=file][accept*=image]');if(!input)fault('COVER_INPUT_MISSING','Cover image input is missing');
    await input.uploadFile(wanted[name].path);await pause(2200);
    recorded[name]=await dialog.evaluate(e=>{const imgs=[...e.querySelectorAll('img')].filter(i=>i.getClientRects().length&&i.naturalWidth>0);imgs.sort((a,b)=>b.getBoundingClientRect().width*b.getBoundingClientRect().height-a.getBoundingClientRect().width*a.getBoundingClientRect().height);return imgs[0]?.currentSrc||imgs[0]?.src||null;});
    if(!recorded[name])fault('COVER_NOT_LOADED','Uploaded cover is not visible in its slot');
  }
  await (await exactText(page,'完成',scope)).click();await pause(500);
  if(await visible(page,scope,false))fault('COVER_SAVE_FAILED','Cover editor did not close');
  await (await visible(page,S.cover)).click();await pause(350);
  let checkDialog=null;for(const e of await page.$$('.bcc-dialog'))if(await e.isVisible()&&(await e.evaluate(e=>e.innerText)).includes('封面制作'))checkDialog=e;
  if(!checkDialog)fault('COVER_READBACK_FAILED','Cannot reopen saved covers');
  await checkDialog.evaluate(e=>e.setAttribute('data-codex-cover-dialog','true'));
  for(const [name,label] of [['four_three','首页推荐封面（4:3）'],['sixteen_nine','个人空间封面（16:9）']]){
    await (await exactText(page,label,scope)).click();await pause(200);
    const src=await checkDialog.evaluate(e=>{const a=[...e.querySelectorAll('img')].filter(i=>i.getClientRects().length&&i.naturalWidth>0);a.sort((x,y)=>y.getBoundingClientRect().width*y.getBoundingClientRect().height-x.getBoundingClientRect().width*x.getBoundingClientRect().height);return a[0]?.currentSrc||a[0]?.src||null;});
    if(src!==recorded[name])fault('COVER_READBACK_FAILED','A saved cover slot differs from the uploaded image',{slot:name});
  }
  const close=await checkDialog.$('.bcc-dialog__close');if(close)await close.click();else await (await exactText(page,'完成',scope)).click();
  return {four_three:{sha256:wanted.four_three.sha256,slot_loaded:true,persisted:true},sixteen_nine:{sha256:wanted.sixteen_nine.sha256,slot_loaded:true,persisted:true}};
}
async function visibility(page,wanted){
  if((await readForm(page)).visibility===null){
    const toggle=await exactText(page,'更多设置 （含声明与权益、视频元素、互动管理等）','body',false);
    if(toggle)await toggle.click();else{
      for(const e of await page.$$('span.label'))if((await e.evaluate(e=>e.innerText)).includes('更多设置')){await e.click();break;}
    }
  }
  const label=wanted==='public'?'公开可见':'仅自己可见';
  const option=await exactText(page,label,'.setting',false);
  if(!option){if((await readForm(page)).visibility!==wanted)fault('VISIBILITY_MISSING','Cannot verify requested visibility');return;}
  await option.click();
}

export async function applyFields(page,wanted,catalog){
  await dismissKnown(page);await platformCheck(page);const before=await readForm(page);const result={};
  if('title'in wanted)await textInput(page,S.title,wanted.title);
  if('description'in wanted)await textInput(page,S.description,wanted.description);
  if('declarations'in wanted)await declarations(page,wanted.declarations);
  if('partition'in wanted)await partition(page,wanted.partition);
  if('tags'in wanted)await tags(page,wanted.tags);
  if('activity'in wanted)result.activity=await activity(page,wanted.activity);
  if('tags'in wanted)await tags(page,wanted.tags);
  if('collection'in wanted)result.collection=await collection(page,wanted.collection,catalog);
  if('covers'in wanted)result.covers=await covers(page,wanted.covers);
  if('visibility'in wanted)await visibility(page,wanted.visibility);
  await dismissKnown(page);await platformCheck(page);
  const after=await readForm(page);
  // readForm uses UI labels; normalize only this enum.
  const labelMap={'公开可见':'public','仅自己可见':'self'};after.visibility=labelMap[after.visibility]??after.visibility;
  const mismatches=compareFields(after,wanted,result.activity);
  for(const field of ['title','description','partition','tags','declarations','collection_name']){
    const key=field==='collection_name'?'collection':field;
    if(field==='tags'&&'activity'in wanted){
      const a=before.tags.filter(t=>!before.activity_tags.includes(t)),b=after.tags.filter(t=>!after.activity_tags.includes(t));
      if(!('tags'in wanted)&&JSON.stringify(a)!==JSON.stringify(b))mismatches['unrequested.tags']=true;
    }else if(!(key in wanted)&&JSON.stringify(before[field])!==JSON.stringify(after[field]))mismatches['unrequested.'+field]=true;
  }
  if(Object.keys(mismatches).length)fault('READBACK_MISMATCH','Final fields differ from the requested metadata',{fields:Object.keys(mismatches)});
  return {...result,readback:after};
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
  await platformCheck(page);await dismissKnown(page);
  const button=await visible(page,S.submit);
  if(await button.evaluate(e=>e.classList.contains('disabled')||e.classList.contains('is-disabled')||e.disabled))fault('SUBMIT_DISABLED','Platform has disabled submission');
  let handler;let timeout;
  const response=new Promise((resolve,reject)=>{
    handler=async r=>{try{
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
