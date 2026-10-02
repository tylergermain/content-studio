/**
 * What the two monitors on the boss's desk show: the boss's and the one back to back with it, facing
 * the guests. Both show the same thing, and every browser on the floor works it out the same way:
 * the screen whoever's in the boss's chair is sharing (their real one, or the game on their monitor,
 * see index.ts), or else a card saying who's at the desk and what they're up to.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { deskCard, hasBossDesk, type DeskPerson } from './desk';

const W = 960;
const H = 540;
const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';

/** One line of the card, shrunk until it fits across. */
function line(g: CanvasRenderingContext2D, text: string, weight: number, size: number, y: number) {
  let px = size;
  do {
    g.font = `${weight} ${px}px ${FONT}`;
  } while (g.measureText(text).width > W - 120 && (px -= 4) > 24);
  g.fillText(text, W / 2, y);
}

/** The card the monitors show with no picture to show (see deskCard). */
function paintCard(g: CanvasRenderingContext2D, card: { icon: string; title: string; line: string }) {
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#2b2d42');
  grad.addColorStop(1, '#3d5a80');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#fffaf3';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 140px ${FONT}`;
  g.fillText(card.icon, W / 2, 180);
  line(g, card.title, 900, 76, 330);
  g.globalAlpha = 0.8;
  line(g, card.line, 800, 44, 420);
  g.globalAlpha = 1;
}

/** The boss's screen playing on the monitors. */
interface Live {
  stream: MediaStream;
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
}

/**
 * Registers the monitors' tick ('world'). `at` says who's at the desk now. What it hands back is the
 * boss's screen as this browser has it: yours if you're the boss, or theirs once it has reached you.
 */
export function deskScreens(ctx: Ctx, at: () => { boss: DeskPerson | null }): { stream(): MediaStream | null } {
  const { voice, office } = ctx;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const card = new THREE.CanvasTexture(canvas);
  card.colorSpace = THREE.SRGBColorSpace;
  /** What the card last said, so it's only painted again when that changes. */
  let said = '';
  // Canvas text only picks up the office's font once it has loaded.
  void document.fonts.ready.then(() => (said = ''));
  let live: Live | null = null;

  function stream(): MediaStream | null {
    const { boss } = at();
    if (!boss) return null;
    return boss.id === store.you ? voice.localScreen : (voice.remoteScreens().get(boss.id) ?? null);
  }

  ctx.ticks.add('world', () => {
    // Off the floor, or on one without the desk: nothing's kept playing on monitors nobody can see (the card stays on them).
    const there = !ctx.upTop() && hasBossDesk(office.room.get());
    const now = there ? stream() : null;
    if (live?.stream !== now) {
      if (live) {
        live.video.srcObject = null;
        live.texture.dispose();
        live = null;
      }
      if (now) {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.srcObject = now;
        void video.play().catch(() => {});
        const texture = new THREE.VideoTexture(video);
        texture.colorSpace = THREE.SRGBColorSpace;
        live = { stream: now, video, texture };
      }
    }
    if (there && !live) {
      const { boss } = at();
      // They're sharing, and it hasn't reached this browser yet.
      const c = deskCard(boss, !!boss?.sharing);
      const say = `${c.icon}|${c.title}|${c.line}`;
      if (say !== said) {
        said = say;
        paintCard(canvas.getContext('2d')!, c);
        card.needsUpdate = true;
      }
    }
    const map = live?.texture ?? card;
    for (const screen of [office.bossScreen, office.guestScreen]) {
      const mat = screen.material as THREE.MeshBasicMaterial;
      if (mat.map === map) continue;
      mat.map = map;
      mat.color.set('#ffffff');
      mat.toneMapped = false;
      mat.needsUpdate = true;
    }
  });

  return { stream };
}
