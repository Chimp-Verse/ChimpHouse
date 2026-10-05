import sharp from 'sharp';
const [,, src, out, x0, y0, w, h, ox, oy, scale] = process.argv;
const X0=+x0, Y0=+y0, W=+w, H=+h, OX=+ox, OY=+oy, S=+scale; // origin px (OX,OY) => (0,0) m ; S m/px
let lines = '';
// metre grid every 1 m, labelled every 2 m
const toPx = (m) => m / S;
for (let mx = -30; mx <= 30; mx++) {
  const px = OX + toPx(mx) - X0; if (px < 0 || px > W) continue;
  const major = mx % 5 === 0;
  lines += `<line x1="${px}" y1="0" x2="${px}" y2="${H}" stroke="${major?'#f00':'#00f'}" stroke-opacity="${major?0.8:0.35}" stroke-width="${major?1.5:0.7}"/>`;
  if (mx % 2 === 0) lines += `<text x="${px+2}" y="12" font-size="11" fill="#f00" font-family="Arial">${mx}</text>`;
}
for (let mz = -10; mz <= 30; mz++) {
  const py = OY - toPx(mz) - Y0; if (py < 0 || py > H) continue;
  const major = mz % 5 === 0;
  lines += `<line x1="0" y1="${py}" x2="${W}" y2="${py}" stroke="${major?'#f00':'#00f'}" stroke-opacity="${major?0.8:0.35}" stroke-width="${major?1.5:0.7}"/>`;
  if (mz % 2 === 0) lines += `<text x="2" y="${py-2}" font-size="11" fill="#f00" font-family="Arial">${mz}</text>`;
}
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${lines}</svg>`);
const buf = await sharp(src).extract({left:X0, top:Y0, width:W, height:H}).composite([{input: svg}]).png().toBuffer();
await sharp(buf).resize({width: Math.round(W*1.6)}).toFile(out);
