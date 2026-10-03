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
// Focus on the actual printed serial at the upper-right. Camera angle,
// different book layouts and faded red ink need different crop/contrast passes.
function cropHeader(bitmap,box,style){
 const x=Math.round(bitmap.width*box[0]),y=Math.round(bitmap.height*box[1]);
 const w=Math.max(1,Math.min(bitmap.width-x,Math.round(bitmap.width*box[2])));
 const h=Math.max(1,Math.min(bitmap.height-y,Math.round(bitmap.height*box[3])));
 const scale=Math.max(2,Math.min(5,1450/w)),canvas=document.createElement('canvas');
 canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 if(style==='high')ctx.filter='grayscale(100%) contrast(210%) brightness(115%)';
 else if(style==='contrast')ctx.filter='grayscale(100%) contrast(155%)';
 else ctx.filter='contrast(115%) saturate(130%)';
 ctx.drawImage(bitmap,x,y,w,h,0,0,canvas.width,canvas.height);
 return canvas;
}
function isolatedSerial(text){
 return String(text||'').split(/\r?\n/).flatMap(line=>{
  const m=line.trim().replace(/[Oo]/g,'0').replace(/[Il|]/g,'1')
   .match(/^(?:inv(?:oice)?\s*(?:no\.?|#)?\s*[:#.-]?\s*)?([0-9]{4,8})\s*$/i);
  return m?[m[1]]:[];
 });
}
async function scanHeader(file,expected){
 const bitmap=await createImageBitmap(file),seen=[];
 try{
  // Start tight to exclude handwritten dates. Expand if serial moved.
  const probes=[
   {box:[.64,.13,.30,.17],style:'natural',mode:7,tight:true},
   {box:[.57,.10,.41,.27],style:'contrast',mode:6,tight:false},
   {box:[.61,.12,.37,.21],style:'high',mode:11,tight:false}
  ];
  for(const probe of probes){
   const result=await window.Tesseract.recognize(
    cropHeader(bitmap,probe.box,probe.style),'eng',
    {logger:()=>{},tessedit_pageseg_mode:probe.mode}
   );
   const raw=result?.data?.text||'';
   const labelled=extract(raw,false).filter(v=>/^[0-9]{4,8}$/.test(v));
   const found=labelled.length?labelled:isolatedSerial(raw);
   const unique=[...new Set(found.map(normalize))];
   if(unique.length!==1)continue;
   const item={value:unique[0],scanned:found[0],strong:labelled.length>0||probe.tight};
   seen.push(item);
   // Never approve based on the expected number being somewhere in a busy page.
   if(item.value===expected&&item.strong&&!seen.some(x=>x.strong&&x.value!==expected))
    return {status:'match',scanned:item.scanned,candidates:[item.scanned],
     message:'Upper-right printed invoice number matches the system invoice.'};
  }
 }finally{bitmap.close()}
 const strongSeen=seen.filter(x=>x.strong);
 const strong=[...new Set(strongSeen.map(x=>x.value))];
 // Red serial ink can turn a 9 into an 8 in one OCR pass. A single
 // alternate reading is not proof that the actual paper number differs.
 if(strong.length===1&&strong[0]!==expected){
  const corroboration=seen.filter(x=>x.value===strong[0]).length;
  const item=strongSeen[0];
  if(corroboration>=2&&seen.every(x=>x.value===strong[0]))
   return {status:'mismatch',scanned:item.scanned,candidates:[item.scanned],
    message:'Multiple header scans read '+item.scanned+', different from the system invoice. Inspect the print or request administrator review.'};
  return {status:'unclear',scanned:item.scanned,candidates:seen.map(x=>x.scanned),
   message:'Header OCR may have misread a digit ('+item.scanned+'). Select & Scan Number Area around the printed digits before deciding there is a mismatch.'};
 }
 if(strong.length>1)return {status:'unclear',scanned:'',candidates:seen.map(x=>x.scanned),
  message:'Header scans disagree about the printed number. Select & Scan Number Area or request administrator review.'};
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
  // A single OCR pass is insufficient to reject a printed number:
  // run a separate enhanced pass whenever the initial reading doesn't match.
  const first=[...new Set(candidates.map(normalize))];
  if(!candidates.length||(first.length===1&&first[0]!==normalizedExpected)){
   const enhanced=await enhancedImage(file);
   const second=await window.Tesseract.recognize(enhanced,'eng',{
    logger:()=>{},tessedit_pageseg_mode:11
   });
   const corroborating=extract(second?.data?.text||'',!!options.numberOnly);
   if(candidates.length&&corroborating.length){
    const secondDistinct=[...new Set(corroborating.map(normalize))];
    if(secondDistinct.length!==1||first.length!==1||first[0]!==secondDistinct[0])
     return {status:'unclear',scanned:'',candidates:[...candidates,...corroborating],
      message:'OCR scans disagree on one or more digits. Select & Scan Number Area around the printed digits or request administrator review.'};
   }
   if(corroborating.length)candidates=corroborating;
  }
  const distinct=[...new Set(candidates.map(normalize))];
  if(distinct.length===1&&distinct[0]===normalizedExpected)
   return {status:'match',scanned:candidates[0],candidates,message:'Scanned invoice number matches '+expected+'.'};
  if(distinct.length===1&&distinct[0]!==normalizedExpected)
   return {status:'unclear',scanned:candidates[0],candidates,
    message:'OCR read '+candidates[0]+', which differs from the system number, but cannot establish a mismatch confidently. Select & Scan Number Area or request administrator review.'};
  if(distinct.length>1)
   return {status:'unclear',scanned:'',candidates,message:'More than one possible invoice number detected. Needs administrator review.'};
  return {status:'unclear',scanned:'',candidates:[],message:'Invoice number could not be read confidently. Retake a clear photo or request administrator review.'};
 }catch(error){
  return {status:'unclear',scanned:'',candidates:[],message:'OCR unavailable: '+(error.message||'Please retry or request administrator review.')};
 }
}
window.BBInvoiceOCR={verify,normalize,extract};
})();