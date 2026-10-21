/* BIG BROTHER — Invoice Scanner V3 document enhancement.
 * Pure on-device Canvas processing; no AI, cloud requests or external assets.
 * The caller must always upload/store its ORIGINAL Blob, never this result.
 * Enhanced images are temporary previews only and are safe to discard.
 */
(function(global){
  'use strict';
  if(global.BBInvoiceEnhancerV1)return;
  const LIMIT=2400;
  const clamp=(v,min=0,max=255)=>Math.max(min,Math.min(max,v));
  // Photo color/B&W presets retain the prior V3 behavior. Document Clean
  // uses separate soft paper-tone correction at all strengths to avoid
  // artificial white backgrounds and disappearing colored handwriting.
  // All processing is temporary and never changes original audit evidence.
  const LEVELS=Object.freeze({
    natural:Object.freeze({
      color:{contrast:1.14,lift:7,shadow:.32,maxLift:28,sharp:.18,maxSharp:8},
      bw:{contrast:1.31,lift:10,shadow:.32,maxLift:35,sharp:.22,maxSharp:8},
      scan:{paperTarget:218,paperLift:.70,maxPaperLift:18,inkContrast:1.06,sharp:.11,maxSharp:5}
    }),
    clear:Object.freeze({
      color:{contrast:1.27,lift:13,shadow:.44,maxLift:38,sharp:.23,maxSharp:10},
      bw:{contrast:1.41,lift:14,shadow:.42,maxLift:44,sharp:.26,maxSharp:10},
      scan:{paperTarget:228,paperLift:.78,maxPaperLift:28,inkContrast:1.13,sharp:.15,maxSharp:6}
    }),
    strong:Object.freeze({
      color:{contrast:1.42,lift:18,shadow:.60,maxLift:52,sharp:.32,maxSharp:14},
      bw:{contrast:1.54,lift:20,shadow:.56,maxLift:55,sharp:.34,maxSharp:13},
      scan:{paperTarget:234,paperLift:.85,maxPaperLift:36,inkContrast:1.20,sharp:.17,maxSharp:7}
    })
  });

  // Kept independent of Canvas so arithmetic can be regression-tested.
  function enhancePixels(data,width,height,mode,strength='clear'){
    const bw=mode==='bw',scan=mode==='scan';
    if(mode!=='color'&&!bw&&!scan)throw new Error('Unsupported enhancement mode.');
    if(!Object.prototype.hasOwnProperty.call(LEVELS,strength))
      throw new Error('Unsupported enhancement strength.');
    const profile=LEVELS[strength][mode];
    if(!data||data.length!==width*height*4||!width||!height)
      throw new Error('Invalid image pixels.');
    const tile=Math.max(64,Math.min(126,Math.round(Math.max(width,height)/26)));
    const cols=Math.ceil(width/tile),rows=Math.ceil(height/tile);
    const averages=new Float32Array(cols*rows);
    // Background/paper brightness estimate (low-resolution grid).
    for(let gy=0;gy<rows;gy++)for(let gx=0;gx<cols;gx++){
      let sum=0,weight=0;
      const yEnd=Math.min(height,(gy+1)*tile);
      const xEnd=Math.min(width,(gx+1)*tile);
      for(let y=gy*tile;y<yEnd;y+=5)for(let x=gx*tile;x<xEnd;x+=5){
        const i=(y*width+x)*4;
        const lum=(77*data[i]+150*data[i+1]+29*data[i+2])/256;
        const w=lum>=135?1:.22;
        sum+=lum*w;weight+=w;
      }
      averages[gy*cols+gx]=weight?sum/weight:180;
    }
    const sorted=Array.from(averages).sort((a,b)=>a-b);
    const reference=clamp(sorted[Math.floor((sorted.length-1)*.7)]||188,142,224);
    const xIndex=new Uint16Array(width);
    const xMix=new Float32Array(width);
    for(let x=0;x<width;x++){
      const v=Math.max(0,Math.min(cols-1,x/tile-.5));
      xIndex[x]=Math.floor(v);xMix[x]=v-xIndex[x];
    }
    const result=new Uint8ClampedArray(data.length);
    const rowBrightness=new Float32Array(cols);
    const contrast=profile.contrast||1,baseLift=profile.lift||0,maxLift=profile.maxLift||0;
    const stride=width*4;
    for(let y=0;y<height;y++){
      const cellY=Math.max(0,Math.min(rows-1,y/tile-.5));
      const iy=Math.floor(cellY),fy=cellY-iy;
      const nextRow=Math.min(rows-1,iy+1);
      for(let col=0;col<cols;col++){
        const k=averages[iy*cols+col],j=averages[nextRow*cols+col];
        rowBrightness[col]=k+(j-k)*fy;
      }
      const rowOffset=y*stride;
      for(let x=0;x<width;x++){
        const cell=xIndex[x],mix=xMix[x],i=rowOffset+x*4;
        const adjacent=rowBrightness[Math.min(cols-1,cell+1)];
        const local=rowBrightness[cell]+(adjacent-rowBrightness[cell])*mix;
        const red=data[i],green=data[i+1],blue=data[i+2];
        const lum=(77*red+150*green+29*blue)/256;
        if(scan){
          // Natural document processing, not document reconstruction.
          // Earlier V3 forced every paper pixel toward pure white (255)
          // and discarded blue/red ink by converting everything to gray.
          // Instead: estimate local paper illumination, apply only a
          // bounded lift, preserve real paper texture and ink hue, and
          // gently separate handwriting from its local background.
          // Exposed highlights remain highlights; no missing data is invented.
          const desiredLift=Math.max(0,(profile.paperTarget-local)*profile.paperLift);
          const paperLift=Math.min(profile.maxPaperLift,desiredLift);
          const inkAdjusted=local+(lum-local)*profile.inkContrast;
          // Less lift for dark ink than for bright paper helps keep
          // light/fine pen strokes from fading under shadow correction.
          const corrected=inkAdjusted+paperLift*(.27+.73*lum/255);
          const delta=corrected-lum;
          result[i]=red+delta;
          result[i+1]=green+delta;
          result[i+2]=blue+delta;
        }else{
          let shadow=(reference-local)*profile.shadow;
          if(shadow<0)shadow=0;else if(shadow>maxLift)shadow=maxLift;
          const corrected=(lum-125)*contrast+125+baseLift+
            shadow*(.24+.76*lum/255);
          if(bw){
            result[i]=result[i+1]=result[i+2]=corrected;
          }else{
            result[i]=corrected+(red-lum)*.93;
            result[i+1]=corrected+(green-lum)*.93;
            result[i+2]=corrected+(blue-lum)*.93;
          }
        }
        result[i+3]=data[i+3];
      }
    }
    // One luminance-edge pass: conservative sharpening without adding
    // synthetic letters/numbers; cap ringing at eight levels.
    if(width>=3&&height>=3){
      const previous=result.slice();
      for(let y=1;y<height-1;y++){
        const row=y*stride;
        for(let x=1;x<width-1;x++){
          const i=row+x*4;
          const avg=(previous[i-3]+previous[i+5]+
            previous[i-stride+1]+previous[i+stride+1])*.25;
          let edge=(previous[i+1]-avg)*profile.sharp;
          if(edge>profile.maxSharp)edge=profile.maxSharp;
          else if(edge< -profile.maxSharp)edge=-profile.maxSharp;
          result[i]=previous[i]+edge;
          result[i+1]=previous[i+1]+edge;
          result[i+2]=previous[i+2]+edge;
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

  async function enhance(blob,mode='color',strength='clear'){
    if(!['color','bw','scan'].includes(mode))throw new Error('Unsupported enhancement mode.');
    if(!Object.prototype.hasOwnProperty.call(LEVELS,strength))
      throw new Error('Unsupported enhancement strength.');
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
      pixels.data.set(enhancePixels(pixels.data,width,height,mode,strength));
      ctx.putImageData(pixels,0,0);
      const output=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.92));
      if(!output)throw new Error('Unable to generate enhanced preview.');
      canvas.width=canvas.height=0;
      pixels=null;
      return {blob:output,width,height,mode,strength};
    }finally{decoded.dispose()}
  }

  global.BBInvoiceEnhancerV1=Object.freeze({enhance,enhancePixels,levels:Object.freeze(['natural','clear','strong'])});
})(window);
