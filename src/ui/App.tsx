import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CAPTURE, PreviewController, startPreview } from "../engine/preview";
import { store } from "../engine/store";
import { Hud } from "./Hud";
import { Lobby } from "./Lobby";

export function useStore() {
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.get(),
  );
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ctl, setCtl] = useState<PreviewController | null>(null);
  const started = useRef(false);
  const s = useStore();

  useEffect(() => {
    if (started.current || !canvasRef.current) return;
    started.current = true;
    startPreview(canvasRef.current)
      .then(setCtl)
      .catch((e: unknown) => {
        console.error(e);
        store.set({ error: String(e instanceof Error ? e.stack ?? e.message : e), loading: false });
      });
  }, []);

  return (
    <div className="app">
      <canvas ref={canvasRef} className="scene" tabIndex={0} />
      {s.loading && (
        <div className="loading">
          <div className="loading-card">
            <div className="brand">ChimpHouse</div>
            <div className="sub">3D preview</div>
            <div className="bar">
              <div style={{ width: `${Math.round(s.progress * 100)}%` }} />
            </div>
            <div className="msg">{s.message}</div>
          </div>
        </div>
      )}
      {s.error && (
        <div className="loading">
          <div className="loading-card error">
            <div className="brand">Something went wrong</div>
            <pre>{s.error}</pre>
          </div>
        </div>
      )}
      {!CAPTURE && ctl && !s.loading && (s.lobby ? <Lobby ctl={ctl} s={s} /> : <Hud ctl={ctl} s={s} />)}
    </div>
  );
}
