// Builds chimp models and what they wear off the page's main thread (avatar/builder.ts
// sends the DNA): a model takes a second or two to mesh, an item a fraction of one,
// either of which would otherwise stop the house. Two of these run side by side, each
// building some of a chimp's parts.

import { buildAnatomy, type PartName } from "./anatomy";
import { sanitize } from "./dna";
import { buildItem } from "./items";
import { buildModel } from "./model";

type Request =
  | { id: number; kind: "body"; dna: unknown; parts?: PartName[] }
  /** an item, with where the body's fur grows (for the fur it hides) */
  | { id: number; kind: "item"; dna: unknown; item: string; fur: Partial<Record<PartName, Float32Array>> };

self.onmessage = (e: MessageEvent<Request>) => {
  const r = e.data;
  const dna = sanitize(r.dna);
  // hand the arrays over rather than copying them
  const transfer: ArrayBuffer[] = [];
  const give = (a: { buffer: ArrayBufferLike } | undefined) => a && transfer.push(a.buffer as ArrayBuffer);
  if (r.kind === "body") {
    const model = buildModel(dna, r.parts);
    for (const p of model.parts) {
      for (const a of Object.values(p.skin)) give(a as Float32Array);
      if (p.fur) for (const a of Object.values(p.fur)) give(a as Float32Array);
    }
    (self as unknown as Worker).postMessage({ id: r.id, model }, transfer);
    return;
  }
  const item = buildItem(buildAnatomy(dna), r.fur, r.item);
  if (item) {
    for (const m of item.meshes) [m.positions, m.normals, m.indices, m.bones, m.weights, m.cloth].forEach(give);
    for (const c of Object.values(item.cover)) give(c);
  }
  (self as unknown as Worker).postMessage({ id: r.id, item }, transfer);
};
