// What a street admin asks to stand on a plot, and the businesses street.json says are on Main Street,
// checked before the office uses either: a name cleaned of anything that isn't text, a color the street
// can paint, a skin and a stage from their lists, and a business's id made from its name. Pure, so the
// registry and the handler share one set of rules and the tests can take them at their word.
import { SEATS } from '../../shared/layout.js';
import { isClaimable, type Claimable } from '../../shared/mainstreet.js';
import {
  BUSINESS_ID,
  BUSINESS_LIMITS,
  BUSINESS_SKINS,
  BUSINESS_STAGES,
  HOST_BUSINESS,
  type BusinessCard,
  type BusinessDef,
  type BusinessHome,
  type BusinessSkin,
  type BusinessStage,
  type PlotLook,
  type StoreyCard,
} from '../../shared/protocol.js';
import { COLOR_RE } from '../office/input.js';

/** How long a business's id may be, and at least how long (BUSINESS_ID). */
const ID_MAX = 20;
const ID_MIN = 2;
/** The most AI workers a business could have at once: one at every seat on every floor it may have. */
const MOST_WORKERS = SEATS.length * BUSINESS_LIMITS.floors;

/** Why a look was turned away, as the admin is told. */
export const LOOK_ERRORS = {
  name: `🏙 A business needs a name, up to ${BUSINESS_LIMITS.name} characters`,
  accent: '🏙 Pick a color for it: #rrggbb',
  skin: `🏙 Pick what it's clad in: ${BUSINESS_SKINS.join(', ')}`,
  stage: '🏙 A claimed plot holds a building site or a shell',
  planned: `🏙 A building stands 1 to ${BUSINESS_LIMITS.storeys} storeys`,
} as const;

/**
 * A business's name as the street shows it: control and other invisible characters dropped, runs of
 * whitespace made one space, and trimmed. Empty when nothing is left, or when it's longer than
 * BUSINESS_LIMITS.name characters (counted as people see them, so an emoji is one): a name is never
 * cut short behind the admin's back.
 */
export function cleanBusinessName(v: unknown): string {
  if (typeof v !== 'string') return '';
  const name = v
    .replace(/[\p{C}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...name].length <= BUSINESS_LIMITS.name ? name : '';
}

/** `v` as a color the street can paint ('#rrggbb', lower case), or '' when it isn't one. */
export const cleanAccent = (v: unknown): string => (typeof v === 'string' && COLOR_RE.test(v) ? v.toLowerCase() : '');

const isSkin = (v: unknown): v is BusinessSkin => typeof v === 'string' && (BUSINESS_SKINS as readonly string[]).includes(v);
const isStage = (v: unknown): v is BusinessStage => typeof v === 'string' && (BUSINESS_STAGES as readonly string[]).includes(v);
const isStoreys = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= BUSINESS_LIMITS.storeys;

/**
 * The look in a claim or an edit, checked field by field. A claim (`whole`) must say all of it; an
 * edit says only what changes, and what it leaves out stays as it was. The first field that won't
 * do turns the whole of it away, with why.
 */
export function lookFrom(m: { [K in keyof PlotLook]?: unknown }, whole: boolean): { look: Partial<PlotLook> } | { error: string } {
  const look: Partial<PlotLook> = {};
  if (whole || m.name !== undefined) {
    const name = cleanBusinessName(m.name);
    if (!name) return { error: LOOK_ERRORS.name };
    look.name = name;
  }
  if (whole || m.accent !== undefined) {
    const accent = cleanAccent(m.accent);
    if (!accent) return { error: LOOK_ERRORS.accent };
    look.accent = accent;
  }
  if (whole || m.skin !== undefined) {
    if (!isSkin(m.skin)) return { error: LOOK_ERRORS.skin };
    look.skin = m.skin;
  }
  if (whole || m.stage !== undefined) {
    if (!isStage(m.stage)) return { error: LOOK_ERRORS.stage };
    look.stage = m.stage;
  }
  if (whole || m.planned !== undefined) {
    if (!isStoreys(m.planned)) return { error: LOOK_ERRORS.planned };
    look.planned = m.planned;
  }
  return { look };
}

/**
 * A new business's id, made from its name: lower-case letters, digits and dashes, at most 20 long
 * (BUSINESS_ID). A name with too little of that in it ("X", "東京") is padded with the plot ("x-p3",
 * "p3"). It's never the host's (friday-labs) nor one in `taken`: a clash gets -2, -3 and so on.
 */
export function businessId(name: string, plot: Claimable, taken: Iterable<string>): string {
  const used = new Set(taken);
  used.add(HOST_BUSINESS);
  let base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, ID_MAX)
    .replace(/-+$/, '');
  const p = plot.toLowerCase();
  if (base.length < ID_MIN) base = base ? `${base}-${p}` : p;
  for (let n = 1; ; n++) {
    const tail = n === 1 ? '' : `-${n}`;
    const id = `${base.slice(0, ID_MAX - tail.length).replace(/-+$/, '')}${tail}`;
    if (!used.has(id)) return id;
  }
}

/**
 * What everyone sees of a business from the street. A shell's storeys (and a site's, still to come)
 * are its planned count, each in its name and color; a linked business's are what its own office last
 * said. Never its quotas, its trust or where its office is.
 */
export function cardOf(d: BusinessDef): BusinessCard {
  const own = d.home === 'linked' && d.card?.storeys.length ? d.card.storeys.slice(0, BUSINESS_LIMITS.storeys) : null;
  const storeys: StoreyCard[] = own ? own.map((s) => ({ name: s.name, accent: s.accent })) : Array.from({ length: d.planned }, () => ({ name: d.name, accent: d.accent }));
  return { id: d.id, name: d.name, plot: d.plot, accent: d.accent, skin: d.skin, stage: d.stage, home: d.home, storeys };
}

const isHome = (v: unknown): v is BusinessHome => v === 'hosted' || v === 'linked';
const isCount = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A linked office's address: https, and nothing else. */
function httpsUrl(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 512) return undefined;
  try {
    return new URL(v).protocol === 'https:' ? v : undefined;
  } catch {
    return undefined;
  }
}

/** A linked business's public card, as its office said it: a storey at least, each named and colored. */
function cardFrom(v: unknown): { storeys: StoreyCard[] } | undefined {
  const storeys = (v as { storeys?: unknown } | null)?.storeys;
  if (!Array.isArray(storeys) || !storeys.length || storeys.length > BUSINESS_LIMITS.storeys) return undefined;
  const out: StoreyCard[] = [];
  for (const s of storeys as { name?: unknown; accent?: unknown }[]) {
    const name = cleanBusinessName(s?.name);
    const accent = cleanAccent(s?.accent);
    if (!name || !accent) return undefined;
    out.push({ name, accent });
  }
  return { storeys: out };
}

/**
 * One business from street.json, checked before it's believed, against the ones read before it
 * (`kept`): an id and a plot each only once. What it can't do without (its id, name, plot, color,
 * skin, stage, storeys, home) turns it away, with why. What it can (a linked office's address or card,
 * its trust, its budget) is left off when it won't do, and its quotas fall back to their defaults:
 * each of those is listed in `fixed`, so the registry can say so and keep the file it came from.
 */
export function defFrom(raw: unknown, kept: readonly BusinessDef[]): { def: BusinessDef; fixed: string[] } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: "it isn't an object" };
  const r = raw as Record<string, unknown>;
  const id = r.id;
  if (typeof id !== 'string' || !BUSINESS_ID.test(id) || id === HOST_BUSINESS) return { error: `its id ${JSON.stringify(id)} isn't one a business can have` };
  if (kept.some((d) => d.id === id)) return { error: `another business is ${id} already` };
  if (!isClaimable(r.plot)) return { error: `its plot ${JSON.stringify(r.plot)} isn't one that can be claimed` };
  const plot = r.plot;
  const other = kept.find((d) => d.plot === plot);
  if (other) return { error: `${plot} is ${other.id}'s already` };
  const look = lookFrom(r, true);
  if ('error' in look) return { error: look.error.replace(/^🏙 /, '') };
  if (!isHome(r.home)) return { error: `its home ${JSON.stringify(r.home)} is neither hosted nor linked` };
  const { name, accent, skin, stage, planned } = look.look as PlotLook;
  const fixed: string[] = [];
  const def: BusinessDef = {
    id,
    name,
    plot,
    accent,
    skin,
    stage,
    planned,
    home: r.home,
    maxFloors: BUSINESS_LIMITS.defaultFloors,
    maxWorkers: BUSINESS_LIMITS.defaultWorkers,
    by: typeof r.by === 'string' ? r.by.slice(0, 64) : '',
    at: finite(r.at) ? r.at : 0,
  };
  if (r.url !== undefined) {
    const url = httpsUrl(r.url);
    if (url) def.url = url;
    else fixed.push('url');
  }
  if (r.card !== undefined) {
    const card = cardFrom(r.card);
    if (card) def.card = card;
    else fixed.push('card');
  }
  if (r.trusted !== undefined) {
    const t = r.trusted as { by?: unknown; at?: unknown } | null;
    if (t && typeof t.by === 'string' && finite(t.at)) def.trusted = { by: t.by.slice(0, 64), at: t.at };
    else fixed.push('trusted');
  }
  if (isCount(r.maxFloors, 1, BUSINESS_LIMITS.floors)) def.maxFloors = r.maxFloors;
  else fixed.push('maxFloors');
  if (isCount(r.maxWorkers, 0, MOST_WORKERS)) def.maxWorkers = r.maxWorkers;
  else fixed.push('maxWorkers');
  if (r.budget !== undefined) {
    if (finite(r.budget) && r.budget >= 0) def.budget = r.budget;
    else fixed.push('budget');
  }
  if (typeof r.by !== 'string') fixed.push('by');
  if (!finite(r.at)) fixed.push('at');
  return { def, fixed };
}
