/**
 * VR mode: the office in a VR headset (a Meta Quest's browser, over WebXR), walked about at your
 * real height, with your hands on the controllers and every window floating in front of you (see
 * docs/vr.md).
 *
 * All this loads is the 🥽 Enter VR button, and only where the browser says a VR headset is there:
 * a desktop gets nothing at all. The rest of VR (session.ts, and everything it starts) loads once
 * you press it, and how someone else in a headset turns their head and moves their hands
 * (remote.ts) with the first word of it.
 */
import type { Ctx } from '../../core/context';
import type { FrameLoop } from '../../core/loop';
import type { Parts } from '../../core/parts';
import { toast } from '../../ui/dom';
import { type VrButton, vrButton } from './button';
import type { VrDebug } from './types';

/**
 * What VR asks the headset for: the floor (else it makes do with where your head started) and layers.
 * Not the play area ('bounded-floor'): nothing here uses it, and it was the one thing asked for that
 * touches the shape of your room, which the Quest guards with its spatial-data prompts.
 */
export const SESSION_INIT: XRSessionInit = { optionalFeatures: ['local-floor', 'layers'] };

/** The parts VR reaches for. */
export type VrParts = Pick<Parts, 'stage' | 'pointer' | 'peers' | 'focus'>;

export interface VrDeps {
  /** The office's frame loop, which a session borrows (see FrameLoop). */
  readonly loop: FrameLoop;
}

/** The browser's own Enter VR offer (the Quest's, in its address bar), where there is one. */
type Offering = XRSystem & { offerSession?(mode: XRSessionMode, init?: XRSessionInit): Promise<XRSession> };

export function installVr(ctx: Ctx, parts: VrParts, deps: VrDeps): void {
  // Someone else in a headset: their head turning and their hands, on a screen too.
  ctx.messages.on('peer.vr', (m) => void import('./remote').then((r) => r.peerPose(ctx, parts, m)));

  const xr = navigator.xr as Offering | undefined;
  // WebXR only comes to a secure page (https, or localhost).
  if (!xr || !window.isSecureContext) return;
  /** For the console and the headless checks: window.__vr. */
  const debug: VrDebug = { presenting: false, frames: 0, profile: '' };
  (window as unknown as { __vr: VrDebug }).__vr = debug;

  let button: VrButton | null = null;
  /** The session you're in, or are being put in. */
  let session: XRSession | null = null;
  /** The headset's been asked for one, and hasn't answered yet. */
  let asking = false;
  let offered = false;

  /** A headset there (now, or plugged in later): the button, and the browser's own offer. */
  async function check() {
    if (button || !(await xr!.isSessionSupported('immersive-vr').catch(() => false))) return;
    button ??= vrButton(press);
    offer();
  }
  void check();
  xr.addEventListener('devicechange', () => void check());

  function press() {
    if (session) return void (debug.presenting && session.end().catch(() => {}));
    if (asking) return;
    // Asked for first, while the click still counts as one.
    const asked = xr!.requestSession('immersive-vr', SESSION_INIT);
    asking = true;
    button?.set('busy');
    asked
      .then(begin, (err: unknown) => {
        console.warn('VR: no session', err);
        button?.set('enter');
        toast("🥽 The headset didn't start VR", 'warn');
      })
      .finally(() => (asking = false));
  }

  /** The browser's own Enter VR (the Quest shows one by the address), for whenever you aren't in VR. */
  function offer() {
    if (!xr!.offerSession || offered || session) return;
    offered = true;
    xr!.offerSession('immersive-vr', SESSION_INIT).then(
      (s) => {
        offered = false;
        if (session) void s.end().catch(() => {});
        else void begin(s);
      },
      () => void (offered = false),
    );
  }

  async function begin(s: XRSession) {
    session = s;
    button?.set('busy');
    s.addEventListener('end', ended, { once: true });
    try {
      const { startSession } = await import('./session');
      await startSession(ctx, parts, deps, s);
      if (session === s) button?.set('leave');
    } catch (err) {
      console.error('VR: the session failed to start', err);
      toast("🥽 VR didn't start", 'warn');
      void s.end().catch(() => {});
    }
  }

  /** Out of VR (the session ended, however it did): the button says Enter VR again, and the browser offers it. */
  function ended() {
    session = null;
    button?.set('enter');
    offer();
  }
}
