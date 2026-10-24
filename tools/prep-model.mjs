// Prepare a .glb someone shared for the house: shrink its embedded textures and write a copy.
//   node tools/prep-model.mjs <in.glb> <out.glb> [--texture 1024]
// The geometry, materials and names are kept as they are; only images larger than
// --texture pixels on a side are scaled down (PNG stays PNG, JPEG stays JPEG). The
// file is only read as data: nothing in it is run.
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const args = process.argv.slice(2);
const flag = args.indexOf("--texture");
const maxTex = flag >= 0 ? Number(args.splice(flag, 2)[1]) : 1024;
const [inPath, outPath] = args;
if (!inPath || !outPath || !(maxTex > 0)) {
  console.error("usage: node tools/prep-model.mjs <in.glb> <out.glb> [--texture 1024]");
  process.exit(1);
}

const buf = readFileSync(inPath);
if (buf.readUInt32LE(0) !== 0x46546c67 || buf.readUInt32LE(4) !== 2) throw new Error(`${inPath} is not a glTF 2.0 binary`);
let at = 12;
let json = null;
let bin = null;
while (at < buf.length) {
  const len = buf.readUInt32LE(at);
  const type = buf.readUInt32LE(at + 4);
  const body = buf.subarray(at + 8, at + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(body.toString("utf8"));
  else if (type === 0x004e4942) bin = body;
  at += 8 + len;
}
if (!json || !bin) throw new Error("missing JSON or BIN chunk");
if (json.extensionsRequired?.length) console.warn("extensions required:", json.extensionsRequired.join(", "));

// new contents for the image buffer views
const replace = new Map();
for (const im of json.images ?? []) {
  if (im.bufferView == null) continue;
  const bv = json.bufferViews[im.bufferView];
  const data = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  const meta = await sharp(data).metadata();
  if (Math.max(meta.width, meta.height) <= maxTex) continue;
  const img = sharp(data).resize({ width: maxTex, height: maxTex, fit: "inside" });
  const out = im.mimeType === "image/jpeg" ? await img.jpeg({ quality: 88 }).toBuffer() : await img.png({ compressionLevel: 9, palette: false }).toBuffer();
  console.log(`${im.name ?? im.bufferView}: ${meta.width}x${meta.height} ${(data.length / 1024).toFixed(0)} KB -> ${maxTex} ${(out.length / 1024).toFixed(0)} KB`);
  replace.set(im.bufferView, out);
}

// rebuild the binary chunk, every view 4-byte aligned
const parts = [];
let offset = 0;
json.bufferViews.forEach((bv, i) => {
  const data = replace.get(i) ?? bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  const pad = (4 - (offset % 4)) % 4;
  if (pad) parts.push(Buffer.alloc(pad));
  offset += pad;
  bv.byteOffset = offset;
  bv.byteLength = data.length;
  parts.push(data);
  offset += data.length;
});
const tail = (4 - (offset % 4)) % 4;
if (tail) parts.push(Buffer.alloc(tail));
const newBin = Buffer.concat(parts);
json.buffers = [{ byteLength: newBin.length }];

let jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + newBin.length, 8);
const chunk = (type, body) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(body.length, 0);
  h.writeUInt32LE(type, 4);
  return Buffer.concat([h, body]);
};
writeFileSync(outPath, Buffer.concat([header, chunk(0x4e4f534a, jsonBuf), chunk(0x004e4942, newBin)]));
console.log(`${outPath}: ${(buf.length / 1e6).toFixed(2)} MB -> ${((12 + 16 + jsonBuf.length + newBin.length) / 1e6).toFixed(2)} MB`);
