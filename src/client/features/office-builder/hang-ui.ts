/**
 * A painting, in the builder's inspector (see ui.ts): which of the floor's own pictures it shows, picked
 * from thumbnails of the image files in the floor's media folder; its frame; how big it is; and how
 * high it hangs. Picking a picture gives the painting that picture's own shape, so a scene hangs wide
 * and a portrait tall. It's all kept on the piece (media, aspect, frame, size, lift: see Piece).
 */
import { FRAMES, PICTURE_MAX, PICTURE_MIN } from '../../../shared/decor';
import type { Piece } from '../../../shared/furniture';
import { PAINTING } from '../../../shared/hangings';
import { store } from '../../state';
import { h } from '../../ui/dom';
import { mediaFolder, mediaListUrl, mediaUrl, type MediaFile } from '../screens/playlist';

/** How high a picture's middle may hang (see LIFT in shared/furniture.ts). */
const LIFT = { min: 0.3, max: 3.6 } as const;
/** How long a look in a floor's folder is good for, in milliseconds: the inspector's drawn again with every change. */
const FRESH = 5000;

/** The pictures in each floor's media folder, as last listed, and who hears of a newer list: the inspector as it was last drawn. */
const looked = new Map<string, { at: number; files?: MediaFile[]; asking?: Promise<void>; then?: (files: MediaFile[]) => void }>();

/** The image files in `floor`'s media folder: as last listed, at once (nothing, before the first look), and `then` with a newer list when there is one. */
function pictures(floor: string, then: (files: MediaFile[]) => void): MediaFile[] | undefined {
  let entry = looked.get(floor);
  if (!entry) looked.set(floor, (entry = { at: -Infinity }));
  const e = entry;
  e.then = then;
  if (!e.asking && performance.now() - e.at > FRESH) {
    e.asking = fetch(mediaListUrl(floor))
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { media?: MediaFile[] };
        const files = (Array.isArray(body.media) ? body.media : []).filter((f) => f.kind === 'image');
        const changed = JSON.stringify(files) !== JSON.stringify(e.files);
        e.files = files;
        e.at = performance.now();
        if (changed) e.then?.(files);
      })
      .catch(() => {
        // The office is restarting, or the floor's gone: an empty folder, until the next look.
        if (!e.files) e.then?.((e.files = []));
      })
      .finally(() => (e.asking = undefined));
  }
  return e.files;
}

/** The inspector's rows for the painting `piece`; `edit` is told what changes of it. Nothing can be changed while it's `fixed`. */
export function hangUi(piece: Piece, edit: (patch: Partial<Piece>) => void, fixed: boolean): HTMLElement[] {
  const floor = store.floor ?? '';
  const grid = h('div.ob-pics', { role: 'listbox', 'aria-label': 'Picture' });
  const empty = h('p.ob-note');

  /** A picture to pick: it takes its own shape with it, once the browser has seen it. */
  function tile(file: MediaFile): HTMLElement {
    const img = h('img', { src: mediaUrl(floor, file.name, file.size), alt: '', loading: 'lazy', draggable: 'false' }) as HTMLImageElement;
    const on = piece.media === file.name;
    const button = h('button.ob-pic', { type: 'button', class: on ? 'on' : '', role: 'option', 'aria-selected': String(on), title: file.name, disabled: fixed }, img) as HTMLButtonElement;
    // One change: the picture and its shape together (a picture with no size of its own keeps the frame's).
    const pick = () => edit({ media: file.name, ...(img.naturalWidth > 0 && img.naturalHeight > 0 ? { aspect: img.naturalWidth / img.naturalHeight } : {}) });
    button.addEventListener('click', () => {
      if (img.complete) pick();
      else img.addEventListener('load', pick, { once: true });
    });
    // A file the browser can't show can't be hung.
    img.addEventListener('error', () => {
      button.disabled = true;
      button.classList.add('broken');
      button.title = `${file.name} can’t be shown here`;
    });
    return button;
  }

  function draw(files: MediaFile[] | undefined) {
    const none = h('button.ob-pic.blank', { type: 'button', class: piece.media ? '' : 'on', role: 'option', 'aria-selected': String(!piece.media), title: 'No picture: an empty frame', disabled: fixed, onclick: () => edit({ media: undefined }) }, 'None');
    grid.replaceChildren(none, ...(files ?? []).map(tile));
    empty.hidden = !!files?.length;
    empty.textContent = files ? `No pictures yet. Put image files (PNG, JPG, WebP, GIF) in ${mediaFolder(store.currentFloor()?.dir ?? '…')} and they show here.` : 'Looking in the floor’s media folder…';
  }
  draw(pictures(floor, (files) => grid.isConnected && draw(files)));

  const frame = piece.frame ?? PAINTING.frame;
  const frames = h(
    'div.ob-swatches',
    {},
    ...FRAMES.map((f, i) => h('button.ob-swatch', { type: 'button', class: `${i === frame ? 'on' : ''}${f.color ? '' : ' none'}`, style: f.color ? `background:${f.color}` : undefined, title: f.color ? `${f.name} frame` : 'No frame', 'aria-label': f.color ? `${f.name} frame` : 'No frame', disabled: fixed, onclick: () => edit({ frame: i }) })),
  );

  /** A slider that says its value in meters beside its name, and changes the piece when it's let go. */
  function slider(label: string, value: number, min: number, max: number, set: (n: number) => void): HTMLElement {
    const says = h('output', {}, `${value.toFixed(2)} m`);
    const input = h('input', { type: 'range', min, max, step: 0.05, disabled: fixed }) as HTMLInputElement;
    input.value = String(value);
    input.addEventListener('input', () => (says.textContent = `${input.valueAsNumber.toFixed(2)} m`));
    input.addEventListener('change', () => set(Math.round(input.valueAsNumber * 100) / 100));
    return h('label.ob-field', {}, h('span.ob-measure', {}, label, says), input);
  }

  return [
    h('p.ob-note', {}, 'It hangs on a wall: drag it along one, or across to another. On a wall you put up, R hangs it on the other side.'),
    h('div.ob-field', {}, h('span', {}, 'Picture'), grid, empty),
    h('div.ob-field', {}, h('span', {}, 'Frame'), frames),
    slider('Size (long side)', piece.size ?? PAINTING.size, PICTURE_MIN, PICTURE_MAX, (size) => edit({ size })),
    slider('Height (to its middle)', piece.lift ?? PAINTING.lift, LIFT.min, LIFT.max, (lift) => edit({ lift })),
  ];
}
