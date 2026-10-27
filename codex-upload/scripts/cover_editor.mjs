import fs from 'node:fs';
import {fault,pause,visible,exactText,platformCheck} from './browser_ui.mjs';

const INPUT='.cover-editor-panel-select .cover-upload input[type=file][accept*=image]';
const OPEN='.cover-module-main .cover-slot, .cover-module .cover-img';
const CLOSE='.cover-editor-head-close, .bcc-dialog__close';
const SLOTS={four_three:{css:'.editor_4_3',label:'首页推荐封面（4:3）',ratio:4/3},sixteen_nine:{css:'.editor_16_9',label:'个人空间封面（16:9）',ratio:16/9}};
const SIDE=128;
const verified=new WeakMap();

// Only the verified native editor contract is supported. A convenient generic
// image/file input is not evidence that this is the intended cover control.
export async function isCoverEditor(dialog){
  return await dialog.evaluate((root,input)=>root.innerText.includes('封面制作')&&
    root.innerText.includes('首页推荐封面（4:3）')&&root.innerText.includes('个人空间封面（16:9）')&&
    ['.editor_4_3','.editor_16_9'].every(css=>root.querySelectorAll(css).length===1&&root.querySelectorAll(css+' canvas.lower-canvas').length===1&&root.querySelectorAll(css+' .crop-box-fixed').length===1)&&!!root.querySelector(input),INPUT);
}
export async function coverDiagnostics(page){
  return await page.evaluate(input=>[...document.querySelectorAll('.bcc-dialog')].filter(d=>d.getClientRects().length).map(d=>({
    // Structured, bounded control facts, never full HTML, file values or URLs.
    type:d.querySelector('.sync-confirm-content')?'cover_sync':d.querySelector('.editor_4_3')?'cover_editor':'other',
    buttons:[...d.querySelectorAll('button')].map(b=>b.innerText.trim().slice(0,60)),
    upload_inputs:d.querySelectorAll(input).length,close_controls:d.querySelectorAll('.cover-editor-head-close,.bcc-dialog__close').length,
    slots:['.editor_4_3','.editor_16_9'].map(css=>{const e=d.querySelector(css),c=e?.querySelector('canvas.lower-canvas'),r=e?.querySelector('.crop-box-fixed')?.getBoundingClientRect();return {slot:css,active:e?.parentElement.classList.contains('active')??false,canvas:c?{width:c.width,height:c.height}:null,crop:r?{width:r.width,height:r.height}:null};})
  })),INPUT);
}
async function visibleDialogs(page){const out=[];for(const d of await page.$$('.bcc-dialog'))if(await d.isVisible())out.push(d);return out;}
export async function chooseManualCoverEditing(page){
  for(const d of await visibleDialogs(page)){
    if(!await d.$('.sync-confirm-content'))continue;
    const text=await d.evaluate(e=>e.innerText);
    if(!/检测到/.test(text)||!text.includes('封面')||!text.includes('未修改'))fault('UNKNOWN_DIALOG','Unrecognized cover synchronization dialog');
    const choices=[];for(const b of await d.$$('button'))if(await b.isVisible()&&await b.evaluate(e=>e.innerText.trim()==='不同步，手动编辑'))choices.push(b);
    if(choices.length!==1)fault('UNKNOWN_DIALOG','The explicit manual cover choice is missing or ambiguous');
    await choices[0].click();
    try{await page.waitForFunction(e=>!e.isConnected||!e.getClientRects().length,{timeout:5000},d);}catch{fault('COVER_SAVE_FAILED','Manual cover choice did not dismiss its dialog');}
    return {slot:text.includes('4:3')?'four_three':text.includes('16:9')?'sixteen_nine':'both'};
  }return null;
}
export async function closeCoverEditor(page,dialog){
  const buttons=[];for(const c of await dialog.$$(CLOSE))if(await c.isVisible())buttons.push(c);
  if(buttons.length!==1)fault('COVER_CONTROL_MISSING','Native cover editor must have one visible safe close control');
  await buttons[0].click();
  try{await page.waitForFunction(e=>!e.isConnected||!e.getClientRects().length,{timeout:5000},dialog);}catch{fault('COVER_SAVE_FAILED','Native cover editor did not close');}
}
export function sameCoverPixels(a,b){
  if(!a||!b||a.pixels.length!==b.pixels.length||a.width!==b.width||a.height!==b.height)return false;
  let total=0,ink=0,inkCount=0;const tiles=new Map(),side=Math.sqrt(a.pixels.length/4);
  for(let p=0;p<a.pixels.length/4;p++){
    let difference=0;for(let k=0;k<3;k++)difference+=Math.abs(a.pixels[p*4+k]-b.pixels[p*4+k]);difference/=3;total+=difference;
    // White margins cannot hide a wrong title or a small missing content block.
    if([0,1,2].some(k=>a.pixels[p*4+k]<235||b.pixels[p*4+k]<235)){ink+=difference;inkCount++;}
    const key=Math.floor((p%side)/Math.max(1,side/16))+16*Math.floor(Math.floor(p/side)/Math.max(1,side/16));const tile=tiles.get(key)??[0,0];tile[0]+=difference;tile[1]++;tiles.set(key,tile);
  }
  return total/(a.pixels.length/4)<=8&&(!inkCount||ink/inkCount<=24)&&[...tiles.values()].every(([sum,n])=>sum/n<=36);
}
async function pixels(dialog,slot){
  return await dialog.evaluate((root,{css,ratio,side})=>{
    const editor=root.querySelector(css),canvas=editor?.querySelector('canvas.lower-canvas'),crop=editor?.querySelector('.crop-box-fixed');
    if(!canvas||!crop||!canvas.width||!canvas.height)return null;
    const bounds=canvas.getBoundingClientRect(),box=crop.getBoundingClientRect();
    if(!bounds.width||!bounds.height||!box.width||!box.height||Math.abs(box.width/box.height-ratio)>.02)return null;
    const x=(box.left-bounds.left)*canvas.width/bounds.width,y=(box.top-bounds.top)*canvas.height/bounds.height,w=box.width*canvas.width/bounds.width,h=box.height*canvas.height/bounds.height;
    if(x<-.5||y<-.5||x+w>canvas.width+.5||y+h>canvas.height+.5)return null;
    const c=document.createElement('canvas');c.width=c.height=side;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,side,side);ctx.drawImage(canvas,x,y,w,h,0,0,side,side);
    return {pixels:Array.from(ctx.getImageData(0,0,side,side).data),width:Math.round(w),height:Math.round(h),crop:{x,y,width:w,height:h},kind:'native_crop_canvas'};
  },{...SLOTS[slot],side:SIDE});
}

export class CoverEditor{
  constructor(page,wanted,{timeout=15000,poll=150}={}){this.page=page;this.wanted=wanted;this.timeout=timeout;this.poll=poll;this.events=[];this.expected={};this.recorded={};}
  phase(name,slot){this.events.push({phase:name,...(slot?{slot}:{}),at:new Date().toISOString()});}
  async wait(predicate,code,message){
    const end=Date.now()+this.timeout;
    while(Date.now()<end){await platformCheck(this.page);if(await predicate())return;await pause(this.poll);}
    fault(code,message);
  }
  async assertDialogs(){
    for(const d of await visibleDialogs(this.page))if(!await isCoverEditor(d))fault('UNKNOWN_DIALOG','A blocking dialog interrupted the cover transaction');
  }
  async open(){
    this.phase('opening');await this.assertDialogs();
    if(!(await visibleDialogs(this.page)).length){const slot=await visible(this.page,OPEN);const target=await slot.$('.cover-empty-pill')??slot;await target.evaluate(e=>e.scrollIntoView({block:'center'}));await target.click();}
    await this.wait(async()=>{await this.assertDialogs();const ds=await visibleDialogs(this.page);if(ds.length>1)fault('COVER_DIALOG_MISSING','Multiple native cover editors are visible');if(ds.length===1){this.dialog=ds[0];return true;}return false;},'COVER_DIALOG_MISSING','Native dual cover editor did not mount');
    await this.dialog.evaluate(e=>e.setAttribute('data-codex-cover-dialog','true'));
  }
  async select(slot){
    await this.assertDialogs();this.phase('selecting',slot);
    const editor=await this.dialog.$(SLOTS[slot].css);
    if(!editor)fault('COVER_INPUT_MISSING','Native ratio editor is missing',{slot});
    // Puppeteer's real centre click reaches the visible crop, including inert
    // labels and Fabric canvases whose shaded corners ignore pointer input.
    await editor.click();
    await this.wait(()=>editor.evaluate(e=>e.parentElement.classList.contains('active')&&[...e.closest('.bcc-dialog').querySelectorAll('.editor_4_3,.editor_16_9')].filter(x=>x.parentElement.classList.contains('active')).length===1),'COVER_INPUT_MISSING','Requested ratio did not become exclusively active');
    const toggles=await editor.evaluateHandle(e=>e.parentElement.querySelector('.sync-checkbox input[type=checkbox]'));
    const checkbox=toggles.asElement();if(checkbox&&await checkbox.evaluate(e=>e.checked)){
      const label=await editor.evaluateHandle(e=>e.parentElement.querySelector('.sync-checkbox'));await label.asElement().click();
      await this.wait(()=>checkbox.evaluate(e=>!e.checked),'COVER_CONTROL_MISSING','Cannot disable automatic ratio synchronization');
    }
    return editor;
  }
  async load(slot){
    const editor=await this.select(slot);const inputs=[];
    for(const input of await this.dialog.$$(INPUT))if(await input.evaluate(e=>{for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden')return false;if(p.classList.contains('bcc-dialog'))return true;}return false;}))inputs.push(input);
    if(inputs.length!==1)fault('COVER_INPUT_MISSING','Cover panel must expose exactly one shared image upload input',{slot,count:inputs.length});
    if(!await editor.evaluate(e=>e.parentElement.classList.contains('active')))fault('COVER_INPUT_MISSING','Ratio changed before selecting its file',{slot});
    this.phase('loading',slot);await inputs[0].uploadFile(this.wanted[slot].path);
    await this.wait(async()=>{await this.assertDialogs();const actual=await pixels(this.dialog,slot);if(actual&&sameCoverPixels(actual,{...actual,pixels:this.expected[slot].pixels})){this.recorded[slot]=actual;return true;}return false;},'COVER_NOT_LOADED','Local cover pixels did not reach their intended native crop');
    this.phase('loaded',slot);
  }
  async save(){
    const prompts=new Set();
    while(true){
      this.phase('saving');await this.assertDialogs();await (await exactText(this.page,'完成','[data-codex-cover-dialog="true"]')).click();
      let manual=null;
      await this.wait(async()=>{
        manual=await chooseManualCoverEditing(this.page);if(manual)return true;
        await this.assertDialogs();return !await this.dialog.isVisible();
      },'COVER_SAVE_FAILED','Native cover save did not finish');
      if(!manual)return;
      this.phase('manual_choice',manual.slot);
      if(!await this.dialog.isVisible())return; // Some native versions save directly.
      if(prompts.has(manual.slot))fault('COVER_SAVE_FAILED','Same synchronization warning persisted after both ratios were manually updated');
      prompts.add(manual.slot);
      // A warning can refer to either ratio; re-establish both independently.
      for(const slot of Object.keys(SLOTS))await this.load(slot);
    }
  }
  async run(){
    try{
      for(const slot of Object.keys(SLOTS)){
        const source='data:image/png;base64,'+fs.readFileSync(this.wanted[slot].path).toString('base64');
        this.expected[slot]=await this.page.evaluate(async({source,side})=>{const img=new Image();img.src=source;await img.decode();const c=document.createElement('canvas');c.width=c.height=side;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,side,side);ctx.drawImage(img,0,0,side,side);return {pixels:Array.from(ctx.getImageData(0,0,side,side).data),ratio:img.naturalWidth/img.naturalHeight};},{source,side:SIDE});
        if(Math.abs(this.expected[slot].ratio-SLOTS[slot].ratio)>.01)fault('WRONG_COVER_RATIO','Local cover has the wrong aspect ratio',{slot});
      }
      await this.open();for(const slot of Object.keys(SLOTS))await this.load(slot);await this.save();
      this.phase('reopening');await this.open();
      for(const slot of Object.keys(SLOTS)){
        await this.select(slot);this.phase('verifying',slot);
        await this.wait(async()=>{await this.assertDialogs();const actual=await pixels(this.dialog,slot);return sameCoverPixels(actual,this.recorded[slot])&&sameCoverPixels(actual,{...actual,pixels:this.expected[slot].pixels});},'COVER_READBACK_FAILED','Persisted cover differs from the local target');
      }
      await closeCoverEditor(this.page,this.dialog);this.phase('verified');
      return Object.fromEntries(Object.keys(SLOTS).map(slot=>[slot,{sha256:this.wanted[slot].sha256,slot_loaded:true,persisted:true,verification:'native_crop_local_target_and_reopen',crop:this.recorded[slot].crop}]));
    }catch(error){error.details={...error.details,cover_phase:this.events.at(-1),cover_trace:this.events,controls:await coverDiagnostics(this.page).catch(()=>[])};throw error;}
  }
}
export async function covers(page,wanted){
  verified.delete(page);
  const result=await new CoverEditor(page,wanted).run();
  const token=String(Date.now())+Math.random();
  await page.$eval(OPEN,(e,t)=>e.setAttribute('data-codex-verified-cover',t),token);
  verified.set(page,{token,hashes:Object.fromEntries(Object.keys(SLOTS).map(s=>[s,wanted[s].sha256]))});
  return result;
}
export async function assertCoversVerified(page,wanted){
  const proof=verified.get(page);
  if(!wanted||!proof||Object.keys(SLOTS).some(s=>!wanted[s]?.sha256||wanted[s].sha256!==proof.hashes[s])||
    !await page.$eval(OPEN,(e,t)=>e.getAttribute('data-codex-verified-cover')===t,proof.token).catch(()=>false))
    fault('COVER_VERIFICATION_REQUIRED','Submission requires both local covers and persisted readback in this document');
}
