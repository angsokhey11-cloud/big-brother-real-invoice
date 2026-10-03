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
   {box:[.69,.025,.25,.085],style:'natural',mode:7,tight:true},
   {box:[.65,.035,.32,.10],style:'contrast',mode:6,tight:false},
   {box:[.68,.015,.28,.115],style:'high',mode:11,tight:false}
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
// Printed invoice serials are red while the form, handwriting and date are
// generally blue. OCR a red-ink mask of the user-selected number crop so
// blue form lines cannot turn the open loop of a red 9 into an 8.
// Camera-independent OCR: use brightness and contrast, never ink hue.
// The operator's selected crop contains only printed digits; the full source
// photo is never modified and remains the saved original.
// Camera-independent selected-digit OCR: improve stroke separation and
// let multiple independent image treatments corroborate the same number.
async function digitImage(file,variant){
 const bitmap=await createImageBitmap(file);
 try{
  const scale=Math.max(2,Math.min(5,1500/bitmap.width));
  const pad=28,canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale))+pad*2;
  canvas.height=Math.max(1,Math.round(bitmap.height*scale))+pad*2;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(bitmap,pad,pad,canvas.width-pad*2,canvas.height-pad*2);
  if(variant==='original')return canvas;
  const image=ctx.getImageData(0,0,canvas.width,canvas.height),data=image.data;
  const luminance=new Uint8Array(canvas.width*canvas.height);
  const histogram=new Uint32Array(256);
  for(let j=0,i=0;i<data.length;i+=4,j++){
   const gray=Math.round(.299*data[i]+.587*data[i+1]+.114*data[i+2]);
   luminance[j]=gray;histogram[gray]++;
  }
  // Otsu threshold learns the photo's brightness without assuming ink color.
  let sum=0,total=luminance.length;for(let i=0;i<256;i++)sum+=i*histogram[i];
  let background=0,lower=0,best=-1,threshold=135;
  for(let i=0;i<256;i++){
   background+=histogram[i];if(!background)continue;
   const upper=total-background;if(!upper)break;
   lower+=i*histogram[i];
   const contrast=sum-lower;
   const separation=Math.pow(lower/background-contrast/upper,2)*background*upper;
   if(separation>best){best=separation;threshold=i}
  }
  for(let j=0,i=0;i<data.length;i+=4,j++){
   const value=variant==='binary'
    ?(luminance[j]<=threshold?0:255)
    :Math.max(0,Math.min(255,Math.round((luminance[j]-128)*1.75+128)));
   data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
  }
  ctx.putImageData(image,0,0);
  return canvas;
 }finally{bitmap.close()}
}
function selectedDigitReading(result){
 const raw=String(result?.data?.text||'').trim();
 // Selected-area mode must contain one isolated 4–8 digit serial.
 // Reject multiple numbers, dates and OCR guesses with missing characters.
 const items=extract(raw,true).filter(v=>/^\d{4,8}$/.test(v));
 return items.length===1?items[0]:null;
}
async function scanSelectedDigits(file,expected){
 const specs=[
  {name:'original',mode:7},
  {name:'grayscale',mode:7},
  {name:'binary',mode:7},
  {name:'grayscale-single-word',mode:8}
 ];
 const images=new Map(),readings=[];
 for(const spec of specs){
  const imageName=spec.name.split('-')[0];
  if(!images.has(imageName))images.set(imageName,await digitImage(file,imageName));
  const result=await window.Tesseract.recognize(images.get(imageName),'eng',{
   logger:()=>{},tessedit_pageseg_mode:spec.mode,
   tessedit_char_whitelist:'0123456789'
  });
  const number=selectedDigitReading(result);
  if(number)readings.push({variant:spec.name,raw:number,value:normalize(number)});
 }
 const groups=new Map();
 for(const item of readings)groups.set(item.value,(groups.get(item.value)||[]).concat(item));
 const matching=groups.get(expected)||[];
 const competing=[...groups.entries()].filter(([value,items])=>value!==expected&&items.length>=2);
 const visible=readings.map(r=>r.variant+': '+r.raw).join(' · ');
 // Never trust one guessed number or break a tie using the expected number.
 if(matching.length>=2&&competing.length===0){
  return {status:'match',scanned:matching[0].raw,
   candidates:[...new Set(readings.map(r=>r.raw))],
   message:'Selected number verified by multiple scans. '+visible};
 }
 return {status:'unclear',scanned:'',candidates:[...new Set(readings.map(r=>r.raw))],
  message:readings.length
   ?'OCR readings: '+visible+'. Cannot verify confidently; adjust the selection or use authorized administrator review.'
   :'Could not isolate a complete invoice number. Adjust the box to include all digits with a little margin, or request administrator review.'};
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
  // The automatic scan uses the SAME number-only OCR as the manually
  // selected default box, rather than a separate permissive header reader.
  // Different invoice layouts can still use manually adjusted selections.
  if(!options.numberOnly){
   try{
    const bitmap=await createImageBitmap(file);
    const attempts=[];
    // Photos vary in how much of the book's top edge is visible.
    // Try the proven upper serial box first, then a lower serial position;
    // both use the exact same four-pass isolated-digits recognizer.
    const regions=[
     {x:.70,y:.025,w:.23,h:.075},
     {x:.70,y:.095,w:.25,h:.065}
    ];
    try{
     for(const region of regions){
      const x=Math.round(bitmap.width*region.x),y=Math.round(bitmap.height*region.y);
      const w=Math.max(1,Math.min(bitmap.width-x,Math.round(bitmap.width*region.w)));
      const h=Math.max(1,Math.min(bitmap.height-y,Math.round(bitmap.height*region.h)));
      const crop=document.createElement('canvas');
      crop.width=w*2;crop.height=h*2;
      const ctx=crop.getContext('2d');
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      ctx.drawImage(bitmap,x,y,w,h,0,0,crop.width,crop.height);
      const blob=await new Promise(resolve=>crop.toBlob(resolve,'image/png'));
      if(!blob)continue;
      const result=await scanSelectedDigits(new File([blob],'auto-invoice-number.png',{type:'image/png'}),normalizedExpected);
      if(result.status==='match')
       return {...result,message:'Automatic number-area scan verified. '+result.message};
      attempts.push(result);
     }
    }finally{bitmap.close()}
    return {status:'unclear',scanned:'',candidates:[...new Set(attempts.flatMap(r=>r.candidates||[]))],
     message:'Automatic number-area scan could not confirm the number. Select & Scan Number Area and adjust the box around only the printed digits.'};
   }catch(error){
    console.warn('Automatic number crop:',error);
    return {status:'unclear',scanned:'',candidates:[],
     message:'Automatic number scan unavailable. Select & Scan Number Area or request administrator review.'};
   }
  }
  if(options.numberOnly){
   try{return await scanSelectedDigits(file,normalizedExpected)}
   catch(error){
    console.warn('Selected digits OCR:',error);
    return {status:'unclear',scanned:'',candidates:[],
     message:'Selected digits could not be verified. Retake the photo or request administrator review.'};
   }
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