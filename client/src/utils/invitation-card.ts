import QRCode from 'qrcode';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 1800;

export function invitationUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' ||
      url.search || !/^#family-invite=[A-Za-z0-9_-]{43}$/.test(url.hash)) {
    throw new Error('Invalid family invitation');
  }
  return url;
}

// Integer-sized square modules, four white modules of quiet zone on every
// side, no logos or decorative damage to the actual code.
export function invitationQrRaster(value: string, maxWidth = 442) {
  const url = invitationUrl(value);
  const qr = QRCode.create(url.href, { errorCorrectionLevel: 'Q' });
  const modules = qr.modules.size;
  const scale = Math.floor(maxWidth / (modules + 8));
  if (scale < 4) throw new Error('Invitation QR is too small');
  const width = (modules + 8) * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (!qr.modules.get(row, col)) continue;
      const x = (col + 4) * scale;
      const y = (row + 4) * scale;
      for (let yy = y; yy < y + scale; yy++) {
        for (let xx = x; xx < x + scale; xx++) {
          const offset = (yy * width + xx) * 4;
          pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 16;
        }
      }
    }
  }
  return { width, pixels, scale };
}

// Only allow the current gallery's own protected derivative URLs.
export function localPhotoUrl(value: string, origin: string): string | null {
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password || url.hash) return null;
    if (!/^\/(?:thumbnails|previews)\/|^\/api\/remote-media\/\d+\/[A-Za-z0-9-]+\/(?:thumbnail|preview)$/.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

export type CardTheme = 'paper' | 'film';
interface CardInput {
  link: string;
  theme: CardTheme;
  galleryName: string;
  recipient: string;
  headline: string;
  message: string;
  instruction: string;
  action: string;
  expires: string;
  photo?: HTMLImageElement | null;
}

function drawFit(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, maxWidth: number, size: number, font: string, minSize = 28) {
  let current = size;
  ctx.font = font.replace('%', String(current));
  while (ctx.measureText(value).width > maxWidth && current > minSize) {
    ctx.font = font.replace('%', String(--current));
  }
  ctx.fillText(value, x, y, maxWidth);
}
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + word : word;
      if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; }
      else line = next;
      if (ctx.measureText(line).width > width) {
        let rest = '';
        for (const char of line) {
          if (rest && ctx.measureText(rest + char).width > width) { lines.push(rest); rest = char; }
          else rest += char;
        }
        line = rest;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}
function paragraph(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, size: number, maxLines: number, font: string, minSize = 26) {
  let current = size;
  ctx.font = font.replace('%', String(current));
  let lines = wrap(ctx, text, width);
  while (lines.length > maxLines && current > minSize) {
    ctx.font = font.replace('%', String(--current));
    lines = wrap(ctx, text, width);
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1]!;
    while (last && ctx.measureText(last + '…').width > width) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * current * 1.22));
}
function illustratedLandscape(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save(); ctx.translate(x, y); ctx.scale(w / 1000, h / 600);
  const sky = ctx.createLinearGradient(0, 0, 0, 600);
  sky.addColorStop(0, '#bacbc8'); sky.addColorStop(1, '#f6d8b1');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 1000, 600);
  ctx.fillStyle = '#fff1d1'; ctx.beginPath(); ctx.arc(735, 155, 72, 0, Math.PI * 2); ctx.fill();
  const ridge = (color: string, points: number[][]) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, 600);
    for (const [xx, yy] of points) ctx.lineTo(xx!, yy!);
    ctx.lineTo(1000, 600); ctx.closePath(); ctx.fill();
  };
  ridge('#849b99', [[0,350],[165,205],[250,275],[420,120],[585,300],[730,215],[1000,320]]);
  ridge('#496c68', [[0,400],[135,290],[330,420],[510,295],[680,405],[860,270],[1000,365]]);
  ridge('#2e514a', [[0,440],[170,408],[350,505],[640,425],[810,495],[1000,405]]);
  ctx.fillStyle = '#9dbab0'; ctx.fillRect(0, 520, 1000, 80);
  ctx.strokeStyle = '#dce3ca'; ctx.lineWidth = 3;
  for (let i=0;i<6;i++) { ctx.beginPath(); ctx.moveTo(220+i*37,535+i*9); ctx.lineTo(600+i*44,535+i*9); ctx.stroke(); }
  ctx.restore();
}

export function renderInvitationCard(canvas: HTMLCanvasElement, input: CardInput) {
  const url = invitationUrl(input.link);
  const qr = invitationQrRaster(url.href);
  canvas.width = CARD_WIDTH; canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const dark = input.theme === 'film';
  const ink = dark ? '#fff6e5' : '#26372f';
  const muted = dark ? '#d2cbbb' : '#596b60';
  const accent = dark ? '#e5b981' : '#86563d';
  ctx.fillStyle = dark ? '#252d2b' : '#f4eddf'; ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.strokeStyle = dark ? '#69756e' : '#d8cbb7'; ctx.lineWidth = 3; ctx.strokeRect(36,36,1128,1728);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = ink;
  drawFit(ctx, input.galleryName || 'Foldergram', 78, 91, 1044, 30, '600 %px system-ui, sans-serif');
  // Instant-film frame, with a softly inset image that preserves composition.
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#fffdf7'; ctx.fillRect(76, 125, 1048, 692); ctx.restore();
  const x=103, y=152, w=994, h=574;
  ctx.fillStyle='#1c2522'; ctx.fillRect(x,y,w,h);
  if (input.photo && input.photo.naturalWidth && input.photo.naturalHeight) {
    const scale = Math.min(w / input.photo.naturalWidth, h / input.photo.naturalHeight);
    const pw=input.photo.naturalWidth*scale, ph=input.photo.naturalHeight*scale;
    ctx.drawImage(input.photo,x+(w-pw)/2,y+(h-ph)/2,pw,ph);
  } else illustratedLandscape(ctx,x,y,w,h);
  ctx.fillStyle='#3a4a3f';
  drawFit(ctx,input.recipient,106,782,980,39,'italic %px Georgia, serif',24);
  ctx.fillStyle=ink;
  paragraph(ctx,input.headline,82,928,1036,76,2,'normal %px Georgia, serif',42);
  ctx.fillStyle=muted;
  paragraph(ctx,input.message,84,1134,1032,37,3,'normal %px system-ui, sans-serif',29);
  ctx.strokeStyle=dark?'#69756e':'#d2c6b2';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(83,1273);ctx.lineTo(1117,1273);ctx.stroke();
  // Keep the QR entirely inside a white, untextured panel.
  ctx.fillStyle='#fff';ctx.fillRect(82,1304,450,450);
  const image=ctx.createImageData(qr.width,qr.width); image.data.set(qr.pixels);
  ctx.putImageData(image,82+Math.floor((450-qr.width)/2),1304+Math.floor((450-qr.width)/2));
  ctx.fillStyle=accent;
  paragraph(ctx,input.action,572,1362,540,49,2,'600 %px system-ui, sans-serif',34);
  ctx.fillStyle=ink;
  paragraph(ctx,input.instruction,572,1478,540,35,4,'normal %px system-ui, sans-serif',28);
  ctx.fillStyle=muted;
  drawFit(ctx,url.hostname,572,1671,540,28,'600 %px system-ui, sans-serif',22);
  paragraph(ctx,input.expires,572,1713,540,25,2,'normal %px system-ui, sans-serif',20);
}