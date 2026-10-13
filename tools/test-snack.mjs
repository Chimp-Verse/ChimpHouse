// The Game Room's snack machine, CHIMP CHOMP, in a real browser against the running preview
// (npm run dev):
//   1. its parts found by role alone: the machine, 27 coils, 12 keys, the display, bin and flap
//   2. the rules and the fall as pure functions (engine/snackState.ts), run in the page: a vend
//      takes one snack, refusals, restocking, and the fall: off the tray's edge, down the shaft
//      without passing through the glass or the trays, to lie in the bin, the same every time
//   3. a visitor walks up, points at the keys and presses B then 3 with E: B3's coil turns one
//      turn, its front snack falls into the bin and the rest move up a place; points at the flap
//      and takes it (E): it's in their hand; eats it (E): bites, crumbs, gone
//   4. stepping up to the machine (E): types C5, takes the snack with Enter, which walks on
//   5. a coil sold out says so and restocks; the bin holds four before asking for them taken
//   6. with SHARED=1 only, a second visitor (a second page) sees the same stock and the same vend
// With SHOTS=1 it only takes the look's screenshots. Screenshots: captures/snack-*.png.
// Exits non-zero when a check fails.
//   URL=http://localhost:5185 node tools/test-snack.mjs
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const URL = process.env.URL ?? "http://localhost:5173";
await mkdir("captures", { recursive: true });

let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => m.type() === "error" && !/\/chimpvibe\/|403|404|530/.test(m.text()) && console.log("[browser error]", m.text().slice(0, 300)));
const ev = (fn, arg, p = page) => p.evaluate(fn, arg);
const settle = (n = 30, p = page) => ev((k) => window.__chimp.settle(k), n, p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => page.screenshot({ path: `captures/snack-${name}.png` });
const snacks = (p = page) => ev(() => window.__chimp.snacks.describe(), null, p);
const waitFor = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });

await page.goto(`${URL}/?capture=1&view=entry${process.env.SHARED ? "&quality=low" : ""}`);
await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000, polling: 200 });
await ev(() => window.__chimp.whenReady());

/** A camera `back` metres in front of the machine at height `y`, `side` metres to its right, looking at a point on it. */
const view = (back, y, side = 0, lookY = 1.0, lookSide = 0, fov = 0.9) =>
  ev(
    ([back, y, side, lookY, lookSide, fov]) => {
      const m = window.__chimp.snacks.machine();
      const [bx, by, bz] = m.base;
      const [fx, , fz] = m.front;
      // the machine's right, seen from in front of it
      const rx = -fz;
      const rz = fx;
      const x = bx + fx * back + rx * side;
      const z = bz + fz * back + rz * side;
      const tx = bx + rx * lookSide;
      const tz = bz + rz * lookSide;
      const dx = tx - x;
      const dz = tz - z;
      window.__chimp.setPose({ x, y: by + y, z, yaw: Math.atan2(dx, dz), pitch: -Math.atan2(by + lookY - (by + y), Math.hypot(dx, dz)), fov });
    },
    [back, y, side, lookY, lookSide, fov],
  );

const perf = async () => {
  await settle(90);
  return ev(() => window.__chimp.info());
};

if (process.env.SHOTS) {
  await view(2.5, 1.62, 0.3, 1.15, 0, 0.95);
  const p = await perf();
  // and with the machine's own meshes hidden (the materials it brought, and what the engine builds), for the cost of it
  const mine = (on) =>
    ev((on) => {
      for (const m of window.__chimp.scene.meshes) {
        const md = m.metadata;
        if (!md) continue;
        if (/^snack|^arcadeWhiteKey/.test(md.matKey ?? "") || /^snack-/.test(md.role ?? "") || /Snack machine/.test(m.name)) m.setEnabled(on);
      }
    }, on);
  await mine(false);
  const q = await perf();
  await mine(true);
  console.log(`at the machine: ${p.fps} fps, ${p.drawCalls} draw calls; with it hidden: ${q.fps} fps, ${q.drawCalls} draw calls`);
  await shot("look");
  await view(1.15, 1.35, 0.05, 1.15, -0.02, 0.75);
  await settle();
  await shot("closeup");
  await view(0.75, 1.0, 0.25, 0.95, 0.15, 0.7);
  await settle();
  await shot("keypad");
  await view(1.9, 1.75, -1.4, 1.2, 0.0, 0.85);
  await settle();
  await shot("side");
  await view(1.0, 2.25, 0.4, 2.12, 0.27, 0.6);
  await settle();
  await shot("mascot");
  await ev(() => window.__chimp.setNight(true));
  await view(2.5, 1.62, 0.3, 1.15, 0, 0.95);
  await settle(60);
  await shot("night");
  await browser.close();
  process.exit(0);
}

// ------------------------------------------------ 1. the parts, by role
const parts = await ev(() => {
  const s = window.__chimp.scene;
  const n = (role) => s.meshes.concat(s.transformNodes).filter((m) => m.metadata?.role === role).length;
  return { machine: n("snack-machine"), coils: n("snack-coil"), keys: n("snack-key"), display: n("snack-display"), bin: n("snack-bin"), flap: n("snack-flap") };
});
check(parts.machine === 1 && parts.coils === 27 && parts.keys === 12 && parts.display === 1 && parts.bin === 1 && parts.flap === 1, "the machine, 27 coils, 12 keys, the display, bin and flap carry their roles", JSON.stringify(parts));
const kinds = await ev(() => {
  const s = window.__chimp.scene;
  const built = s.meshes.filter((m) => /^snack-(coils|pack)$/.test(m.metadata?.role ?? ""));
  return { built: built.length, moving: built.every((m) => m.metadata.kind === "moving"), flap: s.meshes.find((m) => m.metadata?.role === "snack-flap")?.metadata.kind };
});
check(kinds.built === 12 && kinds.moving && kinds.flap === "special", "what the engine builds is kind moving (the coils and 11 brands' packs); the flap the room builds is special", JSON.stringify(kinds));

// ------------------------------------------------ 2. the rules and the fall
const rules = await ev(async () => {
  const R = await import("/src/engine/snackState.ts");
  const shA = window.__chimp.snacks.shaft("A1");
  const shE = window.__chimp.snacks.shaft("E1");
  const out = {};
  let s = R.initialSnacks(6);
  out.full = s.stock.A1;
  s = R.vend(s, "A1", "me", 1000, () => 0);
  out.afterVend = [s.stock.A1, s.vends.length, s.vends[0].coil];
  out.busy = R.refusal(s, "B2", 1500);
  out.noSuch = R.refusal(s, "A6", 5000);
  out.ok = R.refusal(s, "B2", 5000);
  let t = { ...s, stock: { ...s.stock, C3: 1 } };
  t = R.vend(t, "C3", "me", 5000, () => 0);
  out.soldOut = [t.stock.C3, R.refusal(t, "C3", 9000), t.restock.C3];
  out.restocked = R.restock(t, t.restock.C3, 6).stock.C3;
  out.notYet = R.restock(t, t.restock.C3 - 1, 6) === t;
  let full = R.initialSnacks(6);
  for (const [i, c] of ["A1", "A2", "A3", "A4"].entries()) full = R.vend(full, c, "me", i * 5000, () => 0);
  out.binFull = R.refusal(full, "B1", 30000);
  // the fall, in a coil's frame: row A's shaft, a bag
  const sh = shA;
  const bag = { d: 0.05, h: 0.152 };
  const a = R.fallPath(bag, sh, 0);
  const b = R.fallPath(bag, sh, 0);
  out.same = JSON.stringify(a) === JSON.stringify(b);
  const last = a.frames[a.frames.length - 1];
  out.lands = [last.y - sh.floor, Math.abs(last.z), a.release + (a.frames.length - 1) * R.FALL_STEP];
  // nowhere through the glass or into the trays below: every corner stays in the shaft once below the tray
  let worst = 0;
  for (const f of a.frames) {
    const c = Math.cos(f.tip), s2 = Math.sin(f.tip);
    for (const [u, v] of [[-0.025, -0.076], [0.025, -0.076], [0.025, 0.076], [-0.025, 0.076]]) {
      const z = f.z + u * c - v * s2;
      const y = f.y + u * s2 + v * c;
      if (y < -sh.r - 0.03 && y > sh.binTop) worst = Math.max(worst, sh.front - z, z - sh.edge);
      worst = Math.max(worst, sh.floor - y);
    }
  }
  out.worst = worst;
  out.hits = a.hits.map((h) => h.what);
  // row E's box, with a pack already under it
  const box = R.fallPath({ d: 0.042, h: 0.126 }, shE, 0.04);
  const lb = box.frames[box.frames.length - 1];
  out.stacked = lb.y - shE.floor;
  return out;
});
check(rules.full === 6 && rules.afterVend.join() === "5,1,A1", "a vend takes the front snack off its coil", JSON.stringify(rules.afterVend));
check(rules.busy === "ONE MOMENT…" && rules.noSuch === "NO SUCH SNACK" && rules.ok === null, "one vend at a time, and only codes the machine has", `${rules.busy}, ${rules.noSuch}`);
check(rules.soldOut[0] === 0 && rules.soldOut[1] === "SOLD OUT" && rules.soldOut[2] === 5000 + 45000 && rules.restocked === 6 && rules.notYet, "an emptied coil is sold out until it restocks itself 45 s later", JSON.stringify(rules.soldOut));
check(rules.binFull === "PLEASE TAKE YOUR SNACKS", "the bin holds four snacks before the machine asks for them taken");
check(rules.same, "the fall is the same every time it's worked out");
check(rules.lands[0] > 0.015 && rules.lands[0] < 0.08 && rules.lands[2] < 5200, "a bag lies on the bin's floor when its fall is over", `centre ${rules.lands[0].toFixed(3)} m up, ${Math.round(rules.lands[2])} ms after the keypress`);
check(rules.worst < 0.006, "it never goes through the glass, the trays below or the floor", `worst ${(rules.worst * 1000).toFixed(1)} mm`);
check(rules.hits.includes("floor"), "it lands with a thud", rules.hits.join(","));
check(rules.stacked > 0.04 && rules.stacked < 0.11, "a snack landing on another lies on top of it", rules.stacked.toFixed(3));

// ------------------------------------------------ 3. a visitor at the machine
await ev(() => window.__chimp.snacks.setState("reset"));
const machine = await ev(() => window.__chimp.snacks.machine());
/** Turn the walker's head to look at a point (a key, the flap), as a visitor pointing at it does. */
const lookAt = (p) =>
  ev(([x, y, z]) => {
    const pose = window.__chimp.pose();
    const dx = x - pose.x, dy = y - pose.y, dz = z - pose.z;
    window.__chimp.setPose({ ...pose, yaw: Math.atan2(dx, dz), pitch: Math.atan2(-dy, Math.hypot(dx, dz)) });
  }, p);
const frames = (n = 4) => ev((n) => new Promise((done) => { let k = 0; const tick = () => (++k >= n ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }), n);
const standAt = async (back) => {
  await ev(() => window.__chimp.setWalking(false));
  await view(back, 1.6, 0.05, 1.2);
  await ev(() => window.__chimp.setWalking(true));
  await frames(6);
};
await standAt(0.75);
check(await ev(() => window.__chimp.state().walking), "walking in front of the machine");
let st = await ev(() => window.__chimp.state().snackPrompt);
check(st?.action === "use", "walking up to it offers it: E steps up to the machine", JSON.stringify(st));
const places = await ev(() => window.__chimp.snacks.places());
const pressByPointing = async (label) => {
  await lookAt(places.keys[label]);
  await frames();
  const p = await ev(() => window.__chimp.state().snackPrompt);
  await page.keyboard.press("e");
  await frames(2);
  return p;
};
const before = await ev(() => window.__chimp.snacks.coilPacks("B3"));
await lookAt(places.keys.B);
await settle(4);
await shot("key-aimed");
let p1 = await pressByPointing("B");
const afterB = await snacks();
check(p1?.action === "key" && p1.label === "Press B" && afterB.entry === "B" && afterB.display[0] === "B_", "pointing at B and pressing E types B; the display asks for a number", `${JSON.stringify(p1)} → ${afterB.display.join(" / ")}`);
p1 = await pressByPointing("3");
let d = await snacks();
check(p1?.label === "Press 3" && d.vends.length === 1 && d.vends[0].coil === "B3" && d.vends[0].turning && d.display[0] === "B3 · VENDING", "then 3: B3's coil starts turning", d.display.join(" / "));
// the vend as the page draws it, frame by frame by its own clock (the page is too slow under load to sample from out here)
const samples = await ev(
  () =>
    new Promise((done) => {
      const out = [];
      const tick = () => {
        const v = window.__chimp.snacks.describe().vends[0];
        if (!v) return done(out);
        out.push({ since: v.since, fall: v.fall, packs: window.__chimp.snacks.coilPacks("B3") });
        if (v.landed) done(out);
        else requestAnimationFrame(tick);
      };
      tick();
    }),
);
const at = (a, b) => samples.find((x) => x.since >= a && x.since < b);
const pushed = at(200, 1100);
const tipping = samples.find((x) => x.fall[2] > 0.25 && x.fall[1] > -0.1);
const falling = samples.find((x) => x.fall[1] < -0.5);
check(!!pushed && pushed.fall[2] === 0 && pushed.fall[0] < 0.04 && !!tipping && !!falling && tipping.since < falling.since, "the snack is pushed along its tray, tips over the edge and falls", `${samples.length} frames: pushed at ${pushed?.fall[0].toFixed(3)} m, tipping ${tipping?.since.toFixed(0)} ms, falling ${falling?.since.toFixed(0)} ms`);
await waitFor(() => window.__chimp.snacks.describe().vends[0]?.landed, null, 8000);
d = await snacks();
const after = await ev(() => window.__chimp.snacks.coilPacks("B3"));
const midTurn = at(600, 1300)?.packs ?? [];
check(before.length === 6 && after.length === 5 && after.every((z, i) => Math.abs(z - (i + 0.5) * 0.08) < 0.002) && midTurn.some((z) => Math.abs(z / 0.08 - 0.5 - Math.round(z / 0.08 - 0.5)) > 0.1), "the coil's other snacks move up a place as it turns", `${before.join(",")} → ${after.join(",")} (mid-turn ${midTurn.join(",")})`);
// the screenshots: the stock held still at moments of that vend, seen from in front
await ev(() => window.__chimp.setWalking(false));
await view(1.15, 1.1, 0.0, 1.0, -0.1, 0.85);
for (const [ms, name] of [[800, "vend-turning"], [1450, "vend-tipping"], [1650, "vend-falling"], [1850, "vend-dropping"]]) {
  await ev((ms) => window.__chimp.snacks.pauseAt(ms), ms);
  await settle(4);
  await shot(name);
}
await ev(() => window.__chimp.snacks.pauseAt(null));
const binY = machine.base[1] + 0.19;
check(d.vends[0].landed && Math.abs(d.vends[0].world[1] - binY) < 0.08 && d.stock.B3 === 5, "it lands in the bin; B3 has one fewer", `y ${d.vends[0].world[1].toFixed(2)} vs the bin's floor ${binY.toFixed(2)}`);
check(d.display[0] === "ENJOY!", "the display says to take it", d.display.join(" / "));
await settle(10);
await shot("vend-landed");

// take it: point at the flap, E
await standAt(0.75);
await lookAt(places.flap);
await frames();
st = await ev(() => window.__chimp.state().snackPrompt);
check(st?.action === "take", "pointing at the flap offers to take the snack", JSON.stringify(st));
await page.keyboard.press("e");
await frames(4);
d = await snacks();
check(!!d.held && d.vends.length === 0 && d.flap < -0.3, "E pushes the flap and takes it out of the bin", `${JSON.stringify(d.held)}, flap ${d.flap.toFixed(2)}`);
await sleep(600);
await lookAt([machine.base[0] + machine.front[0] * 3, machine.base[1] + 1.3, machine.base[2] + machine.front[2] * 3]);
await frames(4);
d = await snacks();
st = await ev(() => window.__chimp.state());
check(d.held?.phase === "held" && st.snackHeld === "Jungle Crunch" && st.snackPrompt?.action === "eat", "it's in the visitor's hand, and E offers to eat it", `${st.snackHeld}, ${JSON.stringify(st.snackPrompt)}`);
await shot("held");
await page.keyboard.press("e");
await ev(() => window.__chimp.snacks.holdEat(1340));
await frames(3);
d = await snacks();
check(d.held?.phase === "eating" && d.held.bites === 2 && d.held.scale === 0.5 && d.crumbs > 0, "eating: at the mouth, bites taken, crumbs falling", JSON.stringify(d.held));
await shot("eating");
await ev(() => window.__chimp.snacks.holdEat(null));
await sleep(2500);
d = await snacks();
const toast = await ev(() => window.__chimp.state().toast);
check(d.held === null && !(await ev(() => window.__chimp.state().snackHeld)), "then it's gone", toast ?? "");

// ------------------------------------------------ 4. stepping up to the machine
await standAt(0.9);
await page.keyboard.press("e");
await waitFor(() => window.__chimp.state().focus?.phase === "on");
await settle(10);
await page.keyboard.press("c");
await page.keyboard.press("5");
await frames(2);
d = await snacks();
check(d.vends[0]?.coil === "C5", "at the machine, typing C then 5 sells C5", d.display.join(" / "));
await sleep(1700);
await shot("focus");
await waitFor(() => window.__chimp.snacks.describe().vends[0]?.landed, null, 8000);
await page.keyboard.press("Enter");
await frames(4);
d = await snacks();
check(d.held?.brand === "jungleCrunch" && d.vends.length === 0, "Enter takes it", JSON.stringify(d.held));
await waitFor(() => window.__chimp.state().focus === null, null, 5000);
check(await ev(() => window.__chimp.state().walking), "and walks on from the machine, snack in hand");
// leaving the room with it in hand is fine: it's still there, and can be eaten anywhere
await ev(() => window.__chimp.goTo("entry"));
await sleep(1500);
d = await snacks();
check(d.held?.phase === "held", "walking off with it keeps it in hand", JSON.stringify(d.held));
await ev(() => window.__chimp.snacks.eat());
await sleep(3000);
check((await snacks()).held === null, "and it can be eaten anywhere");

// ------------------------------------------------ 5. sold out, restock, a full bin
await ev(() => window.__chimp.setWalking(false));
await ev(() => window.__chimp.snacks.setState("reset"));
await ev(() => {
  const d = window.__chimp.snacks.describe();
  window.__chimp.snacks.setState({ stock: { ...d.stock, A2: 1 } });
});
await ev(() => window.__chimp.snacks.choose("A2"));
await waitFor(() => window.__chimp.snacks.describe().vends[0]?.landed, null, 8000);
await ev(() => window.__chimp.snacks.choose("A2"));
d = await snacks();
check(d.stock.A2 === 0 && d.display[0] === "A2 SOLD OUT" && /BACK IN \d+ S/.test(d.display[1]), "an empty coil says it's sold out, and when it's back", d.display.join(" / "));
await view(1.15, 1.35, 0.05, 1.15, -0.02, 0.75);
await settle(5);
await shot("sold-out");
await ev(() => {
  const d = window.__chimp.snacks.describe();
  window.__chimp.snacks.setState({ restock: { ...d.restock, A2: Date.now() - 1 } });
});
await sleep(1500);
check((await snacks()).stock.A2 === 6, "and the machine restocks it");
for (const c of ["B1", "B2", "D4"]) {
  await ev((c) => window.__chimp.snacks.choose(c), c);
  await sleep(1800);
}
await waitFor(() => window.__chimp.snacks.describe().vends.every((v) => v.landed), null, 8000);
await ev(() => window.__chimp.snacks.choose("E1"));
d = await snacks();
check(d.vends.length === 4 && d.display[0] === "PLEASE TAKE YOUR SNACKS", "four in the bin: the machine asks for them to be taken first", d.display.join(" / "));
await view(0.9, 0.75, 0.0, 0.3, -0.1, 0.8);
await settle(5);
await shot("bin-full");

// ------------------------------------------------ 6. a second visitor (SHARED=1 only: a second page is a second copy of the house)
if (process.env.SHARED) {
await ev(() => window.__chimp.snacks.setState("reset"));
const page2 = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page2.goto(`${URL}/?capture=1&quality=low&view=entry`);
await page2.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000, polling: 200 });
await sleep(1500);
await ev(() => window.__chimp.snacks.choose("D2"));
await sleep(600);
const other = await snacks(page2);
check(other.vends[0]?.coil === "D2" && other.vends[0].turning && other.stock.D2 === 5, "another visitor sees the same vend and the same stock", JSON.stringify(other.vends[0] ?? null));
await page2.close();
await ev(() => window.__chimp.snacks.setState("reset"));
}

await browser.close();
if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
