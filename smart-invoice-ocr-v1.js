/* BIG BROTHER client-side OCR assistant. Never treats a guess as verified. */
(function(){
'use strict';
let loadPromise=null;
function normalize(value){
 const digits=String(value||'').replace(/^INV[\s#-]*/i,'').replace(/[^0-9]/g,'');
 return digits?String(BigInt(digits)):'';
}
function extract(text){
 const clean=String(text||'').replace(/[ＯＯ]/g,'0').replace(/[Ｉｌ]/g,'1');
 const lines=clean.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 const candidates=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  // Prefer numbers explicitly associated with an invoice label. Do not use
  // random totals, dates, quantities, phone numbers or account numbers.
  const m=line.match(/(?:inv(?:oice)?\.?\s*(?:no|number|#|n[o°])?\.?|invoice\s*(?:no|#)|លេខ\s*វិក្កយបត្រ)\s*[:.#\-]?\s*([0-9OoIl|]{2,9})/i);
  if(m)candidates.push(m[1].replace(/[Oo]/g,'0').replace(/[Il|]/g,'1'));
  else if(/(?:inv(?:oice)?|លេខ\s*វិក្កយបត្រ)/i.test(line)&&i+1<lines.length){
   const next=lines[i+1].match(/^\s*([0-9OoIl|]{2,9})\s*$/);
   if(next)candidates.push(next[1].replace(/[Oo]/g,'0').replace(/[Il|]/g,'1'));
  }
 }
 return [...new Set(candidates)].filter(s=>normalize(s));
}
function script(){
 if(window.Tesseract?.recognize)return Promise.resolve();
 if(loadPromise)return loadPromise;
 loadPromise=new Promise((resolve,reject)=>{
  const s=document.createElement('script');
  s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  s.crossOrigin='anonymous';s.onload=()=>window.Tesseract?.recognize?resolve():reject(Error('OCR library unavailable'));
  s.onerror=()=>reject(Error('OCR cannot load on this connection'));
  document.head.append(s);
 }).catch(e=>{loadPromise=null;throw e});
 return loadPromise;
}
async function verify(file,expected){
 if(!file)return {status:'unclear',message:'Select an image to scan.',scanned:'',candidates:[]};
 if(!/^image\/(png|jpeg|webp)$/.test(file.type))return {status:'unclear',message:'Automatic verification requires a JPG, PNG or WebP photo. PDF requires an authorized manual review.',scanned:'',candidates:[]};
 const normalizedExpected=normalize(expected);
 if(!normalizedExpected)return {status:'unclear',message:'System invoice number is missing.',scanned:'',candidates:[]};
 try{
  await script();
  const result=await window.Tesseract.recognize(file,'eng',{logger:()=>{}});
  const candidates=extract(result?.data?.text||'');
  const distinct=[...new Set(candidates.map(normalize))];
  if(distinct.length===1&&distinct[0]===normalizedExpected)
   return {status:'match',scanned:candidates[0],candidates,message:'Scanned invoice number matches '+expected+'.'};
  if(distinct.length===1&&distinct[0]!==normalizedExpected)
   return {status:'mismatch',scanned:candidates[0],candidates,message:'STOP: Paper invoice '+candidates[0]+' does not match system invoice '+expected+'.'};
  if(distinct.length>1)
   return {status:'unclear',scanned:'',candidates,message:'More than one possible invoice number detected. Needs administrator review.'};
  return {status:'unclear',scanned:'',candidates:[],message:'Invoice number could not be read confidently. Retake a clear photo or request administrator review.'};
 }catch(error){
  return {status:'unclear',scanned:'',candidates:[],message:'OCR unavailable: '+(error.message||'Please retry or request administrator review.')};
 }
}
window.BBInvoiceOCR={verify,normalize,extract};
})();