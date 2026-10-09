// The lift in a real browser against the running preview (npm run dev):
//   1. the car, doors, buttons and indicators, found by role alone
//   2. the timing as pure functions (engine/liftState.ts), run in the page: a trip
//      between floors, the doors' travel and dwell, a doorway that holds the doors and
//      reopens them while someone is in it, and the same state from any step size
//   3. a visitor: walks up to the landing, points at the call button and calls the car (E);
//      it comes and opens; the visitor walks in, points at the panel's buttons one by one and
//      sends the car up with the 2; the door buttons hold and shut the doors; a visitor
//      standing in the doorway holds the doors open past their dwell; the shut doors are solid
// Screenshots: captures/lift-*.png. Exits non-zero when a check fails.
//   node tools/test-lift.mjs
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
// expected: ChimpVibe's arcade list, which the house falls back from while it isn't served
page.on("console", (m) => m.type() === "error" && !/\/chimpvibe\/|403|404/.test(m.text()) && console.log("[browser error]", m.text().slice(0, 300)));
const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
const shot = (name) => page.screenshot({ path: `captures/lift-${name}.png` });
const lift = () => ev(() => window.__chimp.lift.describe());
/** Whether a lift button is lit (its call waiting): its material is the lit one. */
const lamp = (role, slot) => ev(([r, n]) => window.__chimp.scene.meshes.find((m) => m.metadata?.role === r && m.metadata.slot === n)?.material?.name.endsWith("-lit"), [role, slot]);
/** Turn the walker's head to look at a point, as a visitor pointing at a button does. */
const lookAt = (p) =>
  ev(([x, y, z]) => {
    const pose = window.__chimp.pose();
    const dx = x - pose.x, dy = y - pose.y, dz = z - pose.z;
    window.__chimp.setPose({ ...pose, yaw: Math.atan2(dx, dz), pitch: Math.atan2(-dy, Math.hypot(dx, dz)) });
  }, p);
/** Where a lift button is, found by role (and slot). */
const buttonAt = (role, slot) => ev(([r, n]) => window.__chimp.scene.meshes.find((m) => m.metadata?.role === r && (n === null || m.metadata.slot === n)).getBoundingInfo().boundingBox.centerWorld.asArray(), [role, slot ?? null]);
/** The lift prompt once the page has drawn a few frames since the last look (the aim is read each frame). */
const aimed = async () => {
  await ev(() => new Promise((done) => { let n = 0; const tick = () => (++n >= 4 ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }));
  return ev(() => window.__chimp.state().liftPrompt);
};
const walkerAt = () => ev(() => { const w = window.__chimp.walker(); return w ? [w.feet.x, w.feet.y, w.feet.z] : null; });
/** Where the lift's landmarks are, from the house itself: the car's floor, the landing doors' centre. */
const geometry = () =>
  ev(() => {
    const s = window.__chimp.scene;
    const byName = (n) => s.meshes.find((m) => m.name === n);
    const floor = byName("Lift car floor").getBoundingInfo().boundingBox.centerWorld;
    const doorBox = s.meshes.find((m) => m.metadata?.role === "lift-door-left" && m.metadata.slot === 1).getBoundingInfo().boundingBox;
    const call = s.meshes.find((m) => m.metadata?.role === "lift-call-button" && m.metadata.slot === 1).getBoundingInfo().boundingBox.centerWorld;
    return { carX: floor.x, carZ: floor.z, doorZ: doorBox.centerWorld.z, doorX: doorBox.centerWorld.x, callX: call.x, callZ: call.z };
  });

await page.goto(`${URL}/?view=entry`);
await waitFor(() => window.__chimp?.ready === true, null, 300000);
await sleep(500);

// ------------------------------------------------ 1. the parts, by role
const parts = await ev(() => {
  const s = window.__chimp.scene;
  const n = (role, slot) => s.meshes.concat(s.transformNodes).filter((m) => m.metadata?.role === role && (slot === undefined || m.metadata.slot === slot)).length;
  return {
    car: n("lift-car"),
    carButtons: [n("lift-floor-button", 1), n("lift-floor-button", 2), n("lift-open-button"), n("lift-close-button")],
    carDoors: [n("lift-car-door-left"), n("lift-car-door-right")],
    carIndicator: n("lift-car-indicator"),
    doors: [n("lift-door-left", 1), n("lift-door-right", 1), n("lift-door-left", 2), n("lift-door-right", 2)],
    callButtons: [n("lift-call-button", 1), n("lift-call-button", 2)],
    indicators: [n("lift-indicator", 1), n("lift-indicator", 2)],
  };
});
check(parts.car === 1 && parts.carIndicator === 1, "the car and its indicator carry their roles", JSON.stringify(parts));
check(parts.carButtons.every((c) => c === 1) && parts.callButtons.every((c) => c === 1), "a button for each floor and two door buttons in the car, and a call button on each landing");
check(parts.doors.every((c) => c === 1) && parts.indicators.every((c) => c === 1) && parts.carDoors.every((c) => c === 1), "two leaves of landing doors and an indicator for each floor, and the car's own doors");
// the room keeps the lift as the last visitor left it (another test, or someone else on the server): start from the beginning
await ev(() => window.__chimp.lift.reset());
await sleep(200);
const start = await lift();
check(start.phase === "parked" && start.floor === 1 && start.height === 0, "the car starts parked on the lower floor, its doors shut", JSON.stringify(start));

// ------------------------------------------------ 2. the timing, as pure functions, in the page
const pure = await ev(async () => {
  const L = await import("/src/engine/liftState.ts");
  const T = L.LIFT_TIMING;
  const t0 = 1_000_000;
  const out = {};
  // a call from the lower floor to the upper
  let s = L.callLift(L.initialLift(t0), 2, "call", t0);
  out.departs = s.phase === "moving" && s.dest === 2;
  out.travel = L.travelTime(1, 2);
  const arrive = t0 + out.travel * 1000;
  out.midHeight = L.carHeight(s, t0 + (out.travel * 1000) / 2);
  out.stillMoving = L.advanceLift(s, arrive - 50).phase === "moving";
  s = L.advanceLift(s, arrive + 10);
  out.arrives = s.phase === "arriving" && s.floor === 2 && s.pending.length === 0;
  const openAt = arrive + T.arrivePause * 1000;
  s = L.advanceLift(s, openAt + 10);
  out.opens = s.phase === "open" && L.doorPosAt(s, openAt + T.openTime * 1000) === 1;
  out.halfway = Math.abs(L.doorPosAt(s, openAt + (T.openTime * 1000) / 2) - 0.5) < 0.01;
  out.dwellIs = Math.abs(s.shutAt - openAt - (T.openTime + T.dwell) * 1000) < 1;
  const shutAt = s.shutAt;
  s = L.advanceLift(s, shutAt - 10);
  out.holdsUntilDwellEnds = s.phase === "open";
  s = L.advanceLift(s, shutAt + 10);
  out.shuts = s.phase === "closing";
  s = L.advanceLift(s, s.doorAt + T.shutTime * 1000 + 10);
  out.parks = s.phase === "parked" && s.floor === 2 && L.carHeight(s, 0) === 5.6;

  // someone steps into the doorway while the doors shut: they reopen, and hold until it clears
  const open2 = L.callLift(L.initialLift(t0), 1, "call", t0);
  const atOpen = L.advanceLift(open2, t0 + 10);
  out.openFromParked = atOpen.phase === "open" && atOpen.floor === 1;
  const closing = L.advanceLift(atOpen, atOpen.shutAt + 10);
  out.closing = closing.phase === "closing";
  const tIn = atOpen.shutAt + 500;
  const reopened = L.setDoorway(closing, "local", true, tIn);
  out.reopensOnDoorway = reopened.phase === "open" && reopened.doorTarget === 1;
  const held = L.advanceLift(reopened, tIn + 6000);
  out.heldWhileInDoorway = held.phase === "open";
  const tOut = tIn + 6000;
  const cleared = L.setDoorway(held, "local", false, tOut);
  out.stillOpenAfterClearing = L.advanceLift(cleared, tOut + T.clearHold * 1000 - 50).phase === "open";
  out.shutsAfterClearing = L.advanceLift(cleared, tOut + T.clearHold * 1000 + 50).phase === "closing";

  // an inside button while the doors are open shuts them soon, not after the full dwell
  const inside = L.callLift(atOpen, 2, "car", atOpen.at + 100);
  out.insideShortensDwell = inside.shutAt <= atOpen.at + 100 + T.shutSoon * 1000 + 1 && inside.pending.includes(2);

  // the door-open button reopens shutting doors and holds them; the door-close button shuts them now
  const shutting = L.advanceLift(atOpen, atOpen.shutAt + 10);
  const held2 = L.holdDoors(shutting, atOpen.shutAt + 300);
  out.openButtonReopens = held2.phase === "open" && held2.shutAt >= atOpen.shutAt + 300 + T.holdOpen * 1000;
  out.openButtonOpensParked = L.holdDoors(L.initialLift(t0), t0).phase === "open";
  out.closeButtonShuts = L.shutDoorsNow(atOpen, atOpen.at + 2000).phase === "closing";
  out.closeButtonHeldByDoorway = L.shutDoorsNow(L.setDoorway(atOpen, "local", true, atOpen.at + 100), atOpen.at + 2000).phase === "open";

  // the same commands at the same times end in the same state, however often the time is stepped
  const run = (step) => {
    let st = L.callLift(L.initialLift(t0), 2, "call", t0);
    for (let t = t0; t <= t0 + 40000; t += step) st = L.advanceLift(st, t);
    return JSON.stringify(st);
  };
  out.sameFromAnyStep = run(16) === run(2000) && run(16) === run(250);
  return out;
});
const pureFails = Object.entries(pure).filter(([k, v]) => k !== "travel" && k !== "midHeight" && v !== true);
check(pureFails.length === 0, "the timing rules hold: the trip, the doors, the dwell, the doorway, and the same state from any step size", pureFails.map(([k]) => k).join(", "));
check(Math.abs(pure.travel - 7.27) < 0.05 && Math.abs(pure.midHeight - 2.8) < 0.01, "a trip from the lower to the upper floor takes about 7.3 s, and the car is half way at the half-way time", `${pure.travel.toFixed(2)} s, mid ${pure.midHeight.toFixed(2)} m`);

// ------------------------------------------------ 3. a visitor
const g = await geometry();
const upTo = (floor, timeout = 40000) => waitFor((f) => { const d = window.__chimp.lift.describe(); return d.phase === "open" && d.floor === f; }, floor, timeout);

// someone upstairs calls the car: it rises from the lower floor and opens on the upper
await ev(() => window.__chimp.lift.call(2));
await sleep(3500);
const mid = await lift();
check(mid.phase === "moving" && mid.height > 1 && mid.height < 4.6, "the car rises in the shaft, between the floors", `height ${mid.height.toFixed(2)} m`);
await upTo(2);
const upper = await lift();
check(upper.floor === 2 && Math.abs(upper.height - 5.6) < 0.01, "the car arrives at the upper floor and its doors open", JSON.stringify(upper));
await sleep(1500);
check((await lift()).doorPos > 0.99, "the doors are fully open a moment after the car arrives");
await shot("upper-open");

// a visitor on the lower landing walks up to the call panel, which shows on the way
await ev((p) => window.__chimp.setPose(p), { x: g.callX, y: 1.6, z: g.doorZ - 3.4, yaw: 0, pitch: -0.05, fov: 0.9 });
await ev(() => window.__chimp.settle(20));
await ev(() => window.__chimp.setWalking(true));
await sleep(300);
await page.keyboard.down("KeyW");
await sleep(1200);
await page.keyboard.up("KeyW");
await sleep(200);
// looking ahead, past the panel, offers nothing; pointing at the button offers to call the lift
await lookAt([g.callX, 2.6, g.doorZ + 2]);
const away = await aimed();
check(away === null, "looking away from the call button offers nothing", JSON.stringify(away));
await lookAt(await buttonAt("lift-call-button", 1));
const prompt = await aimed();
check(prompt?.label === "Call the lift" && prompt.id === "call1", "pointing at the landing's call button offers to call the lift", JSON.stringify(prompt));
await shot("landing");

// E calls the car down to the visitor: the call joins those waiting, and the car, still dwelling
// upstairs for the call it has, comes down once its doors have shut
await page.keyboard.press("KeyE");
await sleep(150);
const called = await lift();
check(called.pending.includes(1), "E on the landing calls the car down to the visitor", JSON.stringify(called));
check((await lamp("lift-call-button", 1)) === true, "the landing button lights while its call is waiting");
await waitFor(() => window.__chimp.lift.describe().dest === 1, null, 15000);
await sleep(3000);
const down = await lift();
check(down.phase === "moving" && down.height > 1 && down.height < 4.6, "the car descends the shaft, between the floors", `height ${down.height.toFixed(2)} m`);
await upTo(1);
check((await lift()).height === 0, "the car arrives at the lower floor and its doors open for the visitor");
check((await lamp("lift-call-button", 1)) === false, "the landing button goes out once the car has come");

// the visitor steps across to face the doorway, then walks in through the open doors
await ev(([x, z]) => window.__chimp.walker().place(x, 0.5, z, 1), [g.carX, g.doorZ - 1.3]);
await sleep(100);
await lookAt([g.carX, 1.6, g.carZ + 3]);
const before = await walkerAt();
await page.keyboard.down("KeyW");
await sleep(2400);
await page.keyboard.up("KeyW");
await sleep(200);
const inside = await walkerAt();
check(inside[2] > g.carZ - 0.6 && Math.abs(inside[0] - g.carX) < 0.6, "the visitor walks through the open doors into the car", `from z ${before[2].toFixed(2)} to ${inside[2].toFixed(2)}`);
await shot("inside");

// inside, the visitor points at the panel's buttons one by one: each is offered in turn
const seen = [];
for (const [role, slot] of [["lift-floor-button", 1], ["lift-floor-button", 2], ["lift-open-button"], ["lift-close-button"]]) {
  await lookAt(await buttonAt(role, slot));
  seen.push((await aimed())?.id ?? null);
}
check(JSON.stringify(seen) === JSON.stringify(["car1", "car2", "open", "close"]), "inside the car, each button on the panel is offered when the visitor points at it", JSON.stringify(seen));
// E on the 2 sends the car up; the doors shut a short while after the press
await lookAt(await buttonAt("lift-floor-button", 2));
const two = await aimed();
check(two?.id === "car2" && /upper/.test(two.label), "pointing at the 2 on the lower floor offers to go up", JSON.stringify(two));
await page.keyboard.press("KeyE");
await sleep(150);
check((await lamp("lift-floor-button", 2)) === true, "the button in the car lights for the floor it has been sent to");
await waitFor(() => ["closing", "moving"].includes(window.__chimp.lift.describe().phase), null, 4000);
const ride = await lift();
check(ride.phase === "closing" || ride.phase === "moving", "a car button shuts the doors on a visitor who is inside, and sends the car up", JSON.stringify(ride));
await upTo(2);
const rode = await walkerAt();
const carNow = await lift();
check(Math.abs(carNow.height - 5.6) < 0.01 && Math.abs(rode[1] - 5.62) < 0.2, "the visitor rides the car up, and it opens with them inside", `car ${carNow.height.toFixed(2)} m, feet ${rode[1].toFixed(2)} m`);

// the door-close button shuts the doors at once; the door-open button opens them again
// (the door-open button first, so the doors are open however slowly the page has run)
await ev(() => window.__chimp.lift.use("open"));
await waitFor(() => window.__chimp.lift.describe().doorPos > 0.99, null, 8000);
await ev(() => window.__chimp.lift.use("close"));
check((await lift()).phase === "closing", "the door-close button shuts the doors", JSON.stringify(await lift()));
await sleep(400);
await ev(() => window.__chimp.lift.use("open"));
check((await lift()).phase === "open", "the door-open button opens them again before they meet");

// standing in the doorway holds the doors open well past the dwell
await ev(() => window.__chimp.lift.use("open"));
await ev(([x, y, z]) => window.__chimp.walker().place(x, y, z, 2), [g.doorX, 5.62, g.doorZ - 0.3]);
const samples = [];
for (let i = 0; i < 13; i++) {
  await sleep(500);
  samples.push(await ev(() => { const d = window.__chimp.lift.describe(); const w = window.__chimp.walker(); return `${d.phase} in:${d.inDoorway.length} z:${w ? w.feet.z.toFixed(2) : "-"} y:${w ? w.feet.y.toFixed(2) : "-"}`; }));
}
const holding = await lift();
const held = holding.phase === "open" && holding.inDoorway.length > 0;
check(held, "a visitor standing in the doorway holds the doors open past their dwell", held ? "" : samples.join(" | "));
await shot("doorway");
// out of the doorway: the doors shut a short while after
await ev(([x, y, z]) => window.__chimp.walker().place(x, y, z, 2), [g.doorX, 5.62, g.doorZ - 2.5]);
await waitFor(() => window.__chimp.lift.describe().phase === "closing", null, 8000);
check(true, "once the doorway clears, the doors shut again after a short wait");
await waitFor(() => window.__chimp.lift.describe().phase === "parked", null, 10000);

// the shut doors are solid: a visitor in the upper lobby walking at them stops short
await sleep(300);
await ev(([x, y, z]) => window.__chimp.walker().place(x, y, z, 2), [g.doorX, 5.62, g.doorZ - 1.2]);
await page.keyboard.down("KeyW");
await sleep(1500);
await page.keyboard.up("KeyW");
await sleep(200);
const stopped = await walkerAt();
check(stopped[2] < g.doorZ - 0.15, "the shut doors stop a visitor walking into them", `feet z ${stopped[2].toFixed(2)}, doors at ${g.doorZ.toFixed(2)}`);

// someone on the upper landing calls the car, which comes back up for them from below
await ev(() => window.__chimp.lift.call(1));
await waitFor(() => window.__chimp.lift.describe().phase === "moving", null, 4000);
await upTo(1);
check((await lift()).floor === 1, "a call from the other floor brings the car back to the lower floor");

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nAll lift checks passed");
process.exit(failed ? 1 : 0);
