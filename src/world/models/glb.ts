// A small reader for the .glb models the house shows (public/models/): their meshes,
// materials and embedded images as plain data, for props to add to the house's own
// merged meshes like any other piece. Handles what those files use: triangle lists,
// float positions, normals and UVs, indexed or not, images inside the file; anything
// else (compressed meshes, skins, animation) is refused so the prop can fall back.

/** One part of a mesh drawn with one material, in the file's own space (glTF: right-handed, +Y up, metres). */
export interface GlbPrimitive {
  material: number;
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array | null;
  idx: Uint32Array;
}

/** A named object of the file (a node with a mesh), its primitives already in the file's world space. */
export interface GlbPart {
  name: string;
  prims: GlbPrimitive[];
}

/** The glTF material fields the house reads. */
export interface GlbMaterial {
  name: string;
  color: [number, number, number, number];
  metal: number;
  rough: number;
  /** image index of the base colour texture */
  tex: number | null;
  emissive: [number, number, number] | null;
  emissiveStrength: number;
  blend: boolean;
  clearcoat: number;
}

export interface GlbModel {
  parts: GlbPart[];
  materials: GlbMaterial[];
  images: Blob[];
}

interface Json {
  nodes?: { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  scenes?: { nodes: number[] }[];
  scene?: number;
  meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  materials?: {
    name?: string;
    alphaMode?: string;
    emissiveFactor?: number[];
    pbrMetallicRoughness?: { baseColorFactor?: number[]; metallicFactor?: number; roughnessFactor?: number; baseColorTexture?: { index: number } };
    extensions?: Record<string, Record<string, number>>;
  }[];
  textures?: { source?: number }[];
  images?: { bufferView?: number; mimeType?: string }[];
  extensionsRequired?: string[];
}

const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Fetch and read a .glb; throws when the file is missing, isn't a .glb (a Git LFS pointer) or uses what this reader doesn't. */
export async function loadGlb(url: string): Promise<GlbModel> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return parseGlb(await res.arrayBuffer());
}

export function parseGlb(data: ArrayBuffer): GlbModel {
  const dv = new DataView(data);
  if (data.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) throw new Error("not a glTF 2.0 binary");
  let json: Json | null = null;
  let bin: Uint8Array | null = null;
  for (let at = 12; at + 8 <= data.byteLength; ) {
    const len = dv.getUint32(at, true);
    const type = dv.getUint32(at + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, at + 8, len))) as Json;
    else if (type === 0x004e4942) bin = new Uint8Array(data, at + 8, len);
    at += 8 + len;
  }
  if (!json || !bin) throw new Error("glb without JSON or BIN chunk");
  if (json.extensionsRequired?.length) throw new Error(`glb needs ${json.extensionsRequired.join(", ")}`);
  const J = json;
  const B = bin;

  const view = (i: number) => {
    const bv = J.bufferViews![i];
    return { bytes: B.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength), stride: bv.byteStride ?? 0 };
  };
  /** An accessor's values as floats (or index integers), stride and offset honoured. */
  const read = (i: number): number[] => {
    const a = J.accessors![i];
    const n = SIZE[a.type];
    const out: number[] = new Array(a.count * n);
    if (a.bufferView == null) return out.fill(0);
    const { bytes, stride } = view(a.bufferView);
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const comp = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 || a.componentType === 5122 ? 2 : 1;
    const step = stride || comp * n;
    const base = a.byteOffset ?? 0;
    for (let k = 0; k < a.count; k++)
      for (let c = 0; c < n; c++) {
        const o = base + k * step + c * comp;
        let v: number;
        switch (a.componentType) {
          case 5126: v = d.getFloat32(o, true); break;
          case 5125: v = d.getUint32(o, true); break;
          case 5123: v = d.getUint16(o, true); if (a.normalized) v /= 65535; break;
          case 5122: v = d.getInt16(o, true); if (a.normalized) v = Math.max(v / 32767, -1); break;
          case 5121: v = d.getUint8(o); if (a.normalized) v /= 255; break;
          case 5120: v = d.getInt8(o); if (a.normalized) v = Math.max(v / 127, -1); break;
          default: throw new Error(`glb accessor type ${a.componentType}`);
        }
        out[k * n + c] = v;
      }
    return out;
  };

  const parts: GlbPart[] = [];
  const visit = (ni: number, parent: number[]) => {
    const node = J.nodes![ni];
    const world = mul(parent, local(node));
    if (node.mesh != null) {
      const mesh = J.meshes![node.mesh];
      const normalM = normalMatrix(world);
      const prims: GlbPrimitive[] = [];
      for (const p of mesh.primitives) {
        if ((p.mode ?? 4) !== 4) continue;
        if (p.attributes.POSITION == null || p.attributes.NORMAL == null) throw new Error(`glb mesh ${mesh.name} needs positions and normals`);
        const P = read(p.attributes.POSITION);
        const N = read(p.attributes.NORMAL);
        const count = P.length / 3;
        const pos = new Float32Array(P.length);
        const nrm = new Float32Array(N.length);
        for (let k = 0; k < count; k++) {
          const [x, y, z] = [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]];
          pos[k * 3] = world[0] * x + world[4] * y + world[8] * z + world[12];
          pos[k * 3 + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
          pos[k * 3 + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
          const [a, b, c] = [N[k * 3], N[k * 3 + 1], N[k * 3 + 2]];
          const nx = normalM[0] * a + normalM[3] * b + normalM[6] * c;
          const ny = normalM[1] * a + normalM[4] * b + normalM[7] * c;
          const nz = normalM[2] * a + normalM[5] * b + normalM[8] * c;
          const l = Math.hypot(nx, ny, nz) || 1;
          nrm[k * 3] = nx / l;
          nrm[k * 3 + 1] = ny / l;
          nrm[k * 3 + 2] = nz / l;
        }
        const uv = p.attributes.TEXCOORD_0 != null ? new Float32Array(read(p.attributes.TEXCOORD_0)) : null;
        const idx = p.indices != null ? new Uint32Array(read(p.indices)) : Uint32Array.from({ length: count }, (_, k) => k);
        prims.push({ material: p.material ?? -1, pos, nrm, uv, idx });
      }
      parts.push({ name: node.name ?? mesh.name ?? `mesh ${node.mesh}`, prims });
    }
    for (const c of node.children ?? []) visit(c, world);
  };
  const roots = J.scenes?.[J.scene ?? 0]?.nodes ?? (J.nodes ?? []).map((_, i) => i);
  for (const r of roots) visit(r, IDENTITY);

  const materials: GlbMaterial[] = (J.materials ?? []).map((m, i) => {
    const pbr = m.pbrMetallicRoughness ?? {};
    const c = pbr.baseColorFactor ?? [1, 1, 1, 1];
    const e = m.emissiveFactor;
    const tex = pbr.baseColorTexture ? (J.textures?.[pbr.baseColorTexture.index]?.source ?? null) : null;
    return {
      name: m.name ?? `material ${i}`,
      color: [c[0], c[1], c[2], c[3] ?? 1],
      metal: pbr.metallicFactor ?? 1,
      rough: pbr.roughnessFactor ?? 1,
      tex,
      emissive: e && (e[0] > 0 || e[1] > 0 || e[2] > 0) ? [e[0], e[1], e[2]] : null,
      emissiveStrength: m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1,
      blend: m.alphaMode === "BLEND",
      clearcoat: m.extensions?.KHR_materials_clearcoat?.clearcoatFactor ?? 0,
    };
  });
  const images = (J.images ?? []).map((im) => {
    if (im.bufferView == null) throw new Error("glb image outside the file");
    return new Blob([view(im.bufferView).bytes.slice()], { type: im.mimeType ?? "image/png" });
  });
  return { parts, materials, images };
}

// ----------------------------------------------------------- column-major 4x4 matrices, as glTF stores them

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function local(n: { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }): number[] {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function mul(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

/**
 * Inverse transpose of the upper 3x3, column-major, for normals: for columns a, b, c
 * its columns are b × c, c × a and a × b over the determinant.
 */
function normalMatrix(m: number[]): number[] {
  const a = [m[0], m[1], m[2]];
  const b = [m[4], m[5], m[6]];
  const c = [m[8], m[9], m[10]];
  const cross = (u: number[], v: number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const bc = cross(b, c);
  const det = a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2] || 1;
  return [...bc, ...cross(c, a), ...cross(a, b)].map((v) => v / det);
}
