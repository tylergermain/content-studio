// Where Friday One was left, kept in the office's data folder's heli.json ({version: 1, pose, pad}) and
// written each time it's parked or sets down, so a restart finds it where it was: land it on the beach
// and it's still on the beach. A file that won't read is logged, the helicopter starts at home on its
// pad, and the file is moved aside (heli.json.corrupt-<ms>) before anything is written over it.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GROUNDS } from '../../shared/mainstreet.js';
import type { HeliPose } from '../../shared/protocol.js';

/** Where it's parked, as heli.json keeps it. */
export interface Parked {
  pose: HeliPose;
  pad: 'park' | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** What a heli.json says, or why it can't be read. */
function parseParked(raw: unknown): Parked | string {
  if (!raw || typeof raw !== 'object') return 'not an object';
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return `version ${JSON.stringify(r.version)}, not 1`;
  const p = r.pose as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object' || ![p.x, p.h, p.z, p.yaw].every(isNum)) return 'no pose';
  const [x, h, z, yaw] = [p.x, p.h, p.z, p.yaw] as number[];
  // Parked is on the ground, somewhere in town.
  if (Math.abs(x) > GROUNDS || Math.abs(z) > GROUNDS || h < -0.5 || h > 1) return `parked somewhere it can't be (${x}, ${h}, ${z})`;
  if (r.pad !== 'park' && r.pad !== null && r.pad !== undefined) return `pad ${JSON.stringify(r.pad)}`;
  return { pose: { x, h: Math.max(0, h), z, yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)), pitch: 0, roll: 0, spin: 0 }, pad: r.pad === 'park' ? 'park' : null };
}

/** heli.json in `dir`. */
export class HeliFile {
  readonly file: string;
  /** It's there but wouldn't read: it's moved aside before the next write, never written over. */
  private unreadable = false;

  constructor(dir: string) {
    this.file = path.join(dir, 'heli.json');
  }

  /** Where it was left: null with no file yet, or one that won't read (which is logged). */
  load(): Parked | null {
    if (!existsSync(this.file)) return null;
    let why: string;
    try {
      const got = parseParked(JSON.parse(readFileSync(this.file, 'utf8')));
      if (typeof got !== 'string') return got;
      why = got;
    } catch (err) {
      why = (err as Error).message;
    }
    this.unreadable = true;
    console.error(`agent-office: couldn't read ${this.file} (${why}): Friday One starts on its pad, and the file is moved aside when it's next parked`);
    return null;
  }

  /** Keeps where it's parked now: written whole and renamed into place, so nothing ever reads half a file. */
  save(parked: Parked): void {
    const { x, h, z, yaw } = parked.pose;
    try {
      if (this.unreadable) {
        const aside = `${this.file}.corrupt-${Date.now()}`;
        if (existsSync(this.file)) renameSync(this.file, aside);
        this.unreadable = false;
        console.error(`agent-office: moved the unreadable ${this.file} to ${aside}`);
      }
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, pose: { x, h, z, yaw, pitch: 0, roll: 0, spin: 0 }, pad: parked.pad }, null, 2), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      console.error(`agent-office: couldn't save ${this.file}: ${(err as Error).message}`);
    }
  }
}
