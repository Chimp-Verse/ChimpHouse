import { useEffect, useRef, useState } from "react";
import { ROOMS, type Room } from "./rooms";

/** The house itself. The name-and-chimp lobby greets visitors there before they arrive. */
const HOUSE = "/house.html";
const pic = (name: string) => `/site/${name}.webp`;
const srcSet = (name: string) => `/site/${name}-800.webp 800w, /site/${name}.webp 1600w`;

/** The ChimpHouse leaf emblem: the same five leaves as the house's signs and the video's finale. */
function Emblem({ size = 64 }: { size?: number }) {
  const S = 120;
  const leaves: [number, number, number][] = [
    [0, 1.0, 0.24],
    [-0.42, 0.82, 0.22],
    [0.42, 0.82, 0.22],
    [-0.95, 0.6, 0.2],
    [0.95, 0.6, 0.2],
  ];
  return (
    <svg className="emblem" viewBox="-140 -140 280 160" width={size} height={(size * 160) / 280} aria-hidden="true">
      {leaves.map(([ang, len, wid], i) => {
        const L = S * len;
        const W = S * wid;
        return (
          <path
            key={i}
            transform={`rotate(${(ang * 180) / Math.PI})`}
            d={`M0,0 C${W},${-L * 0.3} ${W * 0.9},${-L * 0.75} 0,${-L} C${-W * 0.9},${-L * 0.75} ${-W},${-L * 0.3} 0,0 Z`}
          />
        );
      })}
    </svg>
  );
}

function Enter({ big = false }: { big?: boolean }) {
  return (
    <a className={big ? "enter big" : "enter"} href={HOUSE}>
      Enter ChimpHouse
    </a>
  );
}

/** Things fade and rise into view as they're scrolled to (class "in"), once. */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach((e) => e.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

/** How far down the page is (0..1) and the hero's scroll, as CSS variables for the progress bar and the hero's slow drift. */
function useScrollVars() {
  useEffect(() => {
    const root = document.documentElement;
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = Math.max(1, root.scrollHeight - innerHeight);
      root.style.setProperty("--progress", String(Math.min(1, scrollY / max)));
      root.style.setProperty("--hero", String(Math.min(1, scrollY / innerHeight)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
}

/** Which room's section is in the middle of the screen, for the room list at the side. */
function useCurrentRoom() {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = e.target.id;
          if (e.isIntersecting) setCurrent(id);
          else setCurrent((c) => (c === id ? null : c));
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    document.querySelectorAll(".room").forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return current;
}

function Video() {
  const ref = useRef<HTMLVideoElement>(null);
  // muted autoplay: some browsers still need a nudge once the video is on the page
  useEffect(() => {
    const v = ref.current;
    if (v) {
      v.muted = true;
      void v.play().catch(() => undefined);
    }
  }, []);
  return (
    <video ref={ref} className="video" src="/site/chimphouse-intro.webm" poster={pic("courtyard")} autoPlay muted loop playsInline controls preload="metadata">
      A 52-second tour of ChimpHouse.
    </video>
  );
}

/** The enlarged view: a native modal dialog (focus is held inside, Esc closes it, focus returns to the inset). It shows the concept art or the real 3D view, switched by a two-option toggle. */
function Lightbox({ room, onClose }: { room: Room; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<"concept" | "house">("concept");
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    document.documentElement.classList.add("lb-open");
    return () => document.documentElement.classList.remove("lb-open");
  }, []);
  const concept = view === "concept";
  const options: ["concept" | "house", string][] = [
    ["concept", "Concept art"],
    ["house", "In the house"],
  ];
  return (
    <dialog ref={ref} className="lightbox" aria-label={`${room.name}, enlarged`} onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <div className="lb-body">
        <button type="button" className="lb-close" aria-label="Close" onClick={() => ref.current?.close()}>
          &times;
        </button>
        <div className="lb-toggle" role="group" aria-label="Which picture to show">
          {options.map(([v, label]) => (
            <button key={v} type="button" aria-pressed={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
              {label}
            </button>
          ))}
        </div>
        <img className="lb-img" key={view} src={concept ? `/site/concept/${room.concept}.webp` : pic(room.id)} alt={concept ? `Concept art for ${room.name}` : room.alt} />
        <p className="lb-caption">{concept ? `${room.name}: the concept art it was built from.` : `${room.name}: the same place, in the house.`}</p>
      </div>
    </dialog>
  );
}

function RoomSection({ room, index, onOpen }: { room: Room; index: number; onOpen: (room: Room, from: HTMLElement) => void }) {
  return (
    <section className={`room ${index % 2 ? "flip" : ""}`} id={room.id} aria-labelledby={`${room.id}-name`}>
      <figure className="room-shot reveal">
        <img src={pic(room.id)} srcSet={srcSet(room.id)} sizes="(max-width: 860px) 100vw, 58vw" alt={room.alt} loading="lazy" decoding="async" width={1600} height={900} />
        {room.concept && (
          <figcaption className="concept">
            <button type="button" className="concept-btn" aria-haspopup="dialog" aria-label={`Enlarge the concept art for ${room.name}`} onClick={(e) => onOpen(room, e.currentTarget)}>
              <img src={`/site/concept/${room.concept}.webp`} alt="" loading="lazy" decoding="async" width={720} height={405} />
              <span>Concept art</span>
              <em>Click to enlarge</em>
            </button>
          </figcaption>
        )}
      </figure>
      <div className="room-text reveal">
        <div className="where">{room.where}</div>
        <h3 id={`${room.id}-name`}>{room.name}</h3>
        <p className="line">{room.line}</p>
        {room.copy.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        <ul className="things">
          {room.things.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Site() {
  useReveal();
  useScrollVars();
  const current = useCurrentRoom();
  const [open, setOpen] = useState<Room | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = () => {
    setOpen(null);
    opener.current?.focus();
  };
  const lower = ROOMS.filter((r) => r.where.startsWith("Lower") || r.where.startsWith("Arrival"));
  const upper = ROOMS.filter((r) => r.where.startsWith("Upper"));
  return (
    <>
      <div className="progress" aria-hidden="true" />
      <header className="top">
        <a className="brand" href="#top">
          <Emblem size={34} />
          <span>ChimpHouse</span>
        </a>
        <nav>
          <a href="#tour">Tour</a>
          <a href="#overview">The house</a>
          <a href="#rooms">Rooms</a>
          <Enter />
        </nav>
      </header>

      <main id="top">
        <section className="hero">
          <img className="hero-bg" src={pic("courtyard")} srcSet={srcSet("courtyard")} sizes="100vw" alt="" fetchPriority="high" />
          <div className="hero-veil" />
          <div className="hero-card">
            <Emblem size={120} />
            <h1>ChimpHouse</h1>
            <div className="sub">The ChimpVerse clubhouse</div>
            <p className="lead">A treehouse deep in the jungle where the ChimpVibe community hangs out as chimps: play games together, watch the stream, make music and show off your builds.</p>
            <div className="ctas">
              <Enter big />
              <a className="ghost" href="#tour">
                Take the tour
              </a>
            </div>
          </div>
          <a className="scroll-hint" href="#tour" aria-label="Scroll down">
            <span />
          </a>
        </section>

        <section className="band tour" id="tour">
          <div className="band-head reveal">
            <div className="kicker">52 seconds inside</div>
            <h2>Come hang out</h2>
          </div>
          <div className="video-frame reveal">
            <Video />
          </div>
        </section>

        <section className="band overview" id="overview">
          <div className="split">
            <div className="reveal">
              <div className="kicker">The house</div>
              <h2>A treehouse for the whole crew</h2>
              <p>
                ChimpHouse is the central clubhouse of ChimpVerse, the 3D social world built around ChimpVibe and the streamer Yousef. It's a contemporary treehouse woven into a tropical jungle, among enormous living trees, with mountains, waterfalls and the canopy all around.
              </p>
              <p>
                Warm timber ribs, big curved windows, comfy teal sofas and mint light strips run through every room. ChimpVibe becomes an arcade, MixChimp a studio, community builds a showroom, and the stream a theatre night: each activity has a room of its own, all connected by the same trees, stairs and gallery.
              </p>
              <ul className="facts">
                <li>
                  <b>2</b> levels
                </li>
                <li>
                  <b>{ROOMS.length}</b> places to hang out
                </li>
                <li>
                  <b>1</b> jungle
                </li>
              </ul>
            </div>
            <figure className="overview-shot reveal">
              <img src={pic("aerial")} srcSet={srcSet("aerial")} sizes="(max-width: 860px) 100vw, 50vw" alt="ChimpHouse from above, a curved timber treehouse with a rooftop pool in the jungle canopy" loading="lazy" decoding="async" width={1600} height={900} />
            </figure>
          </div>

          <div className="you reveal">
            <img src={pic("chimp")} srcSet={srcSet("chimp")} sizes="(max-width: 860px) 100vw, 40vw" alt="A chimp avatar standing in the entry hall, facing the camera" loading="lazy" decoding="async" width={1600} height={900} />
            <div>
              <div className="kicker">Your chimp</div>
              <h3>Show up as your own chimp</h3>
              <p>Everyone walks the house as a chimp they shape and dress themselves: body, face, fur and clothes. Everyone else in the house sees yours, walking, waving and playing beside them.</p>
            </div>
          </div>

          <div className="plan reveal">
            <img src="/site/concept/floorplan.webp" alt="The ChimpHouse floor plan: the lower and upper levels side by side" loading="lazy" decoding="async" width={1400} height={600} />
            <div className="plan-key">
              <div>
                <h4>Lower level</h4>
                <ul>
                  {lower.map((r) => (
                    <li key={r.id}>
                      <a href={`#${r.id}`}>{r.name}</a>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>Upper level</h4>
                <ul>
                  {upper.map((r) => (
                    <li key={r.id}>
                      <a href={`#${r.id}`}>{r.name}</a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <div className="rooms" id="rooms">
          <div className="band-head reveal">
            <div className="kicker">Room by room</div>
            <h2>Take a walk through the house</h2>
          </div>
          <nav className="rail" aria-label="Rooms">
            {ROOMS.map((r) => (
              <a key={r.id} href={`#${r.id}`} className={current === r.id ? "on" : ""}>
                <i />
                <span>{r.name}</span>
              </a>
            ))}
          </nav>
          {ROOMS.map((r, i) => (
            <RoomSection
              key={r.id}
              room={r}
              index={i}
              onOpen={(room, from) => {
                opener.current = from;
                setOpen(room);
              }}
            />
          ))}
        </div>

        <section className="finale">
          <img className="finale-bg" src={pic("front-night")} srcSet={srcSet("front-night")} sizes="100vw" alt="" loading="lazy" decoding="async" />
          <div className="finale-veil" />
          <div className="finale-card reveal">
            <Emblem size={96} />
            <h2>After dark, the lights come on</h2>
            <p>Warm windows, mint arches, lanterns on the stairs and a glowing pool: at night ChimpHouse is the brightest place in the jungle. Your friends are already inside.</p>
            <Enter big />
          </div>
        </section>
      </main>

      <footer className="foot">
        <img src="/brand/chimpvibe-mark.svg" alt="" width={28} height={28} />
        <span>ChimpHouse is part of ChimpVerse, made with the ChimpVibe community.</span>
        <a href={HOUSE}>Enter ChimpHouse</a>
      </footer>
      {open && <Lightbox room={open} onClose={close} />}
    </>
  );
}
