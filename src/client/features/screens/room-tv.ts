import * as THREE from 'three';
import { ROOM_MEDIA, type Piece } from '../../../shared/furniture';
import { layoutFurniture } from '../../../shared/office-builder';
import { projectRoomAt } from '../../../shared/project-rooms';
import { store } from '../../state';
import { roomCard } from './card';

// The TVs in project rooms (a screen whose media is ROOM_MEDIA): each shows its room's app as the office last
// photographed it (server/room-screens.ts), which it asks after every POLL_MS while one's on the floor, with a caption
// along the bottom saying whose it is and which branch, or a card saying there's no app running there yet.

const POLL_MS = 8000;
const W = 1280;
const H = 720;

interface Shot {
  at: number;
  texture: THREE.CanvasTexture;
  ready: boolean;
}

/** What the office says of a TV's picture: when it was taken, and whose server it is, its branch and how many more apps the room has running. */
interface Seen {
  at: number;
  who?: string;
  branch?: string;
  also?: number;
}

/** The caption along the bottom of a TV's picture: the branch and whose server it is, or that it's the room's own app address. */
function caption(g: CanvasRenderingContext2D, s: Seen) {
  const text = [s.branch ? `\u2387 ${s.branch}` : '', s.who ?? (s.branch ? '' : 'Its app address'), s.also ? `+${s.also} more running` : ''].filter(Boolean).join('   \u00b7   ');
  g.font = '600 28px system-ui, -apple-system, "Segoe UI", sans-serif';
  const w = Math.min(W - 48, g.measureText(text).width + 40);
  g.fillStyle = 'rgba(14, 14, 20, 0.8)';
  g.beginPath();
  g.roundRect(24, H - 76, w, 52, 12);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textBaseline = 'middle';
  g.fillText(text, 44, H - 50, w - 40);
}

export class RoomTvs {
  private shots = new Map<string, Shot>();
  private cards = new Map<string, THREE.CanvasTexture>();
  private floor: string | null = null;
  private askedAt = -Infinity;
  private asking = false;
  private wanted = false;

  /** What the TV `piece` shows now: its room's app, or the card. */
  texture(piece: Piece): THREE.Texture {
    this.wanted = true;
    const room = projectRoomAt(layoutFurniture(store.floorPlan), piece.x, piece.z);
    if (!room) return this.card('', 'This TV isn\u2019t in a project room');
    const shot = this.shots.get(room.id);
    return shot?.ready ? shot.texture : this.card(room.text ?? '');
  }

  /** The project room (its table) the screen `piece` is in: whose app it shows, and E reviews. */
  roomOf(piece: Piece | undefined): { id: string; name: string } | undefined {
    if (piece?.media !== ROOM_MEDIA) return undefined;
    const room = projectRoomAt(layoutFurniture(store.floorPlan), piece.x, piece.z);
    return room ? { id: room.id, name: room.text || 'This table' } : undefined;
  }

  /** What looking at the screen `piece` says: whose app it shows, or that there's none yet. Nothing for a screen that isn't a table's. */
  hint(piece: Piece | undefined): { room: string; status: string } | undefined {
    if (piece?.media !== ROOM_MEDIA) return undefined;
    const room = this.roomOf(piece);
    if (!room) return { room: 'Room TV', status: 'Not in a project room' };
    return { room: room.name, status: this.shots.get(room.id)?.ready ? 'its app, live' : 'no app running yet' };
  }

  private card(room: string, why?: string): THREE.CanvasTexture {
    const key = `${room}\n${why ?? ''}`;
    let t = this.cards.get(key);
    if (!t) this.cards.set(key, (t = roomCard(room, why)));
    return t;
  }

  /** Each frame: what the rooms have to show is asked after again now and then, while a room's TV is up. */
  tick(now: number, floor: string | null) {
    if (floor !== this.floor) {
      for (const s of this.shots.values()) s.texture.dispose();
      this.shots.clear();
      this.floor = floor;
      this.askedAt = -Infinity;
    }
    if (this.wanted && floor && !this.asking && now - this.askedAt > POLL_MS) void this.ask(floor, now);
    this.wanted = false;
  }

  private async ask(floor: string, now: number) {
    this.asking = true;
    this.askedAt = now;
    try {
      const res = await fetch(`/api/room-screens?${new URLSearchParams({ floor })}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok || floor !== this.floor) return;
      const { rooms } = (await res.json()) as { rooms: Record<string, Seen> };
      for (const [room, shot] of Object.entries(rooms)) {
        const had = this.shots.get(room);
        if (had?.at === shot.at) continue;
        this.load(floor, room, shot, had);
      }
      for (const [room, s] of this.shots) if (!rooms[room]) (s.texture.dispose(), this.shots.delete(room));
    } catch {
      // asked again in a moment
    } finally {
      this.asking = false;
    }
  }

  /** The picture `seen` of `room`, drawn onto its TV's canvas with its caption once it's in (the last one stays up till then). */
  private load(floor: string, room: string, seen: Seen, had: Shot | undefined) {
    const at = seen.at;
    let shot = had;
    if (!shot) {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.shots.set(room, (shot = { at, texture, ready: false }));
    }
    shot.at = at;
    const img = new Image();
    img.decoding = 'async';
    img.addEventListener('load', () => {
      if (floor !== this.floor || this.shots.get(room) !== shot) return;
      const canvas = shot!.texture.image as HTMLCanvasElement;
      const g = canvas.getContext('2d')!;
      g.drawImage(img, 0, 0, W, H);
      caption(g, seen);
      shot!.texture.needsUpdate = true;
      shot!.ready = true;
    });
    img.src = `/api/room-screen?${new URLSearchParams({ floor, room, v: String(at) })}`;
  }
}
