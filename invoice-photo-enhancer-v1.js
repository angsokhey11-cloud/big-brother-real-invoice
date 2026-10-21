/* BIG BROTHER — Invoice Scanner V2 document enhancement.
 * Pure on-device Canvas processing; no AI, cloud requests or external assets.
 * The caller must always upload/store its ORIGINAL Blob, never this result.
 * Enhanced images are temporary previews only and are safe to discard.
 */
(function(global){
  'use strict';
  if(global.BBInvoiceEnhancerV1)return;
  const LIMIT=2400;
  const clamp=(v,min=0,max=255)=>Math.max(min,Math.min(max,v));

  // Kept independent of Canvas so arithmetic can be regression-tested.
  function enhancePixels(data,width,height,mode){
    const bw=mode==='bw';
    if(mode!=='color'&&!bw)throw new Error('Unsupported enhancement mode.');
    if(!data||data.length!==width*height*4||!width||!height)throw new Error('Invalid image pixels.');
    const n=data.length;
    const tile=Math.max(48,Math.min(112,Math.round(Math.max(width,height)/26)));
    const cols=Math.ceil(width/tile),rows=Math.ceil(height/tile);
    const averages=new Float32Array(cols*rows);
    // Sample bright areas more heavily than handwriting so the paper/background
    // light level is estimated without treating dark text as a shadow.
    const step=4;
    for(let gy=0;gy<rows;gy++){
      for(let gx=0;gx<cols;gx++){
        let sum=0,weight=0;
        const yEnd=Math.min(height,(gy+1)*tile);
        const xEnd=Math.min(width,(gx+1)*tile);
        for(let y=gy*tile;y<yEnd;y+=step){
          for(let x=gx*tile;x<xEnd;x+=step){
            const i=(y*width+x)*4;
            const l=(77*data[i]+150*data[i+1]+29*data[i+2])/256;
            const w=l>=135?1:0.22;
            sum+=l*w;weight+=w;
          }
        }
        averages[gy*cols+gx]=weight?sum/weight:180;
      }
    }
    // 70th-percentile local brightness is the document exposure target.
    // Individual cells may be darker if the receipt is partly in shadow.
    const sorted=Array.from(averages).sort((a,b)=>a-b);
    const reference=clamp(sorted[Math.floor((sorted.length-1)*.7)]||188,142,224);
    const result=new Uint8ClampedArray(n);
    const contrast=bw?1.31:1.14;
    const baseLift=bw?10:7;
    for(let y=0;y<height;y++){
      const cellY=Math.max(0,Math.min(rows-1,y/tile-.5));
      const iy=Math.floor(cellY),fy=cellY-iy,iy2=Math.min(rows-1,iy+1);
      for(let x=0;x<width;x++){
        const cellX=Math.max(0,Math.min(cols-1,x/tile-.5));
        const ix=Math.floor(cellX),fx=cellX-ix,ix2=Math.min(cols-1,ix+1);
        const a=averages[iy*cols+ix],b=averages[iy*cols+ix2];
        const c=averages[iy2*cols+ix],d=averages[iy2*cols+ix2];
        const local=(a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy;
        const i=(y*width+x)*4;
        const red=data[i],green=data[i+1],blue=data[i+2];
        const luminance=(77*red+150*green+29*blue)/256;
        // Limit exposure lift: don't erase faint pencil, blue ink or red stamps.
        const shadowLift=clamp((reference-local)*.32,0,bw?35:28);
        const illumination=shadowLift*(.24+.76*luminance/255);
        const corrected=clamp((luminance-125)*contrast+125+baseLift+illumination);
        if(bw){
          result[i]=result[i+1]=result[i+2]=corrected;
        }else{
          // Preserve original ink hue; only slightly neutralize color casts.
          const chroma=.93;
          result[i]=clamp(corrected+(red-luminance)*chroma);
          result[i+1]=clamp(corrected+(green-luminance)*chroma);
          result[i+2]=clamp(corrected+(blue-luminance)*chroma);
        }
        result[i+3]=data[i+3];
      }
    }
    // Very mild, bounded unsharp contrast; no text, numbers or strokes invented.
    // In-place sharpening is avoided so neighbors always refer to unchanged pixels.
    if(width>=3&&height>=3){
      const previous=result.slice();
      const effect=bw?.22:.18;
      for(let y=1;y<height-1;y++){
        for(let x=1;x<width-1;x++){
          const i=(y*width+x)*4;
          for(let c=0;c<3;c++){
            const avg=(previous[i-4+c]+previous[i+4+c]+
              previous[i-width*4+c]+previous[i+width*4+c])*.25;
            const delta=clamp((previous[i+c]-avg)*effect,-9,9);
            result[i+c]=clamp(previous[i+c]+delta);
          }
        }
      }
    }
    return result;
  }

  async function decodePhoto(file){
    if(typeof createImageBitmap==='function'){
      const bitmap=await createImageBitmap(file);
      return {image:bitmap,width:bitmap.width,height:bitmap.height,
        dispose(){bitmap.close?.()}};
    }
    const objectUrl=URL.createObjectURL(file);
    try{
      const image=new Image();
      await new Promise((resolve,reject)=>{
        image.onload=resolve;image.onerror=()=>reject(new Error('Cannot decode invoice image.'));
        image.src=objectUrl;
      });
      return {image,width:image.naturalWidth,height:image.naturalHeight,dispose(){}};
    }finally{URL.revokeObjectURL(objectUrl)}
  }

  async function enhance(blob,mode='color'){
    if(!blob?.type?.startsWith('image/'))throw new Error('Select a JPG, PNG or WebP invoice photo.');
    const decoded=await decodePhoto(blob);
    try{
      const scale=Math.min(1,LIMIT/Math.max(decoded.width,decoded.height));
      const width=Math.max(1,Math.round(decoded.width*scale));
      const height=Math.max(1,Math.round(decoded.height*scale));
      // Browsers with constrained memory need a capped working image.
      const canvas=document.createElement('canvas');
      canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx)throw new Error('This browser cannot enhance images.');
      ctx.imageSmoothingEnabled=true;
      ctx.imageSmoothingQuality='high';
      ctx.drawImage(decoded.image,0,0,width,height);
      let pixels=ctx.getImageData(0,0,width,height);
      // Yield to the UI for a loading indicator before pixel processing.
      await new Promise(resolve=>setTimeout(resolve,0));
      pixels.data.set(enhancePixels(pixels.data,width,height,mode));
      ctx.putImageData(pixels,0,0);
      const output=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.92));
      if(!output)throw new Error('Unable to generate enhanced preview.');
      canvas.width=canvas.height=0;
      pixels=null;
      return {blob:output,width,height,mode};
    }finally{decoded.dispose()}
  }

  global.BBInvoiceEnhancerV1=Object.freeze({enhance,enhancePixels});
})(window);
