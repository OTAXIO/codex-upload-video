import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {S,applyFields,waitUpload,submitOnce,pause,fault} from './forms.mjs';

const job=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const imported=job.runtime.puppeteer_module ? await import(pathToFileURL(job.runtime.puppeteer_module).href) : await import('puppeteer-core');
const puppeteer=imported.default;
const UPLOAD='https://member.bilibili.com/platform/upload/video/frame';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fail(code,message){throw Object.assign(new Error(message),{code});}
async function catalogRows(browser){
  const tab=await browser.newPage();let rows=null;
  tab.on('response',async response=>{try{
    const u=new URL(response.url());if(u.hostname!=='member.bilibili.com'||u.pathname!=='/x2/creative/web/seasons')return;
    const d=await response.json();if(d.code===0&&Array.isArray(d.data?.seasons))rows=d.data.seasons.map(x=>({id:x.season.id,name:x.season.title,episodes:x.season.ep_num??0,is_pay:!!x.season.is_pay}));
  }catch{}});
  try{
    await tab.goto('https://member.bilibili.com/platform/upload-manager/ep',{waitUntil:'domcontentloaded',timeout:45000});
    for(let i=0;rows===null&&i<30;i++)await sleep(500);
    if(rows===null)fail('CATALOG_UNAVAILABLE','Authenticated collection list did not load');return rows;
  }finally{await tab.close();}
}
async function videoInfo(browser,target){
  const tab=await browser.newPage();
  const clean=String(target).replace(/^av/,'');if(!/^(?:BV[A-Za-z0-9]{10}|\d+)$/.test(clean))fail('INVALID_TARGET','Invalid archive identifier');
  try{
    await tab.goto('https://api.bilibili.com/x/web-interface/view?'+(/^BV/.test(clean)?'bvid=':'aid=')+clean,{waitUntil:'domcontentloaded',timeout:30000});
    return await tab.evaluate(()=>{try{const d=JSON.parse(document.body.innerText);return {code:d.code,aid:d.data?.aid??null,bvid:d.data?.bvid??null,title:d.data?.title??null,owner_mid:d.data?.owner?.mid??null,pubdate:d.data?.pubdate??null};}catch{return {code:-1};}});
  }finally{await tab.close();}
}
async function account(browser){
  const tab=await browser.newPage();
  try{
    await tab.goto('https://api.bilibili.com/x/web-interface/nav',{waitUntil:'domcontentloaded',timeout:30000});
    return await tab.evaluate(()=>{try{const d=JSON.parse(document.body.innerText);return {logged_in:d.code===0&&d.data?.isLogin===true,mid:d.data?.mid??null,name:d.data?.uname??null};}catch{return {logged_in:false,mid:null,name:null};}});
  } finally {await tab.close();}
}

async function run(browser,page){
  if(job.mode==='login'){
    await page.goto(UPLOAD,{waitUntil:'domcontentloaded',timeout:45000});
    await page.bringToFront();
    await page.waitForFunction(()=>!!document.querySelector('input[type=file][name=buploader]'),{timeout:job.login_timeout_ms??300000,polling:1000});
    const who=await account(browser);
    if(!who.logged_in)fail('AUTH_REQUIRED','Complete Bilibili login in the dedicated window.');
    return {ok:true,mode:'login',account:who};
  }
  const who=await account(browser);
  if(!who.logged_in)fail('AUTH_REQUIRED','Dedicated browser is not logged in. Run login once.');
  if(job.expected_mid && String(who.mid)!==String(job.expected_mid))fail('ACCOUNT_MISMATCH','Dedicated browser account differs from configured account.');
  if(job.mode==='doctor')return {ok:true,account:who,backend:'independent-owned-browser'};
  if(job.mode==='verify'){
    const info=await videoInfo(browser,job.target);
    if(info.code!==0)return {ok:true,state:'unknown',account:who,evidence:'Public view not yet available; cannot infer approval',receipt:info};
    if(String(info.owner_mid)!==String(who.mid))fail('ACCOUNT_MISMATCH','Archive is owned by a different account');
    return {ok:true,state:'published',account:who,receipt:{...info,url:'https://www.bilibili.com/video/'+info.bvid}};
  }
  if(job.mode==='reconcile'){
    await page.goto('https://member.bilibili.com/platform/upload-manager/article',{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForSelector('input[placeholder="搜索稿件"]',{timeout:20000});
    const search=await page.$('input[placeholder="搜索稿件"]');await search.type(job.meta.title);await search.press('Enter');await sleep(2500);
    const matches=await page.$$eval('a[href*="/video/BV"]',(els,title)=>[...new Set(els.filter(e=>e.innerText.trim()===title).map(e=>e.href.match(/\/video\/(BV[A-Za-z0-9]{10})/)?.[1]).filter(Boolean))],job.meta.title);
    if(matches.length!==1)return {ok:true,state:'unknown',account:who,evidence:'No unique creator archive matches this attempt'};
    const info=await videoInfo(browser,matches[0]);
    const earliest=Date.parse(job.attempt_started_at)/1000-120;
    if(info.code!==0||String(info.owner_mid)!==String(who.mid)||!Number.isFinite(earliest)||info.pubdate<earliest||info.title!==job.meta.title)return {ok:true,state:'unknown',account:who,evidence:'Cannot associate archive with this upload attempt'};
    return {ok:true,state:'published',account:who,receipt:{...info,url:'https://www.bilibili.com/video/'+info.bvid}};
  }
  if(job.mode==='publish'||job.mode==='edit'){
    const meta=job.meta,wanted=job.mode==='edit'?meta.changes:meta;
    const catalog=wanted.collection?await catalogRows(browser):[];
    if(wanted.collection?.required){
      const matches=catalog.filter(x=>!x.is_pay&&(wanted.collection.id?String(x.id)===String(wanted.collection.id):x.name===wanted.collection.name));
      if(!matches.length||(matches.length>1&&matches.filter(x=>x.episodes>0).length!==1))fail('COLLECTION_AMBIGUOUS','Resolve the existing collection before uploading any file');
    }
    let url=UPLOAD;let target=null;
    if(job.mode==='edit'){
      const info=await videoInfo(browser,meta.target);
      if(info.code!==0||String(info.owner_mid)!==String(who.mid))fail('TARGET_NOT_FOUND','Cannot verify ownership of the explicit edit target');
      target=info.bvid;url=UPLOAD+'?type=edit&bvid='+target;
    }
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    if(job.mode==='publish'){
      await page.waitForSelector('input[type=file][name=buploader][accept*=".mp4"]',{timeout:30000});
      try{await page.waitForNetworkIdle({idleTime:800,timeout:10000});}catch{}await sleep(1500);
      const area=await page.$('.upload-area');if(!area)fail('UPLOAD_CONTROL_MISSING','Actual upload area is not available');
      const chooser=page.waitForFileChooser({timeout:15000});await area.click();const input=await chooser;
      if(job.progress)fs.writeFileSync(job.progress,JSON.stringify({video_selected:true,submit_started:false,at:new Date().toISOString()}));
      await input.accept([meta.video.path]);
    }
    await page.waitForSelector(S.title,{visible:true,timeout:60000});
    // Close only the known upload-notification popup; all unknown dialogs stop.
    const fields=await applyFields(page,wanted,catalog);
    const media=job.mode==='publish'?await waitUpload(page):{existing_video:true};
    const receipt=await submitOnce(page,job,target);
    return {ok:true,state:'submitted',account:who,receipt,fields,media,platform_review_pending:true};
  }
  if(job.mode==='catalog'){
    const rows=[];
    page.on('response',async response=>{
      try{
        const u=new URL(response.url());if(!/season|section/.test(u.pathname)||!u.hostname.endsWith('bilibili.com'))return;
        const data=await response.json();
        const walk=(v,trail=[])=>{if(v&&typeof v==='object'){
          if(v.title==='News'||v.name==='News')rows.push({api:u.pathname,path:trail.join('.'),id:v.id??v.season_id??null,season_id:v.season_id??null,section_id:v.section_id??null,title:v.title??v.name,total:v.total??v.count??v.total_episodes??v.ep_num??null,is_pay:!!v.is_pay});
          for(const [k,x] of Object.entries(v))walk(x,[...trail,k]);
        }};walk(data);
      }catch{}
    });
    await page.goto('https://member.bilibili.com/platform/upload-manager/ep',{waitUntil:'domcontentloaded',timeout:45000});await sleep(7000);
    const text=await page.evaluate(()=>document.body.innerText);
    return {ok:true,account:who,collections:rows,has_news:text.includes('News')};
  }
  const target=job.mode==='inspect'&&job.read_url?job.read_url:UPLOAD;
  if(!target.startsWith('https://member.bilibili.com/'))fail('INVALID_TARGET','Inspect only the authenticated creator site.');
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:45000});
  if(job.mode==='inspect'){
    await sleep(7000);
    if(job.inspect_target){
      if(!/^BV[A-Za-z0-9]{10}$/.test(job.inspect_target))fail('INVALID_TARGET','Explicit BV is required');
      const edit=await page.evaluateHandle(bv=>{
        const a=[...document.querySelectorAll('a[href]')].find(a=>a.href.includes('/video/'+bv));
        for(let row=a;row;row=row.parentElement){
          const ids=new Set([...row.querySelectorAll('a[href]')].map(a=>a.href.match(/\/video\/(BV[A-Za-z0-9]{10})/)?.[1]).filter(Boolean));
          if(ids.size>1)return null;
          const e=[...row.querySelectorAll('button,a,span,div')].find(e=>e.innerText?.trim()==='编辑');
          if(e)return e;
        }return null;
      },job.inspect_target);
      const element=edit.asElement();if(!element)fail('TARGET_NOT_FOUND','Cannot find exactly scoped edit entry');
      await element.click();await sleep(7000);
    }
    if(job.inspect_open_collection){
      for(const e of await page.$$('.video-season .season-enter'))if(await e.isVisible()){await e.click();await sleep(700);break;}
    }
    const dom=await page.evaluate(()=>({url:location.href,text:document.body.innerText.slice(0,16000),form_fragments:['.creation-statement-container','.cover-module','.video-season-content'].map(css=>({css,html:[...document.querySelectorAll(css)].find(e=>e.getClientRects().length)?.outerHTML.slice(0,15000)})),section_fragments:['加入合集','参与话题：'].map(label=>{const e=[...document.querySelectorAll('div,span,p,h3,label')].find(e=>e.getClientRects().length&&e.innerText.trim()===label);return {label,html:e?.parentElement?.parentElement?.outerHTML.slice(0,9500)}}),links:[...document.querySelectorAll('a[href]')].map(e=>({text:e.innerText.slice(0,120),href:e.href})),inputs:[...document.querySelectorAll('input')].map(e=>({type:e.type,name:e.name,placeholder:e.placeholder,accept:e.accept,classes:e.className})),buttons:[...document.querySelectorAll('button')].map(e=>({text:e.innerText,type:e.type,classes:e.className}))}));
    return {ok:true,account:who,dom};
  }
  await page.waitForSelector('input[type=file][name=buploader]',{timeout:30000});
  fail('UNSUPPORTED_MODE','This browser operation is not yet available.');
}

let browser;
try{
  fs.mkdirSync(job.profile_dir,{recursive:true});
  browser=await puppeteer.launch({executablePath:job.runtime.browser_executable,userDataDir:job.profile_dir,headless:false,defaultViewport:{width:1440,height:1050},timeout:45000});
  const pages=await browser.pages();const page=pages[0]??await browser.newPage();
  const result=await run(browser,page);
  if(job.output)fs.writeFileSync(job.output,JSON.stringify(result,null,2));
  process.stdout.write(JSON.stringify(result)+'\n');
}catch(error){
  const result={ok:false,error:{code:error.code??(error.name==='TimeoutError'?'TIMEOUT':'BACKEND_ERROR'),message:error.code?error.message:'Browser operation failed; inspect local diagnostics without exposing credentials.',...(error.details?{details:error.details}:{})}};
  if(job.output)fs.writeFileSync(job.output,JSON.stringify(result,null,2));
  process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=1;
}finally{if(browser)await browser.close();}
