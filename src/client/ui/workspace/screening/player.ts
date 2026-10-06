import { h } from '../../dom';
import { clock } from '../../../../shared/workspace';

// The screening room's player (room.ts), as Frame.io's: the cut on its own, no browser controls, and
// under it a timeline with the notes and chapters marked along it, and the controls: play, five
// seconds back or on, a frame back or on, the time to a tenth, the speed and the sound. It streams the
// file by Range, as the office serves it.

/** Something marked along the timeline: a note (not sent, open or done) or a chapter. */
export interface TimelineMark {
  at: number;
  kind: 'draft' | 'open' | 'done' | 'chapter';
  tip: string;
  /** What clicking it opens: a note's key, so the room can show its card. */
  key?: string;
}

export interface Player {
  element: HTMLElement;
  video: HTMLVideoElement;
  load(url: string, o: { audio: boolean; resume?: number }): void;
  /** Lets go of the cut: its sound stops and nothing more is fetched. */
  release(): void;
  setMarks(marks: TimelineMark[]): void;
  /** Something over the picture instead of it (why it won't play), or nothing. */
  setProblem(nodes: Node[] | undefined): void;
  toggle(): void;
  play(): void;
  pause(): void;
  seek(t: number, play?: boolean): void;
  nudge(seconds: number): void;
  step(frames: number): void;
  mute(): void;
  duration(): number;
  time(): number;
  playing(): boolean;
}

/** A frame, for stepping: 30 a second, near enough for the cuts the office makes. */
const FRAME = 1 / 30;
const SPEEDS = [0.5, 1, 1.5, 2];
const tenths = (t: number) => {
  const s = Math.max(0, t);
  return `${clock(Math.floor(s))}.${Math.floor((s % 1) * 10)}`;
};

export function screeningPlayer(o: { onMark(m: TimelineMark): void; onTick(t: number): void; onPlaying(on: boolean): void; onError(): void; onReady(): void; extra?: HTMLElement[] }): Player {
  const video = h('video.sr-video', { preload: 'metadata', playsinline: true }) as HTMLVideoElement;
  const audioArt = h('div.sr-audio', { 'aria-hidden': 'true' }, '\u266a');
  const problem = h('div.sr-problem.hidden', { role: 'alert' });
  const bigPlay = h('button.sr-big-play', { type: 'button', 'aria-label': 'Play', tabindex: '-1' }, '\u25b6');
  const screen = h('div.sr-screen', {}, video, audioArt, bigPlay, problem);

  const buffered = h('div.sr-buffered');
  const played = h('div.sr-played');
  const marksEl = h('div.sr-marks');
  const head = h('div.sr-head');
  const hover = h('div.sr-hover.hidden');
  const timeline = h('div.sr-timeline', { role: 'slider', 'aria-label': 'Time', 'aria-valuemin': '0', tabindex: '-1' }, h('div.sr-rail', {}, buffered, played), marksEl, head, hover);

  const playBtn = h('button.sr-ctl.sr-play', { type: 'button', title: 'Play (Space or K)', 'aria-label': 'Play' }, '\u25b6');
  const back = h('button.sr-ctl', { type: 'button', title: 'Back 5 seconds (J)', 'aria-label': 'Back 5 seconds' }, '\u21ba5');
  const ahead = h('button.sr-ctl', { type: 'button', title: 'Ahead 5 seconds (L)', 'aria-label': 'Ahead 5 seconds' }, '5\u21bb');
  const prev = h('button.sr-ctl', { type: 'button', title: 'A frame back (\u2190)', 'aria-label': 'A frame back' }, '\u2039');
  const next = h('button.sr-ctl', { type: 'button', title: 'A frame on (\u2192)', 'aria-label': 'A frame on' }, '\u203a');
  const now = h('span.sr-now', {}, '0:00.0');
  const total = h('span.sr-total', {}, ' / 0:00');
  const speed = h('button.sr-ctl.sr-speed', { type: 'button', title: 'Speed' }, '1\u00d7');
  const sound = h('button.sr-ctl', { type: 'button', title: 'Mute (M)', 'aria-label': 'Mute' }, '\u{1f50a}');
  const volume = h('input.sr-volume', { type: 'range', min: '0', max: '1', step: '0.05', value: '1', 'aria-label': 'Volume' }) as HTMLInputElement;
  const controls = h('div.sr-controls', {}, timeline,
    h('div.sr-row', {}, playBtn, back, ahead, prev, next, h('span.sr-time', {}, now, total), h('span.rr-grow'), speed, sound, volume, ...(o.extra ?? [])));
  const element = h('div.sr-player', {}, screen, controls);

  let marks: TimelineMark[] = [];
  let shown = '';
  const duration = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0);
  const play = () => void video.play().catch(() => {});
  const pause = () => video.pause();
  const clamp = (t: number) => Math.max(0, duration() ? Math.min(duration(), t) : t);

  function paintTime() {
    const d = duration(), t = video.currentTime || 0;
    const label = tenths(t);
    if (label !== shown) {
      shown = label;
      now.textContent = label;
    }
    if (d) {
      const pct = `${Math.min(100, (t / d) * 100)}%`;
      played.style.width = pct;
      head.style.left = pct;
      timeline.setAttribute('aria-valuenow', String(Math.round(t)));
      try {
        const b = video.buffered;
        buffered.style.width = b.length ? `${Math.min(100, (b.end(b.length - 1) / d) * 100)}%` : '0';
      } catch {
        /* nothing buffered yet */
      }
    }
    o.onTick(t);
  }

  function paintMarks() {
    const d = duration();
    marksEl.replaceChildren(...(d ? marks.filter((m) => m.at <= d) : []).map((m) => {
      const b = h(`button.sr-mark.${m.kind}`, { type: 'button', tabindex: '-1', title: m.tip, 'aria-label': m.tip });
      b.style.left = `${Math.min(100, Math.max(0, (m.at / d) * 100))}%`;
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        o.onMark(m);
      });
      return b;
    }));
  }

  // Scrubbing: press on the timeline and drag.
  const at = (e: PointerEvent) => {
    const r = timeline.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration();
  };
  let dragging = false;
  timeline.addEventListener('pointerdown', (e) => {
    if (!duration() || e.button !== 0) return;
    dragging = true;
    timeline.setPointerCapture(e.pointerId);
    video.currentTime = at(e);
    paintTime();
  });
  timeline.addEventListener('pointermove', (e) => {
    if (!duration()) return;
    const t = at(e);
    hover.textContent = clock(Math.floor(t));
    hover.style.left = `${(t / duration()) * 100}%`;
    hover.classList.remove('hidden');
    if (dragging) {
      video.currentTime = t;
      paintTime();
    }
  });
  const stopDrag = () => (dragging = false);
  timeline.addEventListener('pointerup', stopDrag);
  timeline.addEventListener('pointercancel', stopDrag);
  timeline.addEventListener('pointerleave', () => hover.classList.add('hidden'));

  const toggle = () => (video.paused || video.ended ? play() : pause());
  playBtn.addEventListener('click', toggle);
  bigPlay.addEventListener('click', toggle);
  video.addEventListener('click', toggle);
  back.addEventListener('click', () => (video.currentTime = clamp(video.currentTime - 5)));
  ahead.addEventListener('click', () => (video.currentTime = clamp(video.currentTime + 5)));
  const step = (n: number) => {
    pause();
    video.currentTime = clamp(video.currentTime + n * FRAME);
  };
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  speed.addEventListener('click', () => {
    video.playbackRate = SPEEDS[(SPEEDS.indexOf(video.playbackRate) + 1) % SPEEDS.length] ?? 1;
    speed.textContent = `${video.playbackRate}\u00d7`;
  });
  const mute = () => (video.muted = !video.muted);
  sound.addEventListener('click', mute);
  volume.addEventListener('input', () => {
    video.volume = Number(volume.value);
    video.muted = video.volume === 0;
  });
  video.addEventListener('volumechange', () => {
    sound.textContent = video.muted || video.volume === 0 ? '\u{1f507}' : '\u{1f50a}';
    sound.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
  });

  const playState = () => {
    const on = !video.paused && !video.ended;
    playBtn.textContent = on ? '\u275a\u275a' : '\u25b6';
    playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
    element.classList.toggle('playing', on);
    o.onPlaying(on);
  };
  for (const t of ['play', 'pause', 'ended', 'emptied']) video.addEventListener(t, playState);
  video.addEventListener('timeupdate', paintTime);
  video.addEventListener('seeked', paintTime);
  video.addEventListener('progress', paintTime);
  video.addEventListener('durationchange', () => {
    total.textContent = ` / ${clock(Math.floor(duration()))}`;
    timeline.setAttribute('aria-valuemax', String(Math.round(duration())));
    paintMarks();
    paintTime();
  });
  video.addEventListener('error', () => {
    if (video.getAttribute('src')) o.onError();
  });

  let loads = 0;
  return {
    element,
    video,
    load(url, { audio, resume }) {
      const token = ++loads;
      problem.classList.add('hidden');
      element.classList.toggle('audio', audio);
      video.src = url;
      video.addEventListener('loadedmetadata', () => {
        if (token !== loads) return;
        if (resume && resume < duration() - 1) video.currentTime = resume;
        paintMarks();
        paintTime();
        o.onReady();
      }, { once: true });
    },
    release() {
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
    setMarks(next) {
      marks = next;
      paintMarks();
    },
    setProblem(nodes) {
      problem.classList.toggle('hidden', !nodes);
      problem.replaceChildren(...(nodes ?? []));
    },
    toggle,
    play,
    pause,
    seek(t, andPlay = false) {
      video.currentTime = clamp(t);
      if (andPlay) play();
      else pause();
      paintTime();
    },
    nudge(s) {
      video.currentTime = clamp(video.currentTime + s);
    },
    step,
    mute,
    duration,
    time: () => video.currentTime || 0,
    playing: () => !video.paused && !video.ended,
  };
}
