import './ui.css';
import { FLIGHT } from '../../../shared/heli';
import { h } from '../../ui/dom';

// Friday One's chip at the top of the screen while you're aboard: how high over the street, how fast
// and which way it's heading, what it's doing (hovering, landed, or why it can't set down here), and
// who's aboard with you. It's glass over the office like the golf meter, and takes no clicks.

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Its heading as a compass reads it, from its yaw (0 noses south, down +z; north is -z): "NW 315°". */
export function compass(yaw: number): string {
  const deg = Math.round(((Math.atan2(Math.sin(yaw), -Math.cos(yaw)) * 180) / Math.PI + 360) % 360) % 360;
  return `${POINTS[Math.round(deg / 45) % 8]} ${deg}°`;
}

/** What it's doing, as the chip says it: `tone` good while it flies, calm on the ground, warn where it can't land. */
export interface HeliStatus {
  text: string;
  tone: 'good' | 'calm' | 'warn';
}

/**
 * What the chip says it's doing: down (or spooling up, at the controls with the engine on), why it
 * can't set down where it is (`why`), flying itself home with nobody at the controls, hovering, or flying.
 */
export function heliStatus(o: { landed: boolean; home: boolean; speed: number; spin: number; why: string | null; engine: boolean }): HeliStatus {
  if (o.landed) return o.engine && o.spin < FLIGHT.lift ? { text: `Spinning up · ${Math.round((o.spin / FLIGHT.lift) * 100)}%`, tone: 'calm' } : { text: 'Landed', tone: 'calm' };
  if (o.why) return { text: o.why, tone: 'warn' };
  if (o.home) return { text: 'Flying itself home', tone: 'calm' };
  return o.speed < 1.5 ? { text: 'Hover', tone: 'good' } : { text: 'Flying', tone: 'good' };
}

/** What the chip shows. */
export interface HudFacts {
  /** "at the controls", or who's flying it. */
  role: string;
  /** Meters over the street, m/s along the ground, and its yaw. */
  height: number;
  speed: number;
  yaw: number;
  status: HeliStatus;
  /** Who else is riding along, by name. */
  crew: string[];
}

/** The chip's lines of text (see HeliHud.shown). */
type Line = 'role' | 'height' | 'speed' | 'heading' | 'status' | 'crew';

export class HeliHud {
  private readonly el: HTMLElement;
  private readonly role = h('small');
  private readonly height = h('span');
  private readonly speed = h('span');
  private readonly heading = h('span');
  private readonly status = h('div.heli-status');
  private readonly crew = h('div.heli-crew');
  /** What each part shows now, so a frame that changes nothing touches nothing. */
  private readonly shown = { role: '', height: '', speed: '', heading: '', status: '', tone: '', crew: '' };

  constructor(parent: HTMLElement) {
    const unit = (u: string) => h('span.unit', {}, u);
    this.el = h(
      'div.heli-hud.panel.hidden',
      { id: 'heli-hud', 'aria-label': 'Friday One', role: 'status' },
      h('div.heli-title', {}, '🚁 Friday One ', this.role),
      h('div.heli-stats', {}, '↑ ', this.height, unit(' m'), ' · ', this.speed, unit(' km/h'), ' · ', this.heading),
      this.status,
      this.crew,
    );
    parent.append(this.el);
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
  }

  render(f: HudFacts) {
    this.text('role', this.role, f.role);
    this.text('height', this.height, String(Math.max(0, Math.round(f.height))));
    this.text('speed', this.speed, String(Math.round(f.speed * 3.6)));
    this.text('heading', this.heading, compass(f.yaw));
    this.text('status', this.status, f.status.text);
    if (f.status.tone !== this.shown.tone) {
      this.shown.tone = f.status.tone;
      this.status.classList.toggle('warn', f.status.tone === 'warn');
      this.status.classList.toggle('calm', f.status.tone === 'calm');
    }
    this.text('crew', this.crew, f.crew.length ? `Riding along: ${f.crew.join(', ')}` : '');
    this.crew.classList.toggle('hidden', !f.crew.length);
  }

  private text(key: Line, el: HTMLElement, text: string) {
    if (this.shown[key] === text) return;
    this.shown[key] = text;
    el.textContent = text;
  }
}
