// Your webcam: asking the browser for it, the one you picked (remembered in this browser), and letting
// go of it, which is what turns its light off. It never starts by itself: only start() does, and
// only you call that (the key, the menu, Settings).

import { camScale, cameraConstraints } from './logic';

const KEY = 'agent-office.webcam';

/** The camera you picked last in this browser, if you picked one. */
export function pickedCamera(): string | null {
  try {
    return localStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}

function rememberCamera(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked
  }
}

/** Off; asked for and not there yet (the browser may be asking you); or on. */
export type WebcamState = 'off' | 'starting' | 'on';

export class Webcam {
  state: WebcamState = 'off';
  /** What it's sending while it's on: the picture, and how far it's shrunk to go out (see camScale). */
  stream: MediaStream | null = null;
  scale = 1;
  private readonly listeners = new Set<() => void>();
  /** Counts each start and stop, so a start that's overtaken lets go of what it gets. */
  private turn = 0;

  get track(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  /** Hands back what stops it hearing. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private set(state: WebcamState) {
    this.state = state;
    this.listeners.forEach((fn) => fn());
  }

  /** Turns it on, with the camera you picked (or `deviceId`). Says what went wrong, or null. */
  async start(deviceId = pickedCamera()): Promise<string | null> {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return 'Your webcam needs HTTPS (or localhost), like voice does.';
    const turn = ++this.turn;
    this.release();
    this.set('starting');
    let stream: MediaStream;
    try {
      stream = await this.ask(deviceId);
    } catch (err) {
      if (turn === this.turn) this.set('off');
      const name = (err as Error).name;
      if (name === 'NotAllowedError') return 'The browser isn’t letting the office use your camera. Allow it in the site settings (left of the address).';
      if (name === 'NotFoundError') return 'No webcam found.';
      if (name === 'NotReadableError') return 'Your webcam is busy: another app may have it.';
      return `Webcam unavailable: ${(err as Error).message}`;
    }
    if (turn !== this.turn) {
      stream.getTracks().forEach((t) => t.stop());
      return null;
    }
    const track = stream.getVideoTracks()[0];
    // Unplugged, or taken away by the browser: off, as if you'd turned it off.
    track.addEventListener('ended', () => {
      if (this.stream === stream) this.stop();
    });
    const { width, height } = track.getSettings();
    this.scale = camScale(width, height);
    this.stream = stream;
    this.set('on');
    return null;
  }

  /** The camera picked, or any if that one's gone. */
  private async ask(deviceId: string | null): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(deviceId), audio: false });
    } catch (err) {
      const name = (err as Error).name;
      if (!deviceId || (name !== 'OverconstrainedError' && name !== 'NotFoundError')) throw err;
      return navigator.mediaDevices.getUserMedia({ video: cameraConstraints(), audio: false });
    }
  }

  /** Turns it off: the camera stops, and its light goes out. */
  stop() {
    this.turn++;
    if (this.state === 'off') return;
    this.release();
    this.set('off');
  }

  private release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  /** The cameras there are to pick from. Their names only come once the browser has let the office use one. */
  async cameras(): Promise<MediaDeviceInfo[]> {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    } catch {
      return [];
    }
  }

  /** The camera it uses: the one it's using now, else the one picked last. */
  get deviceId(): string | null {
    return this.track?.getSettings().deviceId ?? pickedCamera();
  }

  /** Picks the camera to use, remembered in this browser; on, it switches to it now. */
  async pick(deviceId: string): Promise<string | null> {
    rememberCamera(deviceId);
    return this.state === 'off' ? null : this.start(deviceId);
  }
}
