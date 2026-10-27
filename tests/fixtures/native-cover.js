// Sanitized local contract fixture based on inspected 2026-10 native controls.
// No platform code, account data, remote assets or actual submission endpoint.
window.installCoverFixture=function(options={}){
  document.querySelector('#cover-dialog')?.remove();document.querySelector('.cover-module')?.remove();
  const style=document.createElement('style');style.textContent=`
  .native-fixture{position:fixed;inset:8px auto auto 8px;width:700px;background:white;border:1px solid;z-index:50;padding:12px}
  .native-fixture .cover-editor-panel-canvas-image{position:relative;width:420px;height:236.25px}
  .native-fixture canvas{position:absolute;left:0;top:0;width:420px;height:236.25px}
  .native-fixture .crop-box-fixed{position:absolute;top:0;height:236.25px;pointer-events:none}
  .native-fixture input[type=file]{display:none}.native-fixture .cover-upload{display:block;height:24px}
  .native-fixture .active{outline:1px solid blue}.native-fixture button{min-height:24px;min-width:40px}
  .native-fixture.sync-warning{z-index:60;top:100px}.cover-module .cover-img{min-width:120px;min-height:25px}
  `;document.head.append(style);
  const module=document.createElement('div');module.className='cover-module';module.innerHTML='<button class="cover-img">封面</button>';document.body.append(module);
  const dialog=document.createElement('div');dialog.className='bcc-dialog native-fixture';dialog.id='cover-dialog';dialog.style.display='none';
  dialog.innerHTML='<h3>封面制作</h3><button class="cover-editor-head-close">关闭</button><div style="display:none"><input type="file" accept="image/png"></div><input type="file" accept="image/png" class="unrelated-file"><div class="cover-editor-panel-canvas"></div><div class="cover-editor-panel-select"><div class="cover-upload"><input type="file" accept="image/png,image/jpeg"></div></div><button class="done">完成</button>';
  document.body.append(dialog);
  const state=window.coverFixture={slot:'four_three',uploads:[],activation:[],saves:0,manual:0,sync:0,close:0,persisted:{},images:{},options};
  const slots={four_three:{css:'editor_4_3',label:'首页推荐封面（4:3）',x:options.cropX??52.5,width:315},sixteen_nine:{css:'editor_16_9',label:'个人空间封面（16:9）',x:0,width:420}};
  const panel=dialog.querySelector('.cover-editor-panel-canvas');
  for(const [slot,desc]of Object.entries(slots)){
    const row=document.createElement('div');row.className=slot===state.slot?'active':'inactive';
    row.innerHTML=`<div class="cover-editor-panel-canvas-title"><span>${desc.label}</span><label class="sync-checkbox"><input type="checkbox" ${options.syncChecked?'checked':''}>双比例同步改动</label></div><div class="${desc.css} cover-editor-panel-canvas-image"><div class="canvas-container"><canvas class="lower-canvas" width="420" height="236"></canvas><canvas class="upper-canvas" width="420" height="236"></canvas></div><div class="crop-box-fixed" style="left:${desc.x}px;width:${desc.width}px"></div></div>`;
    panel.append(row);const editor=row.querySelector('.cover-editor-panel-canvas-image');
    editor.onclick=event=>{
      const r=editor.getBoundingClientRect();
      if(!event.isTrusted||options.blockActivation||event.clientX-r.left<desc.x||event.clientX-r.left>desc.x+desc.width)return;
      state.slot=slot;state.activation.push(slot);for(const el of panel.children)el.className=el===row?'active':'inactive';
    };
  }
  function draw(slot,data){return new Promise(resolve=>{const im=new Image();im.onload=()=>{const desc=slots[slot],c=dialog.querySelector('.'+desc.css+' .lower-canvas'),ctx=c.getContext('2d');ctx.fillStyle='#888';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(im,desc.x,0,desc.width,c.height);resolve();};im.src=data;});}
  state.draw=draw;
  async function reopen(){
    state.images={...state.persisted};for(const [slot,data]of Object.entries(state.persisted))await draw(slot,data);
    if(options.corruptReadback&&state.saves)await draw('four_three',state.persisted.sixteen_nine);
    dialog.style.display='block';
  }
  module.querySelector('button').onclick=()=>setTimeout(reopen,options.openDelay??50);
  dialog.querySelector('.cover-editor-head-close').onclick=()=>{state.close++;dialog.style.display='none';};
  const uploader=dialog.querySelector('.cover-upload input');uploader.onchange=e=>{
    const slot=state.slot;state.uploads.push(slot);const reader=new FileReader();reader.onload=()=>setTimeout(async()=>{
      if(options.ignoreLoad)return;const data=options.wrongImage?state.images[slot]:reader.result;if(!data)return;
      state.images[slot]=data;await draw(slot,data);
      const checked=dialog.querySelector('.'+slots[slot].css).parentElement.querySelector('input[type=checkbox]').checked;
      if(checked){const other=slot==='four_three'?'sixteen_nine':'four_three';state.images[other]=data;await draw(other,data);}
    },options.loadDelay??60);reader.readAsDataURL(e.target.files[0]);
  };
  if(options.duplicateInput)dialog.querySelector('.cover-upload').append(uploader.cloneNode());
  if(options.unknownContract)dialog.querySelector('.editor_16_9').classList.remove('editor_16_9');
  if(options.duplicateEditor)panel.append(panel.firstElementChild.cloneNode(true));
  const save=()=>{state.saves++;state.persisted={...state.images};dialog.style.display='none';};
  dialog.querySelector('.done').onclick=()=>{
    if(options.unknownModal){const d=document.createElement('div');d.className='bcc-dialog native-fixture sync-warning';d.textContent='需要购买推广';document.body.append(d);return;}
    if(options.syncWarning&&(!state.manual||options.repeatWarning)){
      const d=document.createElement('div');d.className='bcc-dialog native-fixture sync-warning';
      d.innerHTML=`<div>检测到${options.syncWarning==='four_three'?'首页推荐封面（4:3）':'个人空间封面（16:9）'}未修改</div><div class="sync-confirm-content">请分别编辑</div><button>不同步，手动编辑</button><button>确认同步</button>`;document.body.append(d);
      d.querySelector('button').onclick=()=>{state.manual++;d.remove();if(options.manualSaves)save();};d.querySelectorAll('button')[1].onclick=()=>{state.sync++;throw Error('Forbidden sync choice');};return;
    }
    setTimeout(save,options.saveDelay??75);
  };
  if(options.autoOpen)reopen();
  return true;
};
