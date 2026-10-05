// GPU time per frame (timer queries) for each view, and with each system switched off.
//   node tools/gpu-profile.mjs [views...]
import { chromium } from "playwright";
const views = process.argv.slice(2).length ? process.argv.slice(2) : ["entry", "lounge", "front", "game", "poolbar", "aerial"];
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("http://localhost:5173/?capture=1");
await page.waitForFunction(() => window.__chimp?.ready === true, null, { timeout: 300000 });
const out = await page.evaluate(async (views) => {
  const c = window.__chimp;
  const s = c.scene;
  const eng = s.getEngine();
  const gl = eng._gl;
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const pending = [];
  let gpu = [];
  let cpuT = [];
  let q = null, tc = 0;
  eng.onBeginFrameObservable.add(() => { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); tc = performance.now(); });
  eng.onEndFrameObservable.add(() => { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); cpuT.push(performance.now() - tc);
    for (let i = pending.length - 1; i >= 0; i--) { const p = pending[i]; if (gl.getQueryParameter(p, gl.QUERY_RESULT_AVAILABLE)) { if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(p); pending.splice(i, 1); } } });
  const frames = (n) => new Promise((res) => { let k = 0; const step = () => { if (++k > n) res(); else requestAnimationFrame(step); }; requestAnimationFrame(step); });
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return +b[Math.floor(b.length / 2)].toFixed(2); };
  const time = async () => { await frames(20); gpu = []; cpuT = []; await frames(100); return { gpu: med(gpu), cpu: med(cpuT) }; };
  const settle = async () => { await c.whenReady(); await frames(20); await c.whenReady(); };
  const pipeline = s.postProcessRenderPipelineManager?.supportedPipelines?.[0];
  const leaves = s.meshes.filter((m) => m.metadata?.kind === "leaves");
  const jungle = s.meshes.filter((m) => m.metadata?.room === "jungle");
  const glass = s.meshes.filter((m) => m.material && (m.material.alpha < 1 || m.material.transparencyMode === 2));
  const sky = s.meshes.filter((m) => /sky/i.test(m.name));
  const res = {};
  for (const v of views) { c.goTo(v); await settle(); }
  for (const v of views) {
    c.goTo(v);
    await settle();
    const base = await time();
    const r = { gpu: base.gpu, cpu: base.cpu };
    const tryOff = async (name, off, on) => { off(); await settle(); const t = await time(); on(); await settle(); r[name] = +(base.gpu - t.gpu).toFixed(2); };
    if (pipeline) await tryOff("post", () => s.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(pipeline.name, s.activeCamera), () => s.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(pipeline.name, s.activeCamera));
    await tryOff("leaves", () => leaves.forEach((m) => m.setEnabled(false)), () => leaves.forEach((m) => m.setEnabled(true)));
    await tryOff("jungle", () => jungle.forEach((m) => m.setEnabled(false)), () => jungle.forEach((m) => m.setEnabled(true)));
    await tryOff("glass", () => glass.forEach((m) => m.setEnabled(false)), () => glass.forEach((m) => m.setEnabled(true)));
    await tryOff("sky", () => sky.forEach((m) => m.setEnabled(false)), () => sky.forEach((m) => m.setEnabled(true)));
    res[v] = r;
  }
  res.skyMeshes = sky.map((m) => m.name);
  return res;
}, views);
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(8), JSON.stringify(v));
await browser.close();
