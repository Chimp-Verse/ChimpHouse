// Chimp models and what they wear, on request: built in two workers side by side
// (avatar/build.worker.ts), each making some of a chimp's parts, and kept, a body by
// its DNA's geometry key and an item by that and its id, so chimps shaped alike, and a
// chimp whose colours, height or other clothes change, never wait for a second build.

import { type ChimpDna, geometryKey } from "./dna";
import { type PartName, buildAnatomy } from "./anatomy";
import { type ItemModel, buildItem } from "./items";
import { type ChimpModel, buildModel } from "./model";

const KEEP = 12;
/** Which parts each worker builds: about half the work each (the face and fingers are the finest). */
const SHARES: PartName[][] = [
  ["body", "handL", "footL"],
  ["head", "handR", "footR"],
];
const ORDER: PartName[] = ["body", "head", "handL", "handR", "footL", "footR"];

const bodies = new Map<string, Promise<ChimpModel>>();
const items = new Map<string, Promise<ItemModel | null>>();
let pool: Worker[] | null | undefined;
let next = 0;
let seq = 0;
const waiting = new Map<number, (m: unknown) => void>();

function workers(): Worker[] | null {
  if (pool !== undefined) return pool;
  try {
    pool = SHARES.map(() => {
      const w = new Worker(new URL("./build.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<{ id: number; model?: ChimpModel; item?: ItemModel | null }>) => {
        waiting.get(e.data.id)?.(e.data.model ?? e.data.item ?? null);
        waiting.delete(e.data.id);
      };
      w.onerror = (e) => console.warn("[chimp] a model worker failed:", e.message);
      return w;
    });
  } catch {
    pool = null;
  }
  return pool;
}

function ask<T>(w: Worker, msg: object): Promise<T> {
  return new Promise<T>((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve as (m: unknown) => void);
    w.postMessage({ id, ...msg });
  });
}

/** Keep a promise by key, most recently used last, at most KEEP of them. */
function kept<T>(map: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  const hit = map.get(key);
  if (hit) {
    map.delete(key);
    map.set(key, hit);
    return hit;
  }
  const p = make();
  map.set(key, p);
  while (map.size > KEEP) map.delete(map.keys().next().value!);
  return p;
}

/** The model for a chimp's shape: from what's kept, or built (by the workers where there are some). */
export function chimpModel(dna: ChimpDna): Promise<ChimpModel> {
  return kept(bodies, geometryKey(dna), () => {
    const ws = workers();
    if (!ws) return Promise.resolve().then(() => buildModel(dna));
    return Promise.all(SHARES.map((parts, i) => ask<ChimpModel>(ws[i], { kind: "body", dna, parts }))).then((halves) => ({
      rig: halves[0].rig,
      parts: halves.flatMap((h) => h.parts).sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name)),
      timing: Object.assign({}, ...halves.map((h) => h.timing)),
    }));
  });
}

/** An item made for a chimp's shape, worn over the clothes `over` names (null for an item that doesn't exist). */
export function itemModel(dna: ChimpDna, id: string, over: string[] = []): Promise<ItemModel | null> {
  return kept(items, `${geometryKey(dna)}|${id}|${over.join(",")}`, () =>
    chimpModel(dna).then((m) => {
      // where the body's fur grows, for the fur the item hides
      const fur: Partial<Record<PartName, Float32Array>> = {};
      for (const p of m.parts) if (p.fur) fur[p.name] = p.fur.positions;
      const ws = workers();
      if (!ws) return buildItem(buildAnatomy(dna), fur, id, over);
      return ask<ItemModel | null>(ws[next++ % ws.length], { kind: "item", dna, item: id, fur, over });
    }),
  );
}
