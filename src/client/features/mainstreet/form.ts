/**
 * A street admin's form for one plot in the Main Street window: the business's name, its color, what
 * it's clad in, a building site or a shell, and how many storeys; then Claim on a plot that's for
 * lease, or Save and Release on one that's claimed. Releasing asks for the business's name to be typed
 * first, since its site or shell comes down for everyone at once. The form only edits its draft and
 * says so; the window sends what it asks for and redraws when the street changes.
 */
import { BUSINESS_LIMITS, type BusinessCard, type BusinessSkin, type BusinessStage } from '../../../shared/protocol';
import { PLOTS, type Claimable } from '../../../shared/mainstreet';
import { h } from '../../ui/dom';
import { ACCENTS, SKINS, SKIN_ORDER, STAGES, STAGE_ORDER } from './look';

/** What the form says a plot should be. */
export interface Draft {
  name: string;
  accent: string;
  skin: BusinessSkin;
  stage: BusinessStage;
  planned: number;
}

/** The draft a business's card makes: what's there now. */
export const draftOf = (c: BusinessCard): Draft => ({ name: c.name, accent: c.accent, skin: c.skin, stage: c.stage, planned: Math.max(1, Math.min(BUSINESS_LIMITS.storeys, c.storeys.length)) });

/** A name as the office will keep it: nothing invisible in it, one space at a time, trimmed (see server/street/look.ts). */
export const cleanName = (name: string): string => name.replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim();

/** The fields of `d` that differ from `c`'s (all of them when there's no card), the name as the office will keep it. */
export function changes(d: Draft, c: BusinessCard | undefined): Partial<Draft> {
  const now = { ...d, name: cleanName(d.name) };
  if (!c) return now;
  const was = draftOf(c);
  const out: Partial<Draft> = {};
  for (const k of Object.keys(now) as (keyof Draft)[]) if (now[k] !== was[k]) (out as Record<string, unknown>)[k] = now[k];
  return out;
}

/** Names match the way the office compares them: case aside, but not accents. */
const sameName = (a: string, b: string) => cleanName(a).localeCompare(cleanName(b), undefined, { sensitivity: 'accent' }) === 0;

export interface FormDeps {
  plot: Claimable;
  /** The business there now, if any. */
  card: BusinessCard | undefined;
  /** What the form says, changed in place as it's filled in. */
  draft: Draft;
  /** The draft changed. */
  changed(): void;
  claim(): void;
  save(): void;
  release(): void;
}

/** A row of buttons to pick one from: each with its own content, the picked one on. */
function pickRow<T>(label: string, options: readonly { value: T; content: (Node | string)[]; title?: string }[], get: () => T, set: (v: T) => void, extra = ''): HTMLElement {
  const row = h('div.seg', { role: 'radiogroup', 'aria-label': label, class: extra });
  const paint = () =>
    row.replaceChildren(
      ...options.map((o) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            title: o.title,
            'aria-checked': String(get() === o.value),
            class: get() === o.value ? 'on' : '',
            onclick: () => {
              if (get() === o.value) return;
              set(o.value);
              paint();
            },
          },
          ...o.content,
        ),
      ),
    );
  paint();
  return row;
}

const field = (label: string | HTMLElement, ...kids: (Node | string)[]) => h('div.ms-field', {}, typeof label === 'string' ? h('span.ms-label', {}, label) : label, ...kids);

/** The form for `deps.plot`; `refresh(busy)` sets its buttons by the draft, and by whether a change is on its way. */
export function plotForm(deps: FormDeps): { el: HTMLElement; refresh(busy: boolean): void } {
  const { plot, card, draft } = deps;
  const plotName = PLOTS[plot].name;
  let busyNow = false;
  const changed = () => {
    deps.changed();
    refresh(busyNow);
  };

  const name = h('input', { type: 'text', maxlength: BUSINESS_LIMITS.name, placeholder: 'Acme Robotics', autocomplete: 'off', spellcheck: 'false', 'aria-label': "The business's name" }) as HTMLInputElement;
  name.value = draft.name;
  name.addEventListener('input', () => {
    draft.name = name.value;
    changed();
  });
  name.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!go.disabled) go.click();
  });

  const custom = h('input.ms-custom', { type: 'color', title: 'Any color', 'aria-label': 'Any color' }) as HTMLInputElement;
  custom.value = draft.accent;
  const swatches = h('div.ms-swatches', { role: 'radiogroup', 'aria-label': 'Color' });
  const setAccent = (c: string) => {
    draft.accent = c.toLowerCase();
    custom.value = draft.accent;
    paintSwatches();
    changed();
  };
  const paintSwatches = () =>
    swatches.replaceChildren(
      ...ACCENTS.map((c) =>
        h('button.ms-swatch', { type: 'button', role: 'radio', 'aria-checked': String(draft.accent === c), 'aria-label': c, title: c, class: draft.accent === c ? 'on' : '', style: `background:${c}`, onclick: () => setAccent(c) }),
      ),
      custom,
    );
  custom.addEventListener('input', () => setAccent(custom.value));
  paintSwatches();

  const skin = pickRow(
    'Clad in',
    SKIN_ORDER.map((v) => ({ value: v, content: [h('span.ms-chip', { style: `background:${SKINS[v].chip}` }), SKINS[v].label] })),
    () => draft.skin,
    (v) => {
      draft.skin = v;
      changed();
    },
  );
  const note = h('p.ms-note');
  const stage = pickRow(
    'Stands as',
    STAGE_ORDER.map((v) => ({ value: v, content: [`${STAGES[v].icon} ${STAGES[v].label}`] })),
    () => draft.stage,
    (v) => {
      draft.stage = v;
      changed();
    },
  );
  const storeysLabel = h('span.ms-label');
  const storeys = pickRow(
    'Storeys',
    Array.from({ length: BUSINESS_LIMITS.storeys }, (_, i) => ({ value: i + 1, content: [String(i + 1)], title: `${i + 1} ${i ? 'storeys' : 'storey'}` })),
    () => draft.planned,
    (v) => {
      draft.planned = v;
      changed();
    },
    'ms-storeys',
  );

  const go = h('button.btn.primary', { type: 'button', onclick: () => (card ? deps.save() : deps.claim()) }) as HTMLButtonElement;
  const actions = h('div.ms-actions', {}, go);

  // Releasing a claimed plot: the business's name typed out first.
  const confirm = h('div.ms-confirm.hidden');
  const typed = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: card?.name ?? '', 'aria-label': `Type the business's name to release ${plotName}` }) as HTMLInputElement;
  const really = h('button.btn.danger', { type: 'button', onclick: () => deps.release() }) as HTMLButtonElement;
  const toggle = (open: boolean) => {
    confirm.classList.toggle('hidden', !open);
    actions.classList.toggle('hidden', open);
    typed.value = '';
    refresh(busyNow);
    if (open) typed.focus();
  };
  typed.addEventListener('input', () => refresh(busyNow));
  typed.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!really.disabled) really.click();
  });
  if (card) {
    confirm.append(
      h('p', {}, 'Type ', h('b', {}, card.name), ` to give ${plotName} back. Its ${card.stage === 'site' ? 'building site' : 'shell'} comes down for everyone, and the plot is for lease again.`),
      typed,
      h('div.ms-actions', {}, h('button.btn', { type: 'button', onclick: () => toggle(false) }, 'Keep it'), really),
    );
    actions.prepend(h('button.btn.ms-release', { type: 'button', onclick: () => toggle(true) }, 'Release…'));
  }

  function refresh(busy: boolean) {
    busyNow = busy;
    const nameOk = cleanName(draft.name).length > 0;
    go.disabled = busy || !nameOk || (!!card && !Object.keys(changes(draft, card)).length);
    go.textContent = busy ? (card ? 'Saving…' : 'Claiming…') : card ? 'Save' : `Claim ${plotName}`;
    really.disabled = busy || !card || !sameName(typed.value, card.name);
    really.textContent = busy ? 'Releasing…' : `Release ${plotName}`;
    note.textContent = STAGES[draft.stage].note;
    storeysLabel.textContent = draft.stage === 'site' ? 'Storeys planned' : 'Storeys';
  }
  refresh(false);

  const el = h('div.ms-form', {}, field('Name', name), field('Color', swatches), field('Clad in', skin), field('Stands as', stage, note), field(storeysLabel, storeys), actions, confirm);
  return { el, refresh };
}
