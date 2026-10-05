// Crop a region of an image, upscale it and overlay a pixel grid (for reading
// screen corner coordinates in the reference images).
//   node tools/px-grid.mjs "Reference Images/TheatreRoom.png" x0 y0 w h out.png [scale]
import sharp from "sharp";
const [, , src, x0s, y0s, ws, hs, out, scs] = process.argv;
const [x0, y0, w, h] = [x0s, y0s, ws, hs].map(Number);
const sc = Number(scs ?? 2);
const W = Math.round(w * sc);
const H = Math.round(h * sc);
let lines = "";
for (let x = Math.ceil(x0 / 10) * 10; x <= x0 + w; x += 10) {
  const px = (x - x0) * sc;
  const major = x % 50 === 0;
  lines += `<line x1="${px}" y1="0" x2="${px}" y2="${H}" stroke="${major ? "#ff0" : "#0ff"}" stroke-opacity="${major ? 0.9 : 0.35}" stroke-width="1"/>`;
  if (major) lines += `<text x="${px + 2}" y="12" font-size="12" fill="#ff0" stroke="#000" stroke-width="0.4" font-family="Arial">${x}</text>`;
}
for (let y = Math.ceil(y0 / 10) * 10; y <= y0 + h; y += 10) {
  const py = (y - y0) * sc;
  const major = y % 50 === 0;
  lines += `<line x1="0" y1="${py}" x2="${W}" y2="${py}" stroke="${major ? "#ff0" : "#0ff"}" stroke-opacity="${major ? 0.9 : 0.35}" stroke-width="1"/>`;
  if (major) lines += `<text x="2" y="${py - 2}" font-size="12" fill="#ff0" stroke="#000" stroke-width="0.4" font-family="Arial">${y}</text>`;
}
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${lines}</svg>`);
const buf = await sharp(src).extract({ left: x0, top: y0, width: w, height: h }).resize(W, H).png().toBuffer();
await sharp(buf).composite([{ input: svg }]).toFile(out);
