/**
 * The plan of Main Street in its window: the street from above, north up, in the street frame (one
 * unit a meter, x across and z down the page, as on Friday's bottom floor). Friday Tower, Friday Park
 * and Putt Street as they are, and each plot a business can have as it stands: for lease, a building
 * site or a shell, or, while a street admin is filling the form in, what it would be. Friday One, you,
 * and whoever else is out on the street on your floor are on it too. Every plot is a button.
 */
import { HELI } from '../../../shared/heli';
import { GOLF_HOLE, ROAD } from '../../../shared/layout';
import { CRANE, PARK, PLOTS, PLOT_IDS, PUTT, PUTT_CELLS, claimedBox, craneAt, isClaimable, plateBox, type Claimable, type PlotId } from '../../../shared/mainstreet';
import type { BusinessStage } from '../../../shared/protocol';
import { inkOn, storeysText } from './look';

/** What a claimable plot shows on the plan: the business there (or the one a form would make). */
export interface PlanLot {
  name: string;
  accent: string;
  stage: BusinessStage;
  planned: number;
}

export interface PlanState {
  /** What stands on each claimable plot; a plot that's missing is for lease. */
  lots: Partial<Record<Claimable, PlanLot>>;
  /** The plot picked out, and whether what's drawn on it is a form not yet saved. */
  selected: PlotId;
  draft: boolean;
  /** Friday One, from above: where it is and which way its nose points. */
  heli: { x: number; z: number; yaw: number } | null;
  /** You, when you're down on a floor. */
  you: { x: number; z: number } | null;
  /** Everyone else out on the street on your floor, in their colors. */
  people: readonly { x: number; z: number; color: string }[];
}

/** The ground the plan covers, edge to edge (meters, in the street frame). */
const VIEW = { minX: -80, maxX: 80, minZ: -25, maxZ: 79 } as const;

const NS = 'http://www.w3.org/2000/svg';
type Attrs = Record<string, string | number>;

/** An SVG element with its attributes and children. */
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (SVGElement | string | null)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const kid of kids) if (kid !== null) el.append(kid);
  return el;
}

const rect = (b: { minX: number; maxX: number; minZ: number; maxZ: number }, attrs: Attrs = {}) => s('rect', { x: b.minX, y: b.minZ, width: b.maxX - b.minX, height: b.maxZ - b.minZ, ...attrs });
const text = (x: number, z: number, words: string, attrs: Attrs = {}) => s('text', { x, y: z, ...attrs }, words);

/** The plan as an SVG, sized by its box: `draw` fills it in (again), and a click or Enter on a plot `pick`s it. */
export function streetPlan(pick: (plot: PlotId) => void): { el: SVGSVGElement; draw(st: PlanState): void } {
  const el = s('svg', { viewBox: `${VIEW.minX} ${VIEW.minZ} ${VIEW.maxX - VIEW.minX} ${VIEW.maxZ - VIEW.minZ}`, class: 'ms-plan', role: 'group', 'aria-label': 'Main Street from above' });
  el.addEventListener('click', (e) => {
    const plot = (e.target as Element).closest('[data-plot]')?.getAttribute('data-plot');
    if (plot) pick(plot as PlotId);
  });
  el.addEventListener('keydown', (e) => {
    const plot = (e.target as Element).closest('[data-plot]')?.getAttribute('data-plot');
    if (!plot || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    pick(plot as PlotId);
  });
  return {
    el,
    draw(st) {
      // Drawn anew each time: a plot that had the keyboard's focus keeps it.
      const focused = el.contains(document.activeElement) ? document.activeElement?.getAttribute('data-plot') : null;
      el.replaceChildren(...plan(st));
      if (focused) (el.querySelector(`[data-plot="${focused}"]`) as SVGElement | null)?.focus({ preventScroll: true });
    },
  };
}

function plan(st: PlanState): SVGElement[] {
  const out: SVGElement[] = [rect(VIEW, { class: 'ms-grass' })];
  // Main Street itself, its sidewalks either side, and the line down its middle.
  const road = { minX: VIEW.minX, maxX: VIEW.maxX, minZ: ROAD.minZ, maxZ: ROAD.maxZ };
  out.push(rect({ ...road, minZ: road.minZ - 2, maxZ: road.maxZ + 2 }, { class: 'ms-sidewalk' }), rect(road, { class: 'ms-road' }));
  const mid = (ROAD.minZ + ROAD.maxZ) / 2;
  out.push(s('line', { x1: VIEW.minX, y1: mid, x2: VIEW.maxX, y2: mid, class: 'ms-centre' }));
  out.push(rect({ minX: -12, maxX: 12, minZ: mid - 1.7, maxZ: mid + 1.7 }, { class: 'ms-road' }), text(0, mid + 0.85, 'MAIN STREET', { class: 'ms-road-name', 'text-anchor': 'middle' }));
  for (const id of PLOT_IDS) out.push(lotOf(id, st));
  for (const p of st.people) if (inView(p.x, p.z)) out.push(s('circle', { cx: p.x, cy: p.z, r: 1.1, class: 'ms-person', style: `fill:${p.color}` }));
  if (st.heli) out.push(heliMark(st.heli));
  if (st.you && inView(st.you.x, st.you.z)) out.push(s('g', { class: 'ms-you', transform: `translate(${st.you.x} ${st.you.z})` }, s('circle', { r: 1.7 }), text(0, -2.6, 'You', { 'text-anchor': 'middle' })));
  return out;
}

const inView = (x: number, z: number) => x > VIEW.minX && x < VIEW.maxX && z > VIEW.minZ && z < VIEW.maxZ;

/** One plot as it stands, a button picking it. */
function lotOf(id: PlotId, st: PlanState): SVGElement {
  const p = PLOTS[id];
  const lot = isClaimable(id) ? st.lots[id] : undefined;
  const picked = st.selected === id;
  const g = s('g', {
    class: `ms-lot ms-${p.use}${picked ? ' picked' : ''}${picked && st.draft ? ' draft' : ''}`,
    'data-plot': id,
    role: 'button',
    tabindex: 0,
    'aria-pressed': String(picked),
    'aria-label': `${p.name}: ${isClaimable(id) ? (lot ? `${lot.name}, ${lot.stage === 'site' ? 'a building site' : 'a shell'}` : 'for lease') : 'Friday Labs'}`,
  });
  g.append(rect(p.box, { class: 'ms-ground', rx: 1.6 }));
  if (id === 'P1') g.append(...tower());
  else if (id === 'P5') g.append(...park());
  else if (id === 'P6') g.append(...course());
  else if (isClaimable(id)) g.append(...(lot ? (lot.stage === 'site' ? site(id, lot) : shell(id, lot)) : forLease(id)));
  // Named in the corner away from Main Street, where the boards by the sidewalk aren't.
  g.append(text(p.box.minX + 1.6, p.box.minZ > ROAD.maxZ ? p.box.maxZ - 1.6 : p.box.minZ + 4, p.name.toUpperCase(), { class: 'ms-lot-name' }));
  // Picked out last, over everything on it.
  if (picked) g.append(rect(p.box, { class: 'ms-ring', rx: 1.6 }));
  return g;
}

/** Friday Tower's plate, in ink. */
function tower(): SVGElement[] {
  const b = plateBox('P1');
  return [rect(b, { class: 'ms-tower', rx: 0.8 }), text(0, 0.4, 'FRIDAY TOWER', { class: 'ms-tower-name', 'text-anchor': 'middle' }), text(0, 4.6, 'Friday Labs', { class: 'ms-tower-sub', 'text-anchor': 'middle' })];
}

/** Friday Park: golf's first green and its flag, the path in, the benches, the map board and Friday One's pad. */
function park(): SVGElement[] {
  const { pad, path, benches, board } = PARK;
  return [
    s('line', { x1: path.x, y1: PLOTS.P5.box.minZ, x2: path.x, y2: pad.z - pad.r, class: 'ms-path', 'stroke-width': path.width }),
    s('circle', { cx: GOLF_HOLE.x, cy: GOLF_HOLE.z, r: GOLF_HOLE.green + 0.7, class: 'ms-green' }),
    s('circle', { cx: GOLF_HOLE.x, cy: GOLF_HOLE.z, r: 0.7, class: 'ms-flag' }),
    ...benches.map((b) => rect({ minX: b.x - 1, maxX: b.x + 1, minZ: b.z - 0.4, maxZ: b.z + 0.4 }, { class: 'ms-bench' })),
    rect({ minX: board.x - board.width / 2, maxX: board.x + board.width / 2, minZ: board.z - 0.5, maxZ: board.z + 0.5 }, { class: 'ms-board' }),
    s('circle', { cx: pad.x, cy: pad.z, r: pad.r, class: 'ms-pad' }),
    text(pad.x, pad.z + 1.9, 'H', { class: 'ms-pad-h', 'text-anchor': 'middle' }),
  ];
}

/** Putt Street: its fence, the nine holes' cells, numbered, and the kiosk. */
function course(): SVGElement[] {
  const half = PUTT.cell / 2 - 0.7;
  return [
    rect(PUTT.fence, { class: 'ms-fence', rx: 0.8 }),
    ...PUTT_CELLS.flatMap((c) => [rect({ minX: c.x - half, maxX: c.x + half, minZ: c.z - half, maxZ: c.z + half }, { class: 'ms-felt', rx: 1.2 }), text(c.x, c.z + 1.4, String(c.n), { class: 'ms-hole', 'text-anchor': 'middle' })]),
    rect(PUTT.kiosk, { class: 'ms-kiosk', rx: 0.5 }),
  ];
}

/** A plot that's for lease: its plate staked out, flags at the corners, and its board by the sidewalk. */
function forLease(plot: Claimable): SVGElement[] {
  const b = plateBox(plot);
  const p = PLOTS[plot];
  const stakes = [b.minX, b.maxX].flatMap((x) => [b.minZ, b.maxZ].map((z) => s('circle', { cx: x, cy: z, r: 0.8, class: 'ms-stake' })));
  return [rect(b, { class: 'ms-staked', rx: 0.6 }), ...stakes, text(p.plate!.x, p.plate!.z + 1.3, 'FOR LEASE', { class: 'ms-lease', 'text-anchor': 'middle' }), boardOf(plot)];
}

/** A plot's FOR LEASE board, where it stands by the sidewalk (a claimed plot's sign is at its gate or door). */
function boardOf(plot: Claimable): SVGElement {
  const at = PLOTS[plot].board!;
  return rect({ minX: at.x - 1.5, maxX: at.x + 1.5, minZ: at.z - 0.45, maxZ: at.z + 0.45 }, { class: 'ms-board' });
}

/** A building site: the hoarding round the plate in its color, its name, and the crane with its jib. */
function site(plot: Claimable, lot: PlanLot): SVGElement[] {
  const b = claimedBox(plot);
  const p = PLOTS[plot].plate!;
  const mast = craneAt(plot);
  // The jib slews round all day on the street; here it's caught along the back of the plot, clear of the name.
  const dir = mast.x > p.x ? -1 : 1;
  return [
    rect(b, { class: 'ms-dirt', rx: 0.4 }),
    s('line', { x1: mast.x - dir * CRANE.counter, y1: mast.z, x2: mast.x + dir * CRANE.jib, y2: mast.z, class: 'ms-jib' }),
    rect({ minX: mast.x - 1.2, maxX: mast.x + 1.2, minZ: mast.z - 1.2, maxZ: mast.z + 1.2 }, { class: 'ms-mast' }),
    rect(b, { class: 'ms-hoarding', rx: 0.4, stroke: lot.accent }),
    text(p.x, p.z - 1, clipTo(lot.name, 18), { class: 'ms-biz', 'text-anchor': 'middle' }),
    text(p.x, p.z + 3.6, `Coming soon · ${storeysText(lot.planned)}`, { class: 'ms-biz-sub', 'text-anchor': 'middle' }),
  ];
}

/** A shell: the plate in the business's color, a door on its street side, its name and storeys. */
function shell(plot: Claimable, lot: PlanLot): SVGElement[] {
  const b = plateBox(plot);
  const p = PLOTS[plot].plate!;
  // Its street face: south for the plots north of Main Street, north for P7, turned to face it.
  const doorZ = p.turn ? b.minZ : b.maxZ - 1.2;
  const ink = inkOn(lot.accent);
  return [
    rect(b, { class: 'ms-shell', rx: 0.6, fill: lot.accent }),
    rect({ minX: p.x - 3, maxX: p.x + 3, minZ: doorZ, maxZ: doorZ + 1.2 }, { class: 'ms-door' }),
    text(p.x, p.z - 1, clipTo(lot.name, 18), { class: 'ms-biz', 'text-anchor': 'middle', style: `fill:${ink}` }),
    text(p.x, p.z + 3.6, storeysText(lot.planned), { class: 'ms-biz-sub', 'text-anchor': 'middle', style: `fill:${ink}` }),
  ];
}

/** Friday One from above: its rotor's disc, the cabin, and the tail out behind. */
function heliMark(h: { x: number; z: number; yaw: number }): SVGElement {
  // Drawn nose down the page (+z), then turned: SVG turns clockwise down the page, a heading the other way.
  return s(
    'g',
    { class: 'ms-heli', transform: `translate(${h.x} ${h.z}) rotate(${(-h.yaw * 180) / Math.PI})` },
    s('line', { x1: 0, y1: 0, x2: 0, y2: -HELI.tail, class: 'ms-heli-tail' }),
    s('circle', { r: HELI.rotor, class: 'ms-heli-disc' }),
    s('ellipse', { rx: 1.1, ry: 1.9, cy: 0.4, class: 'ms-heli-body' }),
  );
}

/** `name` cut to `max` characters (as people see them), with an ellipsis. */
const clipTo = (name: string, max: number) => ([...name].length > max ? `${[...name].slice(0, max - 1).join('')}…` : name);
