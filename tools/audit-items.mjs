// Review how the export splits the house into items, zone by zone, and flag what looks wrong:
// pieces with no label that found no item, unlabelled pieces bigger than the item they joined,
// leaves with no plant, small things with room-sized dimensions, huge non-architectural items.
//   node tools/audit-items.mjs [zone ...]        (needs `npm run dev`; writes art/test/item-audit.txt)
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const only = process.argv.slice(2);
const SMALL = /cushion|pillow|can\b|cup|mug|glass(es)?\b|bottle|candle|book|remote|controller|headset|lamp|sconce|stool|chair|pouf|ottoman|speaker|vase|bowl|plate|jar|tray|keyboard|mouse|phone|tablet|clock|poster|towel|float|blanket|throw|bulb|knob|handle/i;
const ARCH = /wall|floor|slab|glazing|glass|roof|ceiling|deck|rail|balustrade|beam|joist|stair|step|landing|bridge|terrain|arch|rib|fascia|soffit|facade|path|stone|strip|planter|bed|curtain|shade|rug|canopy|trunk|limb|tree|pool|gutter|post|column|brace|strut|lattice|frame|screen wall|proscenium|cladding|parapet|edge|ledge|bench|bar\b|counter|shelf|shelves|bookcase|cable|rope|light strip|vine/i;

const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
await page.goto("http://localhost:5173/house.html?capture=1");
await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000 });
const rooms = await page.evaluate(async () => (await import("/src/world/layout.ts")).ROOMS.map((r) => ({ id: r.id, level: r.level })));
const roomIds = new Set(rooms.map((r) => r.id));
const others = (await page.evaluate(() => window.__chimp.zones())).filter((z) => !roomIds.has(z) && z !== "jungle" && z !== "sky");
const zones = [...rooms, ...others.map((id) => ({ id }))].filter((z) => !only.length || only.includes(z.id));

const lines = [];
let flagged = 0;
for (const z of zones) {
  const r = await page.evaluate(([id, level]) => window.__chimp.auditZone(id, level), [z.id, z.level]);
  const name = z.level ? `${z.id} (${z.level})` : z.id;
  const flags = [...r.odd];
  for (const it of r.items) {
    const big = Math.max(...it.size);
    if (/ parts$/.test(it.name)) flags.push(`"${it.name}" has no label ${JSON.stringify(it.size)} [${it.materials}]`);
    else if (SMALL.test(it.name) && !ARCH.test(it.name) && big > 2.5) flags.push(`"${it.name}" is ${JSON.stringify(it.size)} m for a small thing [${it.materials}]`);
    else if (!ARCH.test(it.name) && big > 6) flags.push(`"${it.name}" is ${JSON.stringify(it.size)} m [${it.materials}]`);
  }
  const strayJoins = Object.entries(r.joins).filter(([k]) => !k.includes("own item") && !/after "([^"]+)"\) -> "\1"/.test(k));
  lines.push(`== ${name}: ${r.items.length} items`);
  const counted = new Map();
  for (const f of flags) counted.set(f, (counted.get(f) ?? 0) + 1);
  for (const [f, n] of counted) lines.push(`  ! ${n > 1 ? `${n} x ` : ""}${f}`);
  for (const [k, n] of strayJoins) lines.push(`    ${n} unlabelled ${k}`);
  flagged += counted.size;
  lines.push(`  items: ${r.items.map((i) => `${i.name} ${i.size.join("x")}`).join(" | ")}`);
}
mkdirSync("art/test", { recursive: true });
writeFileSync("art/test/item-audit.txt", lines.join("\n") + "\n");
console.log(lines.filter((l) => !l.startsWith("  items:")).join("\n"));
console.log(`\n${zones.length} zones, ${flagged} flags. Full item lists in art/test/item-audit.txt`);
await browser.close();
