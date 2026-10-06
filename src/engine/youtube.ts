// YouTube for the theatre: reading the links people paste, the video's title
// and thumbnail, and YouTube's own embedded player (the IFrame Player API),
// which is the only way YouTube's terms allow its videos to be shown.
// https://developers.google.com/youtube/iframe_api_reference

import { TheatreVideo } from "./store";

/** A video or live stream to show, from a link or an ID. */
export interface YouTubeRef {
  id: string;
  /** seconds into the video to start at (a link's t= or start=) */
  start: number;
  /** the link was a /live/ link */
  live: boolean;
}

const ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * A pasted YouTube link (watch?v=, youtu.be/, /live/, /shorts/, /embed/) or bare
 * video ID as a video ID and start time; null when it isn't one.
 */
export function parseYouTube(input: string): YouTubeRef | null {
  const text = input.trim();
  if (ID.test(text)) return { id: text, start: 0, live: false };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  const [, first = "", second = ""] = url.pathname.split("/");
  let id: string | null = null;
  if (host === "youtu.be") id = first;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (first === "watch") id = url.searchParams.get("v");
    else if (["live", "shorts", "embed", "v"].includes(first)) id = second;
  }
  if (!id || !ID.test(id)) return null;
  return { id, start: seconds(url.searchParams.get("t") ?? url.searchParams.get("start")), live: first === "live" };
}

/** "90", "90s", "1m30s" or "1h2m3s" as seconds; 0 when missing or unreadable. */
function seconds(t: string | null): number {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

/** What a player error means, in plain words (the codes are the IFrame API's onError codes). */
export function youTubeError(code: number): string {
  switch (code) {
    case 2:
      return "YouTube says that isn't a valid video. Check the link.";
    case 5:
      return "This video can't play in the browser's player.";
    case 100:
      return "YouTube can't find this video: it may have been removed or made private.";
    // YouTube also answers 150 for some videos that are gone (an ended stream's recording)
    case 101:
    case 150:
      return "YouTube won't play this video outside YouTube: its owner doesn't allow it, or it's no longer available. Choose another, or watch it on YouTube.";
    case 153:
      return "YouTube refused to play because it wasn't told which site is asking (error 153).";
    default:
      return `YouTube couldn't play this video (error ${code}).`;
  }
}

/** The video's page on YouTube, for watching it there. */
export function watchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** The video's title and channel, from YouTube's oEmbed endpoint (it allows reads from other sites); null when it won't say. */
export async function fetchVideoInfo(id: string): Promise<TheatreVideo | null> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(id))}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { title?: string; author_name?: string };
    return { title: j.title ?? "", channel: j.author_name ?? "" };
  } catch {
    return null;
  }
}

/**
 * The video's 16:9 thumbnail as an image that WebGL may draw (i.ytimg.com sends
 * Access-Control-Allow-Origin: *): the 1280 × 720 one where the video has it,
 * else the 320 × 180 one. Null when neither loads.
 */
export async function loadThumbnail(id: string): Promise<HTMLImageElement | null> {
  for (const [name, minW] of [
    ["maxresdefault", 1000],
    ["mqdefault", 300],
  ] as const) {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = `https://i.ytimg.com/vi/${id}/${name}.jpg`;
    });
    // a missing size comes back as a small grey placeholder
    if (img && img.naturalWidth >= minW) return img;
  }
  return null;
}

// ---------------------------------------------------------------- the player

/** The player states the IFrame API reports. */
export const PLAYER = { unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3, cued: 5 } as const;

/** The parts of the IFrame API's player the theatre uses; the test stand-in (public/theatre/standin.html) has the same. */
export interface VideoPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  /** 0–100; getVolume reports what the player last told the page, so it lags a setVolume a little */
  getVolume(): number;
  setVolume(volume: number): void;
  destroy(): void;
}

export interface PlayerEvents {
  onReady?: () => void;
  onStateChange?: (e: { data: number }) => void;
  onError?: (e: { data: number }) => void;
  onAutoplayBlocked?: () => void;
}

/**
 * The address of YouTube's embedded player for a video, controlled through the
 * IFrame API (enablejsapi, with this page's origin), cued at `start` seconds.
 * Related videos at the end come from the same channel (rel=0); playback is
 * started by the theatre, not on load.
 */
export function embedUrl(id: string, start = 0): string {
  const q = new URLSearchParams({ enablejsapi: "1", playsinline: "1", rel: "0", origin: location.origin, start: String(Math.floor(start)) });
  return `https://www.youtube.com/embed/${id}?${q}`;
}

type YTNamespace = { Player: new (el: HTMLIFrameElement, o: { events: PlayerEvents }) => VideoPlayer };
let api: Promise<YTNamespace> | null = null;

/** YouTube's IFrame Player API, loaded once. */
function loadApi(): Promise<YTNamespace> {
  api ??= new Promise<YTNamespace>((resolve, reject) => {
    const w = window as unknown as { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };
    if (w.YT?.Player) return resolve(w.YT);
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(w.YT!);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => {
      api = null;
      reject(new Error("YouTube's player API didn't load"));
    };
    document.head.appendChild(s);
  });
  return api;
}

/** Control YouTube's player in an iframe showing embedUrl(). */
export async function youTubePlayer(frame: HTMLIFrameElement, events: PlayerEvents): Promise<VideoPlayer> {
  const YT = await loadApi();
  return new YT.Player(frame, { events });
}
