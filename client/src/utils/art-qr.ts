import QRCode from 'qrcode';
import jsQR from 'jsqr';

type Artwork = HTMLImageElement | null | undefined;

// All reserved patterns stay intact except the stylistically rounded finder
// frames. The optional inset occupies only a small, function-pattern-free area.
function chooseInset(matrix: ReturnType<typeof QRCode.create>['modules']) {
  const n=matrix.size;
  const width=Math.min(17,Math.floor(n*.30)|1);
  const height=Math.min(9,Math.floor(n*.17)|1);
  if(width<9||height<5)return null;
  let best:{x:number;y:number;score:number}|null=null;
  for(let y=8;y+height<n-8;y++)for(let x=8;x+width<n-8;x++){
    let free=true;
    for(let r=y;r<y+height&&free;r++)for(let c=x;c<x+width;c++){
      if(matrix.isReserved(r,c)){free=false;break;}
    }
    if(!free)continue;
    const dx=x+width/2-n/2,dy=y+height/2-n/2;
    const score=dx*dx*1.6+dy*dy;
    if(!best||score<best.score)best={x,y,score};
  }
  return best?{x:best.x,y:best.y,width,height}:null;
}
function cover(ctx:CanvasRenderingContext2D,image:HTMLImageElement,x:number,y:number,w:number,h:number){
  const scale=Math.max(w/image.naturalWidth,h/image.naturalHeight);
  const sw=w/scale,sh=h/scale;
  ctx.drawImage(image,(image.naturalWidth-sw)/2,(image.naturalHeight-sh)/2,sw,sh,x,y,w,h);
}
function rounded(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number|number[]){
  ctx.beginPath();
  if(typeof ctx.roundRect==='function')ctx.roundRect(x,y,w,h,r);
  else ctx.rect(x,y,w,h);
  ctx.fill();
}
function readable(canvas:HTMLCanvasElement,expected:string){
  const context=canvas.getContext('2d',{willReadFrequently:true})!;
  const data=context.getImageData(0,0,canvas.width,canvas.height);
  if(jsQR(data.data,data.width,data.height,{inversionAttempts:'dontInvert'})?.data!==expected)return false;
  // Check at a much smaller camera-like sampling resolution as well.
  const small=document.createElement('canvas');
  small.width=small.height=384;
  const s=small.getContext('2d',{willReadFrequently:true})!;
  s.drawImage(canvas,0,0,384,384);
  const reduced=s.getImageData(0,0,384,384);
  return jsQR(reduced.data,384,384,{inversionAttempts:'dontInvert'})?.data===expected;
}

export function createArtQr(link:string,art:Artwork, maxWidth=928){
  const matrix=QRCode.create(link,{errorCorrectionLevel:'H'}).modules;
  const n=matrix.size;
  const scale=Math.floor(maxWidth/(n+8));
  if(scale<5)throw new Error('QR too small');
  const width=(n+8)*scale;
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=width;
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
  const margin=4*scale;
  const finder=(r:number,c:number)=> (r<7&&c<7)||(r<7&&c>=n-7)||(r>=n-7&&c<7);
  const on=(r:number,c:number)=>r>=0&&c>=0&&r<n&&c<n&&!!matrix.get(r,c);
  // Art is also part of the QR field: pale watercolor in light cells and
  // darker sampled pigments in ink cells. Keep the entire quiet zone clear.
  const bandStart=Math.floor(n*.50);
  const sample=document.createElement('canvas');
  sample.width=sample.height=n;
  const sampleContext=sample.getContext('2d',{willReadFrequently:true})!;
  let colors:Uint8ClampedArray|null=null;
  if(art?.naturalWidth&&art.naturalHeight){
    cover(sampleContext,art,0,bandStart,n,n-bandStart);
    colors=sampleContext.getImageData(0,0,n,n).data;
  }
  function paint(soft:boolean,badge:boolean,texture:boolean){
    ctx.fillStyle='#fffdf6';ctx.fillRect(0,0,width,width);
    if(texture&&colors&&art){
      ctx.save();ctx.beginPath();ctx.rect(margin,margin+bandStart*scale,n*scale,(n-bandStart)*scale);ctx.clip();
      ctx.globalAlpha=.27;
      cover(ctx,art,margin,margin+bandStart*scale,n*scale,(n-bandStart)*scale);
      ctx.restore();
    }
    // The quiet zone is untextured and lighter than every data module.
    const gradient=ctx.createLinearGradient(0,margin,width, width-margin);
    gradient.addColorStop(0,'#254d61');
    gradient.addColorStop(.46,'#244b48');
    gradient.addColorStop(1,'#203e26');
    ctx.fillStyle=gradient;
    for(let r=0;r<n;r++)for(let c=0;c<n;c++){
      const x=margin+c*scale,y=margin+r*scale;
      if(matrix.isReserved(r,c)&&!on(r,c)){
        ctx.fillStyle='#fffdf6';ctx.fillRect(x,y,scale,scale);continue;
      }
      if(!on(r,c)||(soft&&finder(r,c)))continue;
      ctx.fillStyle=gradient;
      if(texture&&colors&&r>=bandStart&&!matrix.isReserved(r,c)){
        const i=(r*n+c)*4;
        const rr=colors[i]!,gg=colors[i+1]!,bb=colors[i+2]!;
        // Keep each dark module decisively darker than its light neighbors.
        const factor=Math.min(.64,88/Math.max(rr,gg,bb,1));
        ctx.fillStyle='rgb('+Math.round(rr*factor+8)+','+Math.round(gg*factor+15)+','+Math.round(bb*factor+13)+')';
      }
      if(!soft||matrix.isReserved(r,c)){
        ctx.fillRect(x,y,scale,scale);continue;
      }
      const top=on(r-1,c),right=on(r,c+1),bottom=on(r+1,c),left=on(r,c-1);
      const radius=scale*.29;
      rounded(ctx,x,y,scale+.08,scale+.08,[
        top||left?0:radius,top||right?0:radius,bottom||right?0:radius,bottom||left?0:radius
      ]);
    }
    if(soft){
      for(const [row,col] of [[0,0],[0,n-7],[n-7,0]]){
        const x=margin+col!*scale,y=margin+row!*scale;
        ctx.fillStyle='#214431';rounded(ctx,x,y,7*scale,7*scale,scale*1.05);
        ctx.fillStyle='#fffdf6';rounded(ctx,x+scale,y+scale,5*scale,5*scale,scale*.65);
        ctx.fillStyle='#214431';rounded(ctx,x+2*scale,y+2*scale,3*scale,3*scale,scale*.43);
      }
    }
    const inset=badge&&art?.naturalWidth&&art.naturalHeight?chooseInset(matrix):null;
    if(inset&&art){
      const x=margin+inset.x*scale,y=margin+inset.y*scale,w=inset.width*scale,h=inset.height*scale;
      ctx.fillStyle='#fffdf6';ctx.fillRect(x,y,w,h);
      ctx.save();
      ctx.beginPath();ctx.rect(x+scale*.70,y+scale*.70,w-scale*1.4,h-scale*1.4);ctx.clip();
      cover(ctx,art,x+scale*.70,y+scale*.70,w-scale*1.4,h-scale*1.4);
      ctx.restore();
    }
    return !!inset;
  }
  let artworkInset=paint(true,true,true);
  if(readable(canvas,link))return {canvas,artworkInset,mode:'mosaic' as const};
  // Drop the inset first, then the styling. Never export an unverified code.
  artworkInset=false;
  paint(true,false,true);
  if(readable(canvas,link))return {canvas,artworkInset,mode:'mosaic' as const};
  paint(true,false,false);
  if(readable(canvas,link))return {canvas,artworkInset,mode:'mosaic' as const};
  paint(false,false,false);
  if(readable(canvas,link))return {canvas,artworkInset,mode:'safe' as const};
  throw new Error('QR verification failed');
}