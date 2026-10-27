// Shared browser primitives. No account data or platform writes at import time.
export const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function fault(code,message,details={}){throw Object.assign(new Error(message),{code,details});}
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
export async function platformCheck(page){
  for(const css of ['.geetest_panel','.geetest_panel_box','.bili-mini-login','.passport-login-container'])if(await visible(page,css,false))fault('AUTH_OR_VERIFICATION_REQUIRED','Login or verification interrupted this operation');
}
