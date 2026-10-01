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
 const label=/(?:\binv(?:oice)?\s*[.#:/\s-]*(?:no\.?|number|num|#|n[o°])\b|\binv\s*[#:]|\binv(?:oice)?\b|\bno\.?\s*[:#-]|លេខ\s*(?:វិក្កយបត្រ|បង្កាន់ដៃ))/i;
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
// Most BIG BROTHER paper books print the large invoice number beside "Inv. No."
// in the upper-right header. Crop this area BEFORE scanning body text, dates,
// quantities or prices. Return uncertain rather than guessing among numbers.
async function headerImage(file){
 const bitmap=await createImageBitmap(file);
 try{
  const x=Math.round(bitmap.width*.53),y=Math.round(bitmap.height*.09);
  const width=Math.max(1,Math.round(bitmap.width*.45));
  const height=Math.max(1,Math.round(bitmap.height*.32));
  const canvas=document.createElement('canvas');
  const scale=Math.max(2,Math.min(5,1900/width));
  canvas.width=Math.round(width*scale);
  canvas.height=Math.round(height*scale);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.filter='contrast(170%) grayscale(100%)';
  ctx.drawImage(bitmap,x,y,Math.min(width,bitmap.width-x),Math.min(height,bitmap.height-y),0,0,canvas.width,canvas.height);
  return canvas;
 }finally{bitmap.close()}
}
async function scanHeader(file,expected){
 const roi=await headerImage(file);
 const result=await window.Tesseract.recognize(roi,'eng',{logger:()=>{},tessedit_pageseg_mode:6});
 // An isolated header may contain both a label and date. The label-linked
 // number takes priority; a single bare number is acceptable otherwise.
 const labelled=extract(result?.data?.text||'',false);
 const found=labelled.length?labelled:extract(result?.data?.text||'',true);
 const normalized=[...new Set(found.map(normalize))];
 if(normalized.length===1&&normalized[0]===expected)
  return {status:'match',scanned:found[0],candidates:found,message:'Top-right printed invoice number matches the system invoice.'};
 if(normalized.length===1&&normalized[0]!==expected)
  return {status:'mismatch',scanned:found[0],candidates:found,message:'Top-right printed invoice number '+found[0]+' does not match the system invoice.'};
 return null;
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
  // The main image is still retained for storage. Only OCR uses this crop.
  // A labelled number or a single standalone number in the header is primary.
  if(!options.numberOnly){
   try{
    const header=await scanHeader(file,normalizedExpected);
    if(header)return header;
   }catch(error){console.warn('Header OCR fallback:',error)}
  }
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