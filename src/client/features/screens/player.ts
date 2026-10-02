/**
 * One video screen's picture: the file it's playing (a muted video that's never in the page, or a
 * picture), fitted on the screen's face without stretching it, and the card it shows while there's
 * nothing to play. index.ts says what plays and when; this loads it, shows it and lets go of it.
 */
import * as THREE from 'three';
import type { ScreenMesh } from '../../world/office/furniture-kit';
import { DRAWN_SIDE, MAX_SIDE, SLIDE_SECONDS, capSize, fitOn, mediaUrl, type Fit, type MediaFile } from './playlist';

/** What a screen's face is while it's off, as the furniture builds it (see screenMesh). */
const OFF = '#1b1d2e';
/** The blurred fill behind a picture that doesn't cover the face: this big, redrawn this often (in seconds). */
const FILL = { w: 64, h: 36, every: 0.2 };

/** A file on a screen, or on its way to one. */
interface Clip {
  file: MediaFile;
  /** A video's element; a picture has none. */
  video?: HTMLVideoElement;
  /** What's drawn of it: the picture, capped, or a video too big to hand the graphics card as it is, a frame at a time. */
  canvas?: HTMLCanvasElement;
  /** A video frame has come that the canvas doesn't have yet. */
  fresh: boolean;
  texture?: THREE.Texture;
  w: number;
  h: number;
  /** Takes its listeners off, and whatever else was waiting on it. */
  quit: AbortController;
}

/** One unit square for every screen's picture, sized by its mesh: never let go of with a piece (see disposePiece). */
const SQUARE = new THREE.PlaneGeometry(1, 1);

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export interface PlayerHooks {
  /** `file` came to its end (a video that doesn't loop), or has had its turn (a picture). */
  ended(file: MediaFile): void;
  /** `file` wouldn't load or play here; `played` when it had been playing until now (the office went away under it). */
  failed(file: MediaFile, played: boolean): void;
}

export class ScreenPlayer {
  /** The face it's on: a new one whenever its piece is built again (see attach). */
  private face: ScreenMesh | null = null;
  /** The picture itself, a hair in front of the face, as much of the face as it takes. */
  private readonly picture: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private clip: Clip | null = null;
  /** What's coming next: the last one stays up until this has a frame to show. */
  private coming: Clip | null = null;
  private fit: Fit | null = null;
  private card: THREE.Texture | null = null;
  private fill: { g: CanvasRenderingContext2D; texture: THREE.CanvasTexture; age: number } | null = null;
  private active = false;
  /** How long the picture that's up has been up, while you could see it. */
  private shown = 0;

  constructor(
    private readonly floor: string,
    private readonly hooks: PlayerHooks,
  ) {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    mat.userData.outlineParameters = { visible: false };
    this.picture = new THREE.Mesh(SQUARE, mat);
    this.picture.userData.shared = true;
    this.picture.position.z = 0.003;
    this.picture.visible = false;
  }

  /** The file that's up, or on its way up. */
  get file(): MediaFile | null {
    return (this.coming ?? this.clip)?.file ?? null;
  }

  /** How far into its video it is, in seconds, and the picture's own size (for the window that opens on it). */
  get time(): number {
    return this.clip?.video?.currentTime ?? 0;
  }

  get size(): { w: number; h: number } | null {
    return this.clip ? { w: this.clip.w, h: this.clip.h } : null;
  }

  /** Puts its picture on `face`: the screen's own mesh, which is a new one once its piece is repainted. */
  attach(face: ScreenMesh) {
    if (face === this.face && this.picture.parent === face) return;
    this.face = face;
    face.add(this.picture);
    this.dress();
  }

  /**
   * Plays `file`, `phase` of the way into it (0 to 1) and round again by itself when `loop`. Whatever's
   * up stays up until this has a frame to show.
   */
  play(file: MediaFile, loop: boolean, phase = 0) {
    const same = (c: Clip | null) => !!c && c.file.name === file.name && c.file.size === file.size;
    // On its way already.
    if (same(this.coming)) return void (this.coming!.video && (this.coming!.video.loop = loop));
    const now = this.clip;
    // The same file again (a list of one, come round): from the top, without fetching it again.
    if (now && !this.coming && same(now)) {
      this.shown = 0;
      if (now.video) {
        now.video.loop = loop;
        now.video.currentTime = 0;
        if (this.active) void now.video.play().catch(() => {});
      }
      return;
    }
    this.drop(this.coming);
    this.coming = file.kind === 'video' ? this.video(file, loop, phase) : this.image(file);
  }

  /** Whether what's playing goes round by itself: with one file to play, rather than on to the next. */
  loop(on: boolean) {
    for (const c of [this.clip, this.coming]) if (c?.video) c.video.loop = on;
    // It had stopped at its end, waiting for the next one, and there's none now.
    const v = this.clip?.video;
    if (on && v?.ended && this.active) void v.play().catch(() => {});
  }

  /** Nothing to play: `card` on the face (or a dark screen, with none), and what was playing let go of. */
  idle(card: THREE.Texture | null) {
    const was = this.card;
    this.card = card;
    if (!this.clip && !this.coming && was === card) return;
    this.drop(this.coming);
    this.drop(this.clip);
    this.coming = this.clip = null;
    this.dress();
  }

  /**
   * Each frame: `active` is whether anyone can see it (you're on the floor, it's in view, the tab's up).
   * While nobody can, the video's paused, so nothing's decoded for no one.
   */
  tick(dt: number, active: boolean) {
    if (active !== this.active) {
      this.active = active;
      for (const c of [this.clip, this.coming]) {
        if (!c?.video) continue;
        if (active && !c.video.ended) void c.video.play().catch(() => {});
        else if (!active) c.video.pause();
      }
    }
    const clip = this.clip;
    if (!active || !clip) return;
    if (clip.video) {
      if (clip.canvas && (clip.fresh || !('requestVideoFrameCallback' in clip.video))) this.draw(clip);
    } else if (!this.coming && (this.shown += dt) >= SLIDE_SECONDS) {
      this.shown = 0;
      this.hooks.ended(clip.file);
    }
    // The blurred fill follows the video, a few times a second.
    if (this.fill && this.fit && !this.fit.cover && clip.video && (this.fill.age += dt) >= FILL.every) this.blur(clip);
  }

  /** Lets go of everything: the videos, the textures, and its picture off the face (which goes dark). */
  dispose() {
    this.drop(this.coming);
    this.drop(this.clip);
    this.coming = this.clip = null;
    this.card = null;
    this.dress();
    this.picture.removeFromParent();
    this.picture.material.dispose();
    this.fill?.texture.dispose();
    this.fill = null;
    this.face = null;
  }

  private video(file: MediaFile, loop: boolean, phase: number): Clip {
    const video = document.createElement('video');
    const clip: Clip = { file, video, fresh: false, w: 0, h: 0, quit: new AbortController() };
    const { signal } = clip.quit;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = loop;
    video.preload = 'auto';
    video.disablePictureInPicture = true;
    video.addEventListener(
      'loadedmetadata',
      () => {
        if (phase > 0 && Number.isFinite(video.duration)) video.currentTime = video.duration * Math.min(phase, 0.95);
      },
      { signal },
    );
    video.addEventListener(
      'loadeddata',
      () => {
        clip.w = video.videoWidth;
        clip.h = video.videoHeight;
        // Sound only: nothing to show.
        if (!clip.w || !clip.h) return this.fail(clip);
        if (Math.max(clip.w, clip.h) > MAX_SIDE) {
          const to = capSize(clip.w, clip.h, DRAWN_SIDE);
          clip.canvas = canvasOf(to.w, to.h)[0];
          const texture = new THREE.CanvasTexture(clip.canvas);
          texture.generateMipmaps = false;
          texture.minFilter = THREE.LinearFilter;
          clip.texture = texture;
          this.draw(clip);
          if ('requestVideoFrameCallback' in video) {
            const frame = () => {
              if (signal.aborted) return;
              clip.fresh = true;
              video.requestVideoFrameCallback(frame);
            };
            video.requestVideoFrameCallback(frame);
          }
        } else clip.texture = new THREE.VideoTexture(video);
        this.show(clip);
      },
      { signal },
    );
    // (With the next one on its way already, there's nothing to ask for.)
    video.addEventListener('ended', () => clip === this.clip && !this.coming && this.hooks.ended(file), { signal });
    video.addEventListener('error', () => this.fail(clip), { signal });
    video.src = mediaUrl(this.floor, file.name, file.size);
    if (this.active) void video.play().catch(() => {});
    return clip;
  }

  private image(file: MediaFile): Clip {
    const img = new Image();
    const clip: Clip = { file, fresh: false, w: 0, h: 0, quit: new AbortController() };
    const { signal } = clip.quit;
    img.decoding = 'async';
    img.addEventListener(
      'load',
      () => {
        // A drawing with no size of its own (some SVGs) is drawn as big as a screen.
        clip.w = img.naturalWidth || 1280;
        clip.h = img.naturalHeight || 720;
        const to = capSize(clip.w, clip.h, DRAWN_SIDE);
        const [canvas, g] = canvasOf(to.w, to.h);
        g.drawImage(img, 0, 0, to.w, to.h);
        clip.canvas = canvas;
        clip.texture = new THREE.CanvasTexture(canvas);
        this.show(clip);
      },
      { signal },
    );
    img.addEventListener('error', () => this.fail(clip), { signal });
    img.src = mediaUrl(this.floor, file.name, file.size);
    return clip;
  }

  /** `clip` has a frame: it takes the last one's place. */
  private show(clip: Clip) {
    if (clip !== this.coming || !clip.texture) return;
    this.drop(this.clip);
    this.clip = clip;
    this.coming = null;
    this.shown = 0;
    clip.texture.colorSpace = THREE.SRGBColorSpace;
    this.dress();
    // Stopped at its end before anything came to take its place (it loaded while it played out).
    if (clip.video?.ended) this.hooks.ended(clip.file);
  }

  private fail(clip: Clip) {
    if (clip !== this.coming && clip !== this.clip) return;
    const played = clip === this.clip;
    if (played) this.clip = null;
    else this.coming = null;
    this.drop(clip);
    if (!this.clip) this.dress();
    this.hooks.failed(clip.file, played);
  }

  private drop(clip: Clip | null) {
    if (!clip) return;
    clip.quit.abort();
    if (clip.video) {
      clip.video.pause();
      clip.video.removeAttribute('src');
      clip.video.load();
    }
    clip.texture?.dispose();
  }

  /** A frame of a video that's drawn down (see MAX_SIDE), onto its canvas. */
  private draw(clip: Clip) {
    if (!clip.canvas || !clip.video || !clip.texture) return;
    clip.canvas.getContext('2d')!.drawImage(clip.video, 0, 0, clip.canvas.width, clip.canvas.height);
    clip.texture.needsUpdate = true;
    clip.fresh = false;
  }

  /** The fill behind a picture that doesn't cover the face: the picture itself, covering it, small, blurred and dimmed. */
  private blur(clip: Clip) {
    if (!this.fill) {
      const [canvas, g] = canvasOf(FILL.w, FILL.h);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      this.fill = { g, texture, age: 0 };
    }
    const { g, texture } = this.fill;
    this.fill.age = 0;
    const from = clip.video ?? clip.canvas;
    if (!from || !clip.w || !clip.h) return;
    // Covering the little canvas, and a bit over its edges, where the blur would fade to nothing.
    const k = Math.max(FILL.w / clip.w, FILL.h / clip.h) * 1.25;
    const w = clip.w * k;
    const h = clip.h * k;
    g.filter = 'blur(2px)';
    g.drawImage(from, (FILL.w - w) / 2, (FILL.h - h) / 2, w, h);
    g.filter = 'none';
    g.fillStyle = 'rgba(8, 9, 14, .58)';
    g.fillRect(0, 0, FILL.w, FILL.h);
    texture.needsUpdate = true;
  }

  /** Makes the face and the picture on it look like what's playing now. */
  private dress() {
    const face = this.face;
    if (!face) return;
    const clip = this.clip;
    const pic = this.picture.material;
    let map: THREE.Texture | null = this.card;
    let color = this.card ? '#ffffff' : OFF;
    this.fit = null;
    if (clip?.texture) {
      const { width, height } = face.geometry.parameters;
      const fit = (this.fit = fitOn(clip.w, clip.h, width, height));
      clip.texture.repeat.set(fit.repeat.x, fit.repeat.y);
      clip.texture.offset.set(fit.offset.x, fit.offset.y);
      this.picture.scale.set(width * fit.scale.x, height * fit.scale.y, 1);
      if (fit.cover) [map, color] = [null, '#000000'];
      else {
        this.blur(clip);
        [map, color] = [this.fill!.texture, '#ffffff'];
      }
    }
    if (pic.map !== (clip?.texture ?? null)) {
      pic.map = clip?.texture ?? null;
      pic.needsUpdate = true;
    }
    this.picture.visible = !!clip?.texture;
    const mat = face.material;
    if (mat.map !== map) {
      mat.map = map;
      mat.needsUpdate = true;
    }
    mat.color.set(color);
    mat.toneMapped = false;
  }
}
