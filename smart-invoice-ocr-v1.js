/* BIG BROTHER client-side OCR assistant. Never treats a guess as verified. */
(function(){
'use strict';
let loadPromise=null;
function normalize(value){
 const digits=String(value||'').replace(/^INV[\s#-]*/i,'').replace(/[^0-9]/g,'');
 return digits?String(BigInt(digits)):'';
}
function extract(text,numberOnly=false){
 const clean=String(text||'').replace(/[ＯＯ]/g,'0').replace(/[Ｉｌ]/g,'1')
  .replace(/[０-９]/g,c=>String(c.charCodeAt(0)-0xff10));
 const lines=clean.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 const candidates=[];
 // Different invoice books print No., INV#, Invoice N°, Invoice No, or Khmer labels.
 const label=/(?:\binv(?:oice)?\b|\binv[.#:/\s-]*(?:no|num|number|#)\b|\binvoice\s*(?:no|number|#|n[o°])\b|(?:\bno\.?\s*[:#-])|លេខ\s*(?:វិក្កយបត្រ|បង្កាន់ដៃ))/i;
 const capture=/^\s*[:#№.\s-]*([0-9OoIl|][0-9OoIl|\s-]{0,13}[0-9OoIl|])\b/;
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  let tail='';
  const match=line.match(label);
  if(match){
   tail=line.slice((match.index||0)+match[0].length);
   const m=tail.match(capture);
   if(m)candidates.push(m[1].replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/[\s-]/g,''));
   else if(i+1<lines.length){
    const next=lines[i+1].match(capture);
    if(next)candidates.push(next[1].replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/[\s-]/g,''));
   }
  }
 }
 if(numberOnly){
  // A user-selected crop is only accepted when OCR finds ONE standalone number.
  // No phone, quantity or date guessing from an uncropped full invoice.
  const bare=lines.map(line=>line.replace(/[Oo]/g,'0').replace(/[Il|]/g,'1')
   .match(/^\s*[#№.:-]?\s*([0-9][0-9\s-]{0,13}[0-9])\s*$/))
   .filter(Boolean).map(m=>m[1].replace(/[\s-]/g,''));
  candidates.push(...bare);
 }
 return [...new Set(candidates)].filter(s=>normalize(s));
}
async function enhancedImage(file){
 if(!file.type.startsWith('image/'))return file;
 const bmp=await createImageBitmap(file);
 try{
  const scale=Math.max(1,Math.min(3,1800/bmp.width));
  const canvas=document.createElement('canvas');
  canvas.width=Math.ceil(bmp.width*scale);canvas.height=Math.ceil(bmp.height*scale);
  const context=canvas.getContext('2d',{willReadFrequently:true});
  context.filter='contrast(150%) grayscale(100%)';
  context.drawImage(bmp,0,0,canvas.width,canvas.height);
  return canvas;
 }finally{bmp.close()}
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
async function verify(file,expected,options={}){
 if(!file)return {status:'unclear',message:'Select an image to scan.',scanned:'',candidates:[]};
 if(!/^image\/(png|jpeg|webp)$/.test(file.type))return {status:'unclear',message:'Automatic verification requires a JPG, PNG or WebP photo. PDF requires an authorized manual review.',scanned:'',candidates:[]};
 const normalizedExpected=normalize(expected);
 if(!normalizedExpected)return {status:'unclear',message:'System invoice number is missing.',scanned:'',candidates:[]};
 try{
  await script();
  const result=await window.Tesseract.recognize(file,'eng',{logger:()=>{}});
  let candidates=extract(result?.data?.text||'',!!options.numberOnly);
  if(!candidates.length){
   // Retry with larger/high-contrast text and sparse-text segmentation.
   const enhanced=await enhancedImage(file);
   const second=await window.Tesseract.recognize(enhanced,'eng',{
    logger:()=>{},tessedit_pageseg_mode:11
   });
   candidates=extract(second?.data?.text||'',!!options.numberOnly);
  }
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