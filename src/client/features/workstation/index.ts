/**
 * Team desks: a desk of your own, put on the floor with the office builder (see shared/furniture.ts).
 * Sitting down at one shares your screen (the browser asks which), and it goes up on the desk's monitor
 * for everyone on the floor, as well as on the TV; getting up stops sharing again.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { toast } from '../../ui/dom';

/** What a team desk's monitor shows while nobody's sharing at it. */
function idleScreen(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 374;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 640, 374);
  grad.addColorStop(0, '#2b2d42');
  grad.addColorStop(1, '#3d5a80');
  g.fillStyle = grad;
  g.fillRect(0, 0, 640, 374);
  g.fillStyle = '#fffaf3';
  g.textAlign = 'center';
  g.font = '900 96px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText('💻', 320, 190);
  g.font = '800 34px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText('Sit down to share your screen', 320, 270);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A shared screen playing on a monitor. */
interface Live {
  stream: MediaStream;
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
}

/** Registers the team desks' ticks: who's sitting at one, and what's on each one's monitor. */
export function installWorkstation(ctx: Ctx) {
  const { voice, office, player } = ctx;
  const idle = idleScreen();
  const live = new Map<string, Live>();
  /** The team desk you're sitting at, and whether sitting down there is what started your share (so getting up stops it). */
  let sat: string | null = null;
  let started = false;

  async function sitDown() {
    // Sharing already (from the menu, or the TV): that's the screen that goes up, and it's yours to stop.
    if (voice.sharing) return;
    started = true;
    const err = await voice.startShare();
    if (err) toast(err, 'warn');
    if (!voice.sharing) started = false;
    // Up again before the browser had its answer.
    else if (!sat) gotUp();
    else toast('🖥️ Your screen is up on your desk. Get up to stop sharing.');
  }

  function gotUp() {
    if (started && voice.sharing) voice.stopShare();
    started = false;
  }

  // Straight after you sit down, while the key press that did it still lets the browser ask what to share.
  ctx.ticks.add('me', () => {
    const seat = player.seat && ctx.inOffice() ? ctx.plan().seatingById.get(player.seat.seatId) : undefined;
    const now = seat?.share ? seat.id : null;
    if (now === sat) return;
    sat = now;
    if (now) void sitDown();
    else gotUp();
  });

  /** The screen being shared at the team desk `id`: yours if you're the one sitting there, else whoever's is. */
  function screenAt(id: string, remote: Map<string, MediaStream>): MediaStream | null {
    const key = `${id}:0`;
    if (player.seat?.key === key) return voice.localScreen;
    for (const p of store.peers.values()) if (p.seat === key && p.id !== store.you && store.onMyFloor(p)) return remote.get(p.id) ?? null;
    return null;
  }

  function stop(id: string) {
    const l = live.get(id);
    if (!l) return;
    l.video.srcObject = null;
    l.texture.dispose();
    live.delete(id);
  }

  ctx.ticks.add('world', () => {
    if (!ctx.inOffice() || ctx.upTop()) return;
    const remote = voice.remoteScreens();
    const desks = new Set<string>();
    for (const v of office.furniture.all()) {
      if (!v.screen) continue;
      const id = v.piece.id;
      desks.add(id);
      const stream = v.away ? null : screenAt(id, remote);
      if (live.get(id)?.stream !== stream) {
        stop(id);
        if (stream) {
          const video = document.createElement('video');
          video.muted = true;
          video.playsInline = true;
          video.autoplay = true;
          video.srcObject = stream;
          void video.play().catch(() => {});
          const texture = new THREE.VideoTexture(video);
          texture.colorSpace = THREE.SRGBColorSpace;
          live.set(id, { stream, video, texture });
        }
      }
      // The monitor's a new one whenever its desk is built again (painted another color), so it's checked every frame.
      const map = live.get(id)?.texture ?? idle;
      const mat = v.screen.material;
      if (mat.map !== map) {
        mat.map = map;
        mat.color.set('#ffffff');
        mat.toneMapped = false;
        mat.needsUpdate = true;
      }
    }
    for (const id of [...live.keys()]) if (!desks.has(id)) stop(id);
  });
}
