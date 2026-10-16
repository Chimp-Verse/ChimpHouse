// A light visitor (tools/chimp-visitor.html): joins the room and walks a chimp round a
// circle, saying where it is as a visitor's page does (engine/avatars.ts), so the house
// can be checked showing another visitor's chimp without opening it twice.
//   ?name=Bo  ?x= ?y= ?z= the circle's middle  ?r= its radius  ?speed= m/s
//   ?wear=cap,tee  what the chimp wears  ?still=1 standing, not walking

import { defaultDna } from "../src/avatar/dna";
import { item, itemColours } from "../src/avatar/wardrobe";
import { ME, room } from "../src/engine/room";

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.get(k) === null ? d : Number(q.get(k)));
const cx = num("x", 0);
const cy = num("y", 0);
const cz = num("z", 0);
const r = num("r", 1.4);
const speed = q.get("still") === "1" ? 0 : num("speed", 1.2);

const dna = defaultDna();
dna.colors.fur = "#5a3d2b";
dna.colors.furTips = "#b08a62";
dna.shape.height = 1.42;
for (const id of (q.get("wear") ?? "cap,tee").split(",")) {
  const def = item(id);
  if (def) dna.outfit[def.slot] = { id, colors: itemColours(def, undefined) };
}

const sayDna = room.family<{ name: string; dna: typeof dna }>("chimpdna:", () => undefined);
const sayPose = room.family<Record<string, unknown>>("chimp:", () => undefined);
sayDna({ name: ME.name, dna });
// say it again now and then: a page that opens later hears it from the room server anyway
setInterval(() => sayDna({ name: ME.name, dna }), 5000);

const start = performance.now();
setInterval(() => {
  const t = (performance.now() - start) / 1000;
  const a = (t * speed) / r;
  const x = cx + Math.cos(a) * r;
  const z = cz + Math.sin(a) * r;
  const vx = -Math.sin(a) * speed;
  const vz = Math.cos(a) * speed;
  const yaw = speed > 0 ? Math.atan2(vx, vz) : 0;
  sayPose({ walking: true, x, y: cy, z, yaw, vx, vz, ground: true, lookYaw: 0, lookPitch: 0, t: Math.round(room.now()) });
  document.getElementById("out")!.textContent = `${ME.name} (${ME.id}) at ${x.toFixed(2)}, ${z.toFixed(2)}`;
}, 100);

(window as unknown as { visitor: unknown }).visitor = { id: ME.id, name: ME.name };
