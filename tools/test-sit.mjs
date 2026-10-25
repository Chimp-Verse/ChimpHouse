// Sitting down on the house's seats, in a real browser against the running preview (npm run dev,
// with the fly-in flag: it opens a viewpoint), walking from the chimp's eyes (?pov=first):
//   1. the seats are found by role, numbered, each saying how it is sat on; every one of them is
//      offered ("E: Sit down") to a visitor who walks up to it and looks at it
//   2. E on the Game Room's sofa sits the chimp: on the seat, facing out, the eyes lowered, the
//      camera behind it still; E again gets up, and so do a walking key and Esc
//   3. a bar stool (feet on its ring), a theatre seat and a sun lounger
//   4. E's other uses come first: the theatre remotes' stand offers the remote, not a seat
//   5. another visitor (a light page: tools/chimp-visitor.html) sitting on a seat: seen sitting,
//      the seat offered as taken, sitting there refused (by the page and by the room server), and
//      freed when they leave
// Screenshots: SHOTS (default .evani/shots/sit)/sit-*.png. Exits non-zero when a check fails.
//   URL=http://localhost:5173 node tools/test-sit.mjs        (EVERY=0 skips trying every seat)
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const URL = process.env.URL ?? "http://localhost:5173";
const SHOTS = process.env.SHOTS ?? ".evani/shots/sit";
await mkdir(SHOTS, { recursive: true });

let failed = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
// headless, muted (Playwright's default), the mouse never captured
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const stop = () => browser.close().catch(() => undefined);
process.on("SIGTERM", () => void stop().then(() => process.exit(143)));
const noLocks = () => {
  Element.prototype.requestPointerLock = function () {
    return Promise.resolve();
  };
  Element.prototype.requestFullscreen = function () {
    return Promise.resolve();
  };
  if (navigator.keyboard) navigator.keyboard.lock = () => Promise.resolve();
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(noLocks);
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("console", (m) => m.type() === "error" && !/\/chimpvibe\/|403|404/.test(m.text()) && console.log("[browser error]", m.text().slice(0, 300)));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
  const settle = (n) => ev((n) => window.__chimp.settle(n), n);
  const shot = (name) => page.screenshot({ path: `${SHOTS}/sit-${name}.png` });
  const state = () => ev(() => {
    const s = window.__chimp.state();
    // every other prompt E would take now, by name
    const others = Object.entries(s).filter(([k, v]) => k.endsWith("Prompt") && k !== "seatPrompt" && v).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
    return { seated: s.seated, seatPrompt: s.seatPrompt, taken: s.seats.taken, remotePrompt: s.remotePrompt, walking: s.walking, others, focus: s.focus?.kind ?? null };
  });
  const mine = () => ev(() => window.__chimp.chimps.describe().mine);

  await page.goto(`${URL}/house.html?view=game&pov=first&name=Ann&arcade=fixture`);
  await waitFor(() => window.__chimp?.ready === true, null, 300000);
  await ev(() => window.__chimp.setWalking(true));
  await waitFor(() => !!window.__chimp.chimps.describe().mine, null, 60000);
  // every seat free, for everyone on this room server (it allows test commands, as npm run dev's does)
  await ev(() => window.__chimp.seats.reset());
  await settle(10);

  // ------------------------------------------------ 1. the seats, by role
  const all = await ev(() => window.__chimp.seats.describe().seats);
  const byKind = {};
  for (const s of all) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  const byRoom = {};
  for (const s of all) byRoom[s.room] = (byRoom[s.room] ?? 0) + 1;
  console.log(`seats: ${all.length}  by kind ${JSON.stringify(byKind)}  by room ${JSON.stringify(byRoom)}`);
  const roleNodes = await ev(() => window.__chimp.scene.transformNodes.filter((n) => n.metadata?.role === "seat").length);
  check(all.length > 100 && roleNodes === all.length, "the seats are found by role", `${all.length} seats`);
  check(new Set(all.map((s) => s.n)).size === all.length, "each has a number of its own");
  for (const k of ["sofa", "armchair", "chair", "stool", "pouf", "bench", "lounger", "daybed", "beanBag", "eggChair", "toilet"]) check(byKind[k] > 0, `seats of every kind: ${k}`, `${byKind[k] ?? 0}`);
  check(
    all.every((s) => s.info.height > 0.2 && s.info.height < 1 && Math.abs(s.at[1] - s.floor - s.info.height) < 1e-3),
    "each says how high it is over the floor its sitter's feet are on",
  );

  /**
   * Stand the walker somewhere near seat s on its floor, clear of things (in front of a seat with a
   * back; anywhere round a stool or pouf), and look at it. Returns false when there is nowhere.
   */
  const approach = (s, dist = 0.9) =>
    ev(
      ([s, dist]) => {
        const c = window.__chimp;
        const w = c.walker();
        const tries = [];
        // a seat with a back from in front of it; a backless or low-backed one from anywhere round it (engine/seats.ts openSeat)
        const open = s.info.turn || s.info.recline <= 0.12;
        const dirs = open ? Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2) : [0, 0.35, -0.35, 0.7, -0.7];
        const base = Math.atan2(s.front[0], s.front[2]);
        for (const d of [dist, dist + 0.25, dist - 0.2, dist + 0.5, dist + 0.7]) for (const a of dirs) tries.push([base + a, d]);
        for (const [a, d] of tries) {
          const x = s.at[0] + Math.sin(a) * d;
          const z = s.at[2] + Math.cos(a) * d;
          if (!w.place(x, s.floor + 0.35, z, 0.8)) continue;
          if (Math.abs(w.feet.y - s.floor) > 0.08 || Math.hypot(w.feet.x - x, w.feet.z - z) > 0.04) continue;
          return true;
        }
        return false;
      },
      [s, dist],
    );
  /** Look at seat s from the walker's eyes (where a chimp's lap would be on it). */
  const lookAt = async (s) => {
    await settle(2);
    await ev((s) => {
      const c = window.__chimp;
      const [ex, ey, ez] = c.chimps.eye().at;
      const dx = s.at[0] - ex;
      const dy = s.at[1] + 0.15 - ey;
      const dz = s.at[2] - ez;
      const p = c.pose();
      c.setPose({ ...p, yaw: Math.atan2(dx, dz), pitch: Math.atan2(-dy, Math.hypot(dx, dz)) });
    }, s);
    await settle(3);
  };

  // every seat is offered to a visitor who walks up to it and looks at it
  if (process.env.EVERY !== "0") {
    const missed = [];
    for (const s of all) {
      if (!(await approach(s))) {
        missed.push(`${s.label}: nowhere to stand near it`);
        continue;
      }
      await lookAt(s);
      const p = (await state()).seatPrompt;
      if (p?.action !== "sit" || p.seat !== s.n) missed.push(`${s.label}: ${JSON.stringify(p)}`);
    }
    check(missed.length === 0, "every seat is offered to a visitor walking up to it and looking at it", missed.length ? `${missed.length}: ${missed.slice(0, 12).join("; ")}` : `${all.length} seats`);
  }

  // ------------------------------------------------ 2. the Game Room's sofa
  const sofa = all.find((s) => s.label.startsWith("Curved console sofa") && s.kind === "sofa" && Math.abs(s.front[0]) > 0.9) ?? all.find((s) => s.label.startsWith("Curved console sofa"));
  check(!!sofa, "the Game Room's console sofa has seats", sofa?.label);
  const sitWithE = async (s, what) => {
    check(await approach(s), `walks up to ${what}`);
    await lookAt(s);
    const before = await ev(() => ({ eye: window.__chimp.chimps.eye().at, feet: window.__chimp.walker().feet.asArray() }));
    const p = (await state()).seatPrompt;
    check(p?.action === "sit" && p.seat === s.n, `looking at ${what}, E offers to sit down`, JSON.stringify(p));
    await page.keyboard.press("KeyE");
    // it walks to where it sits down from, turns round and sits
    await waitFor(() => window.__chimp.chimps.describe().mine.sitting > 0.99, null, 10000).catch(() => undefined);
    await settle(5);
    return before;
  };
  /** Getting up: until the chimp is up and has stepped clear of the seat, walking again. */
  const upAgain = () => waitFor(() => !window.__chimp.walker().seated && window.__chimp.chimps.describe().mine.sitting < 0.01, null, 8000).catch(() => undefined);
  /** Seated on s, look round until nothing but the seat takes E; returns the state then. */
  const lookFree = async (s) => {
    let st = null;
    for (const off of [0.3, -0.6, 0.9, -1.2, 1.5, -1.8, 2.2]) {
      await ev(([s, off]) => {
        const c = window.__chimp;
        c.setPose({ ...c.pose(), yaw: Math.atan2(s.front[0], s.front[2]) + off, pitch: -0.3 });
      }, [s, off]);
      await settle(4);
      st = await state();
      if (!st.others.length) break;
    }
    return st;
  };
  const seatedCheck = async (s, what, before) => {
    const st = await state();
    const m = await mine();
    const eye = await ev(() => window.__chimp.chimps.eye().at);
    check(st.seated === s.n && m.seat === s.n, `sits on ${what}`, `seated ${st.seated}`);
    const me = await ev(() => window.__chimp.tv.me().id);
    check(st.taken[String(s.n)] === me, "the seat is this visitor's in the shared state", JSON.stringify(st.taken));
    check(m.sitting > 0.98, "the chimp has sat down", m.sitting.toFixed(2));
    // its hips on the seat (against its back, shuffled forward on a deep one), its root on the seat's floor where it sat down from
    const shape = await ev((n) => window.__chimp.seats.shape(n), s.n);
    const fwd = (m.hips[0] - s.at[0]) * s.front[0] + (m.hips[2] - s.at[2]) * s.front[2];
    const side = Math.abs((m.hips[0] - s.at[0]) * s.front[2] - (m.hips[2] - s.at[2]) * s.front[0]);
    check(fwd > -shape.rear - 0.02 && fwd < shape.depth && side < 0.12 && Math.abs(m.at[1] - s.floor) < 0.02, "on the seat, its root on the seat's floor", `hips ${fwd.toFixed(2)} m ahead of the seat's place (its back ${shape.rear.toFixed(2)} behind, its edge ${shape.depth.toFixed(2)} ahead), ${side.toFixed(2)} aside`);
    const dy = m.hips[1] - s.at[1];
    check(dy > -0.02 && dy < 0.25, "its hips on the seat's top", `${dy.toFixed(3)} m over it`);
    if (!s.info.turn) {
      // the body faces the way the seat does (a lounger's sitter sat down side on, its root still facing the way it stood: its hips turned round)
      const want = Math.atan2(s.front[0], s.front[2]);
      const hips = await ev(() => {
        const q = window.__chimp.chimps.body().nodes.hips.absoluteRotationQuaternion;
        const f = { x: 2 * (q.x * q.z + q.w * q.y), z: 1 - 2 * (q.x * q.x + q.y * q.y) };
        return Math.atan2(f.x, f.z);
      });
      const off = Math.abs(Math.atan2(Math.sin(hips - want), Math.cos(hips - want)));
      check(off < 0.15, "facing the way the seat does", `${off.toFixed(3)} rad off`);
    }
    // a sitter's eyes, where reach is measured from: over the seat (on a high stool, higher than standing)
    const over = eye[1] - s.at[1];
    check(over > 0.35 && over < 0.95 && Math.abs(eye[1] - before.eye[1]) > 0.1, "its eyes (where reach is measured from) at a sitter's", `${before.eye[1].toFixed(2)} -> ${eye[1].toFixed(2)}, ${over.toFixed(2)} over the seat`);
    // looking where nothing else in reach takes E (from the Game Room's sofa, the coffee table's
    // controllers and the air hockey table do; from a theatre seat, the screen)
    const ahead = await lookFree(s);
    check(ahead.seatPrompt?.action === "stand", "looking where nothing else takes E, E offers to stand up", JSON.stringify({ seat: ahead.seatPrompt, others: ahead.others }));
    return { m, eye };
  };
  const sofaBefore = await sitWithE(sofa, "the console sofa");
  const { m: onSofa } = await seatedCheck(sofa, "the console sofa", sofaBefore);
  check(onSofa.lights.room === "gameRoom", "lit by the Game Room's lights where it sits", onSofa.lights.room);
  // the camera behind it, as ever
  await ev(() => window.__chimp.chimps.setBoom(2.3));
  await settle(30);
  const behind = await ev(() => {
    const c = window.__chimp;
    const cam = c.pose();
    const eye = c.chimps.eye().at;
    return { d: Math.hypot(cam.x - eye[0], cam.y - eye[1], cam.z - eye[2]), shown: c.chimps.describe().mine.shown };
  });
  check(behind.d > 1 && behind.shown, "the camera stays behind the seated chimp, which is drawn", `${behind.d.toFixed(2)} m`);
  // a three-quarter view, a little round from behind
  await ev((s) => {
    const c = window.__chimp;
    c.setPose({ ...c.pose(), yaw: Math.atan2(s.front[0], s.front[2]) + Math.PI - 0.6, pitch: 0.18 });
  }, sofa);
  await settle(20);
  await shot("couch");
  await ev(() => window.__chimp.chimps.setBoom(0));
  // E gets up, and steps clear of the sofa (looking where nothing else takes E)
  const before = await lookFree(sofa);
  await page.keyboard.press("KeyE");
  await upAgain();
  await settle(5);
  const up = await state();
  if (up.seated !== null) console.log("  before E:", JSON.stringify({ seat: before.seatPrompt, others: before.others, focus: up.focus }));
  const after = await ev(() => ({ feet: window.__chimp.walker().feet.asArray(), seated: window.__chimp.walker().seated, sitting: window.__chimp.chimps.describe().mine.sitting }));
  check(up.seated === null && Object.keys(up.taken).length === 0, "E again gets up, and the seat is free", JSON.stringify(up.taken));
  check(!after.seated && after.sitting < 0.02, "standing, walking again");
  const ahead = (after.feet[0] - sofa.at[0]) * sofa.front[0] + (after.feet[2] - sofa.at[2]) * sofa.front[2];
  check(ahead > 0.5 && ahead < 1.3, "standing in front of the sofa, clear of it", `${ahead.toFixed(2)} m in front of the seat's place`);
  void sofaBefore;
  // a walking key gets up too, and Esc
  await approach(sofa);
  await lookAt(sofa);
  await page.keyboard.press("KeyE");
  await sleep(900);
  check((await state()).seated === sofa.n, "sits again");
  await page.keyboard.down("KeyS");
  await sleep(250);
  await page.keyboard.up("KeyS");
  await sleep(1200);
  check((await state()).seated === null, "a walking key gets up");
  await approach(sofa);
  await lookAt(sofa);
  await page.keyboard.press("KeyE");
  await sleep(900);
  await page.keyboard.press("Escape");
  await upAgain();
  check((await state()).seated === null && !(await ev(() => window.__chimp.walker().seated)), "and so does Esc");

  // ------------------------------------------------ 3. a bar stool, a theatre seat, a sun lounger
  const stool = all.find((s) => s.label.startsWith("Bar stool") && s.room === "arrivalLounge") ?? all.find((s) => s.kind === "stool" && s.info.footrest);
  const stoolBefore = await sitWithE(stool, `a bar stool (${stool.label})`);
  await seatedCheck(stool, "the bar stool", stoolBefore);
  const feet = await ev(() => window.__chimp.chimps.feet());
  // on the ring, or (legs too short to reach it) hanging over it, knees bent
  const onRing = feet.map((f) => f.ankle - stool.floor);
  check(onRing.every((h) => h > stool.info.footrest - 0.02 && h < stool.info.height - 0.1), "its feet off the floor: on the stool's ring, or hanging over it", onRing.map((h) => h.toFixed(2)).join(", "));
  await ev(() => window.__chimp.chimps.setBoom(2.0));
  await ev((s) => {
    const c = window.__chimp;
    const m = c.chimps.describe().mine;
    c.setPose({ ...c.pose(), yaw: m.facing + Math.PI * 0.62, pitch: 0.12 });
  }, stool);
  await settle(30);
  await shot("stool");
  await ev(() => window.__chimp.seats.stand());
  await ev(() => window.__chimp.chimps.setBoom(0));
  await sleep(1300);

  const theatreSeat = all.find((s) => s.label.startsWith("Front row sofa"));
  const thBefore = await sitWithE(theatreSeat, `a theatre seat (${theatreSeat.label})`);
  await seatedCheck(theatreSeat, "the theatre seat", thBefore);
  await ev(() => window.__chimp.chimps.setBoom(2.4));
  await ev((s) => {
    const c = window.__chimp;
    c.setPose({ ...c.pose(), yaw: Math.atan2(s.front[0], s.front[2]) + Math.PI - 0.75, pitch: 0.16 });
  }, theatreSeat);
  await settle(30);
  await shot("theatre");
  // looking at the screen from the seat, E watches it (the theatre's E comes first)
  await ev((s) => {
    const c = window.__chimp;
    c.setPose({ ...c.pose(), yaw: Math.atan2(s.front[0], s.front[2]), pitch: -0.05 });
  }, theatreSeat);
  await settle(10);
  const watch = await ev(() => ({ theatre: window.__chimp.state().theatrePrompt, seat: window.__chimp.state().seatPrompt }));
  check(watch.theatre && !watch.seat, "seated, looking at the screen: E watches it, not stands", JSON.stringify(watch));
  await ev(() => window.__chimp.seats.stand());
  await ev(() => window.__chimp.chimps.setBoom(0));
  await sleep(1300);

  const lounger = all.find((s) => s.kind === "lounger");
  const lgBefore = await sitWithE(lounger, "a sun lounger");
  await seatedCheck(lounger, "the sun lounger", lgBefore);
  await ev(() => window.__chimp.chimps.setBoom(2.4));
  await ev((s) => {
    const c = window.__chimp;
    c.setPose({ ...c.pose(), yaw: Math.atan2(s.front[0], s.front[2]) + Math.PI * 0.55, pitch: 0.22 });
  }, lounger);
  await settle(30);
  await shot("lounger");
  await ev(() => window.__chimp.seats.stand());
  await ev(() => window.__chimp.chimps.setBoom(0));
  await sleep(1300);

  // ------------------------------------------------ 4. E's other uses come first
  const spot = await ev(() => window.__chimp.remotes.spots()[0]);
  await ev((at) => {
    const c = window.__chimp;
    c.walker().place(at[0] - 0.9, at[1] + 0.3, at[2], 2);
  }, spot.at);
  await settle(2);
  await ev((at) => {
    const c = window.__chimp;
    const [ex, ey, ez] = c.chimps.eye().at;
    c.setPose({ ...c.pose(), yaw: Math.atan2(at[0] - ex, at[2] - ez), pitch: Math.atan2(ey - at[1], Math.hypot(at[0] - ex, at[2] - ez)) });
  }, spot.at);
  await settle(5);
  const atStand = await state();
  check(!!atStand.remotePrompt && !atStand.seatPrompt, "at the theatre remotes' stand, E is the remote's", JSON.stringify({ remote: atStand.remotePrompt, seat: atStand.seatPrompt }));

  // ------------------------------------------------ 5. another visitor sitting
  const bosSeat = all.find((s) => s.label.startsWith("Curved console sofa") && s.n !== sofa.n && Math.abs(s.n - sofa.n) === 1) ?? all.find((s) => s.n !== sofa.n && s.kind === "sofa");
  const visitor = await browser.newPage({ viewport: { width: 400, height: 200 } });
  visitor.on("pageerror", (e) => console.log("[visitor pageerror]", e.message));
  const yaw = Math.atan2(bosSeat.front[0], bosSeat.front[2]);
  await visitor.goto(`${URL}/tools/chimp-visitor.html?name=Bo&seat=${bosSeat.n}&yaw=${yaw}&x=${bosSeat.at[0]}&y=${bosSeat.floor}&z=${bosSeat.at[2]}&wear=cap,tee`);
  await visitor.waitForFunction(() => !!window.visitor, null, { timeout: 30000 });
  const bo = await visitor.evaluate(() => window.visitor.id);
  await waitFor(([n, id]) => window.__chimp.state().seats.taken[String(n)] === id, [bosSeat.n, bo], 20000).then(
    () => check(true, "the room server gives the other visitor the seat, and this page hears it"),
    () => check(false, "the room server gives the other visitor the seat, and this page hears it"),
  );
  // Ann sits beside Bo
  const annBefore = await sitWithE(sofa, "the console sofa, beside the other visitor");
  await seatedCheck(sofa, "the console sofa", annBefore);
  await waitFor((id) => window.__chimp.chimps.describe().others.find((o) => o.id === id)?.built, bo, 60000).catch(() => undefined);
  await waitFor((id) => (window.__chimp.chimps.describe().others.find((o) => o.id === id)?.sitting ?? 0) > 0.95, bo, 10000).catch(() => undefined);
  const boSeen = await ev((id) => window.__chimp.chimps.describe().others.find((o) => o.id === id), bo);
  check(boSeen?.seat === bosSeat.n && boSeen.sitting > 0.95, "the other visitor's chimp is seen sitting on their seat", JSON.stringify({ seat: boSeen?.seat, sitting: boSeen?.sitting }));
  check(boSeen?.at && Math.hypot(boSeen.at[0] - bosSeat.at[0], boSeen.at[2] - bosSeat.at[2]) < 0.1 && Math.abs(boSeen.at[1] - bosSeat.floor) < 0.05, "where the seat is", JSON.stringify(boSeen?.at));
  await ev(() => window.__chimp.chimps.setBoom(2.6));
  await ev((s) => {
    const c = window.__chimp;
    c.setPose({ ...c.pose(), yaw: Math.atan2(s.front[0], s.front[2]) + Math.PI + 0.5, pitch: 0.2 });
  }, sofa);
  await settle(40);
  await shot("couch-two");
  await ev(() => window.__chimp.seats.stand());
  await ev(() => window.__chimp.chimps.setBoom(0));
  await sleep(1400);
  // the taken seat: offered as taken, and refused
  await approach(bosSeat);
  await lookAt(bosSeat);
  const takenPrompt = (await state()).seatPrompt;
  check(takenPrompt?.action === "taken" && takenPrompt.who === "Bo", "looking at it: Bo is sitting there, no E to sit", JSON.stringify(takenPrompt));
  check((await ev((n) => window.__chimp.seats.sit(n), bosSeat.n)) === false, "sitting there is refused by this page");
  await ev((n) => window.__chimp.seats.send("sit", { seat: n }), bosSeat.n);
  await sleep(800);
  check((await state()).taken[String(bosSeat.n)] === bo, "and by the room server, which keeps Bo on it");
  await visitor.close();
  await waitFor((n) => !window.__chimp.state().seats.taken[String(n)], bosSeat.n, 20000).then(
    () => check(true, "when the other visitor leaves, their seat is free"),
    () => check(false, "when the other visitor leaves, their seat is free"),
  );
  await settle(5);
  const freed = (await state()).seatPrompt;
  check(freed?.action === "sit" && freed.seat === bosSeat.n, "and offered to sit on", JSON.stringify(freed));
} finally {
  await stop();
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
