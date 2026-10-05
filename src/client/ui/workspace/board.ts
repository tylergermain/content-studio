import './board.css';
import { h } from '../dom';
import { artifactKey, type ChatArtifact, type ChatSnapshot } from '../../../shared/worker-chat';
import { versionLabel } from '../../../shared/workspace';
import { badges, fileSize, fileTime, fileTitle, latestLinked, originOf, sections } from './files';
import type { Panel, WorkspaceHost } from './types';

// The Designer's board (kind 'board', and the Board tab of every other kind): the images a worker links, as a grid
// of thumbnails under a stage. One chosen shows large, with its real size and shape. Two to four show side by side,
// lettered A to D so a request can say "B's face". "At YouTube size" shows each the size a viewer meets it, on
// YouTube's light and dark pages. "Pick this one" approves one image and "Ask for variations" sends one to four back
// with what to change: each is one review (host.review) that the server writes into the prompt. Nothing here moves,
// renames or publishes a file.

const MOST = 4;
const LETTERS = ['A', 'B', 'C', 'D'];
const ref = (f: ChatArtifact) => (f.root ? { root: f.root, path: f.path } : { path: f.path });
/** What was typed, as the server takes it: a pasted control character (a soft return from a doc) becomes a space. */
const plain = (s: string) => s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim();
/** A pill as the other tabs show it (workspace.css): Latest in the accent, Picked in green. */
const pill = (label: string) => h(`span.ws-pill${label === 'Latest' ? '.latest' : /^(Approved|Picked)$/.test(label) ? '.good' : ''}`, {}, label);

const SHAPES: [string, number][] = [['16:9', 16 / 9], ['9:16', 9 / 16], ['4:5', 4 / 5], ['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['3:2', 3 / 2], ['2:3', 2 / 3], ['1.91:1', 1.91], ['21:9', 21 / 9]];
/** An image's shape as designers name it: '16:9' for a thumbnail, '4:5' for a feed post, else the ratio to one. */
function shape(w: number, hgt: number): string {
  const r = w / hgt;
  return SHAPES.find(([, k]) => Math.abs(r - k) / k < 0.01)?.[0] ?? `${r.toFixed(2)}:1`;
}

export function designBoard(host: WorkspaceHost): Panel {
  let data: ChatSnapshot | undefined;
  /** This tab's images, the worker's first and then the floor's: the order of the grid and of the arrow keys. */
  let files: ChatArtifact[] = [];
  let byKey = new Map<string, ChatArtifact>();
  let latest: ChatArtifact | undefined;
  /** The chosen images' keys, in the order they were chosen (A, B, C, D). */
  let chosen: string[] = [];
  /** The viewer chose something, so a newer image no longer takes the stage by itself. */
  let touched = false;
  let youtube = false;
  /** After asking for variations: the images there were then, so the new ones can be put side by side when they come. */
  let waiting: Set<string> | undefined;
  let busy = false;
  let stopped = false;
  let gridStamp = '';
  let stageStamp = '';

  const full = h('button.btn.small.on', { type: 'button', 'aria-pressed': 'true' }, 'Full view');
  const yt = h('button.btn.small', { type: 'button', 'aria-pressed': 'false', title: 'Each image at the size a viewer sees it (Y)' }, 'At YouTube size');
  const count = h('span.board-count');
  const pick = h('button.btn.small', { type: 'button' }, 'Pick this one');
  const vary = h('button.btn.small', { type: 'button' }, 'Ask for variations');
  const actions = h('div.board-actions', {}, pick, vary);
  const readOnly = h('p.board-readonly.hidden', {}, `You can look, but only an admin or ${host.workerName}’s owner can send it picks and requests.`);
  const stage = h('div.board-stage');
  const sheet = h('div.board-sheet.hidden');
  const status = h('p.board-status', { 'aria-live': 'polite' });
  const grid = h('div.board-grid', { role: 'group', 'aria-label': 'Images' });
  const element = h('div.ws-board', {},
    h('div.board-bar', {}, h('div.board-view', { role: 'group', 'aria-label': 'How the chosen images show' }, full, yt), count, actions),
    readOnly, stage, sheet, status, grid);

  const chosenFiles = () => chosen.map((k) => byKey.get(k)).filter((f): f is ChatArtifact => !!f);
  const pillsOf = (f: ChatArtifact) => (data ? badges(f, data) : []);

  function setStatus(text: string, error = false) {
    status.textContent = text;
    status.classList.toggle('error', error);
  }

  function setYoutube(on: boolean) {
    youtube = on;
    full.classList.toggle('on', !on);
    yt.classList.toggle('on', on);
    full.setAttribute('aria-pressed', String(!on));
    yt.setAttribute('aria-pressed', String(on));
    paintStage();
  }
  full.addEventListener('click', () => setYoutube(false));
  yt.addEventListener('click', () => setYoutube(true));

  /** A plain click shows one image; adding (⌘, Ctrl or Shift, or the tick) puts it beside the others, up to four. */
  function choose(key: string, add: boolean) {
    touched = true;
    if (!add) chosen = [key];
    else if (chosen.includes(key)) chosen = chosen.filter((k) => k !== key);
    else chosen = [...chosen, key].slice(-MOST);
    closeSheet();
    paintStage();
    markChosen();
  }

  function step(by: number) {
    if (!files.length) return;
    const at = files.findIndex((f) => artifactKey(f) === chosen[chosen.length - 1]);
    const next = files[at < 0 ? 0 : (at + by + files.length) % files.length];
    choose(artifactKey(next), false);
    tileOf(artifactKey(next))?.scrollIntoView({ block: 'nearest' });
  }

  const tileOf = (key: string) => [...grid.querySelectorAll<HTMLElement>('.board-tile')].find((t) => t.dataset.key === key);

  // ---- The grid ----

  function tile(f: ChatArtifact): HTMLElement {
    const key = artifactKey(f);
    const thumb = h('button.board-thumb', { type: 'button', title: `${fileTitle(f)}\nClick to show it, ⌘-click to compare` },
      h('img', { src: host.url(f), alt: '', loading: 'lazy', decoding: 'async' }));
    const check = h('button.board-check', { type: 'button', 'aria-label': `Compare ${f.name}`, title: 'Compare (⌘-click)' });
    thumb.addEventListener('click', (e) => choose(key, e.metaKey || e.ctrlKey || e.shiftKey));
    check.addEventListener('click', () => choose(key, true));
    const version = versionLabel(f.path);
    return h('div.board-tile', { 'data-key': key }, thumb, check,
      h('div.board-label', {}, h('span.board-name', { title: f.name }, f.name),
        h('span.board-meta', {}, version ? h('span.ws-version', {}, version) : null, fileTime(f.modified))),
      h('div.board-pills', { 'data-pills': key, 'data-latest': f === latest }));
  }

  /**
   * The pills on the tiles and the stage, kept apart from the pictures: /file is never cached, so redrawing a picture
   * to change its pill would fetch it again.
   */
  function paintPills() {
    for (const el of element.querySelectorAll<HTMLElement>('[data-pills]')) {
      const f = byKey.get(el.dataset.pills ?? '');
      el.replaceChildren(...(f ? [...(el.dataset.latest !== undefined ? ['Latest'] : []), ...pillsOf(f)] : []).map(pill));
    }
  }

  function paintGrid() {
    if (!data) return;
    const parts = sections(files, data, host.workerName);
    const stamp = JSON.stringify([parts.map((s) => [s.title, s.files.map((f) => [artifactKey(f), f.modified])]), latest && artifactKey(latest)]);
    if (stamp !== gridStamp) {
      gridStamp = stamp;
      grid.replaceChildren();
      grid.classList.toggle('hidden', !files.length);
      for (const s of parts) grid.append(h('h4.board-section', {}, s.title), h('div.board-tiles', {}, ...s.files.map(tile)));
    }
    markChosen();
  }

  /** Ticks and letters on the chosen tiles. */
  function markChosen() {
    for (const t of grid.querySelectorAll<HTMLElement>('.board-tile')) {
      const at = chosen.indexOf(t.dataset.key ?? '');
      t.classList.toggle('chosen', at >= 0);
      t.querySelector('.board-thumb')?.setAttribute('aria-pressed', String(at >= 0));
      const check = t.querySelector<HTMLElement>('.board-check');
      if (check) {
        check.setAttribute('aria-pressed', String(at >= 0));
        check.textContent = at < 0 ? '' : chosen.length > 1 ? LETTERS[at] : '✓';
      }
    }
  }

  // ---- The stage ----

  function paintStage() {
    const list = chosenFiles();
    const stamp = JSON.stringify([youtube, list.map((f) => [artifactKey(f), f.modified])]);
    paintActions(list);
    if (stamp === stageStamp) return paintPills();
    stageStamp = stamp;
    count.textContent = list.length > 1 ? `Comparing ${list.length}` : '';
    stage.dataset.view = youtube ? 'youtube' : list.length > 1 ? 'compare' : 'one';
    if (!list.length) {
      stage.replaceChildren(h('p.board-empty', {}, files.length ? 'Choose an image below. ⌘-click (Ctrl-click) or tick up to four to compare them.'
        : `No images yet. When ${host.workerName} links a thumbnail or a graphic in the chat, it shows up here to compare, check at YouTube size and pick.`));
      return;
    }
    stage.replaceChildren(youtube ? youTubeView(list) : list.length === 1 ? oneView(list[0]) : compareView(list));
    paintPills();
  }

  /** One image as large as the stage allows; a click shows it at its actual pixels, to check small type. */
  function oneView(f: ChatArtifact): HTMLElement {
    const img = h('img', { src: host.url(f), alt: f.name, decoding: 'async' });
    const size = h('span', {}, fileSize(f.size));
    img.addEventListener('load', () => { size.textContent = `${img.naturalWidth} × ${img.naturalHeight} · ${shape(img.naturalWidth, img.naturalHeight)} · ${fileSize(f.size)}`; });
    // A div, not a button: at actual size the frame scrolls, and a button won't scroll in every browser.
    const frame = h('div.board-frame', { role: 'button', tabindex: '0', 'aria-pressed': 'false', 'aria-label': 'Actual size', title: 'Click for actual size' }, img);
    const zoom = () => {
      const actual = frame.classList.toggle('actual');
      frame.setAttribute('aria-pressed', String(actual));
      frame.title = actual ? 'Click to fit' : 'Click for actual size';
    };
    frame.addEventListener('click', zoom);
    frame.addEventListener('keydown', (e) => {
      if (e.target === frame && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); zoom(); }
    });
    const version = versionLabel(f.path);
    return h('figure.board-one', {}, frame,
      h('figcaption', {},
        h('div.board-caption-top', {}, h('strong', {}, f.name), version ? h('span.ws-version', {}, version) : null, h('span.board-pills', { 'data-pills': artifactKey(f) })),
        h('span.board-meta', {}, size, ' · ', fileTime(f.modified)),
        h('span.board-folder', { title: fileTitle(f) }, fileTitle(f))));
  }

  /** Two to four side by side, lettered in the order they were chosen. */
  function compareView(list: ChatArtifact[]): HTMLElement {
    return h('div.board-compare', { 'data-n': list.length }, ...list.map((f, i) => {
      const drop = h('button.board-drop', { type: 'button', 'aria-label': `Take ${f.name} out of the comparison`, title: 'Take it out' }, '✕');
      drop.addEventListener('click', () => choose(artifactKey(f), true));
      return h('figure.board-option', {},
        h('div.board-frame', {}, h('img', { src: host.url(f), alt: f.name, decoding: 'async' })),
        h('figcaption', {}, h('span.board-letter', {}, LETTERS[i]), h('span.board-name', { title: fileTitle(f) }, f.name),
          h('span.board-pills', { 'data-pills': artifactKey(f) }), drop));
    }));
  }

  // YouTube shows a thumbnail at 360 × 202 on its home page and 168 × 94 beside the video playing, with the
  // video's length over the bottom right corner, on a white page or a near-black one.
  function youTubeView(list: ChatArtifact[]): HTMLElement {
    // yt-thumb-home and yt-thumb-side, never a bare .side: the HUD's .side panel (styles/hud.css) is positioned absolutely.
    const thumb = (f: ChatArtifact, size: 'home' | 'side') => h(`div.yt-thumb.yt-thumb-${size}`, {}, h('img', { src: host.url(f), alt: '', decoding: 'async' }), h('span.yt-time', {}, '12:34'));
    const lines = () => h('div.yt-lines', {}, h('span.yt-line'), h('span.yt-line.short'), h('span.yt-line.meta'));
    const page = (theme: 'light' | 'dark', f: ChatArtifact) => h(`div.yt-page.${theme}`, { 'aria-label': `${f.name} on YouTube’s ${theme} page` },
      h('div.yt-home', {}, thumb(f, 'home'), h('div.yt-info', {}, h('span.yt-avatar'), lines())),
      h('div.yt-side', {}, thumb(f, 'side'), lines()));
    return h('div.board-yt', {},
      h('p.board-yt-note', {}, 'The size viewers meet it: 360 × 202 on the home page and 168 × 94 beside a video, on YouTube’s light and dark pages. The video’s length covers the bottom right corner.'),
      ...list.map((f, i) => h('section.yt-row', {},
        h('h5', {}, list.length > 1 ? h('span.board-letter', {}, LETTERS[i]) : null, f.name),
        h('div.yt-pages', {}, page('light', f), page('dark', f)))));
  }

  // ---- Picks and variations ----

  function paintActions(list = chosenFiles()) {
    const can = host.canSend();
    actions.classList.toggle('hidden', !can);
    readOnly.classList.toggle('hidden', can);
    if (!can) closeSheet();
    pick.disabled = busy || list.length !== 1;
    pick.title = list.length === 1 ? `Tell ${host.workerName} this is the one` : 'Choose exactly one image to pick it';
    vary.disabled = busy || !list.length;
    vary.title = list.length ? `Ask ${host.workerName} for new versions of ${list.length === 1 ? 'this image' : `these ${list.length}`}` : 'Choose up to four images first';
  }

  function closeSheet() {
    sheet.classList.add('hidden');
    sheet.replaceChildren();
  }

  function openSheet(...children: (Node | string)[]) {
    sheet.replaceChildren(...children);
    sheet.classList.remove('hidden');
    setStatus('');
  }

  const cancelButton = () => {
    const b = h('button.btn.small', { type: 'button' }, 'Cancel');
    b.addEventListener('click', closeSheet);
    return b;
  };

  pick.addEventListener('click', () => {
    const [f] = chosenFiles();
    if (!f || chosen.length !== 1) return;
    touched = true;
    const go = h('button.btn.small.primary', { type: 'button' }, `Pick ${f.name}`);
    go.addEventListener('click', () => void send('approve', [f], undefined, `Sent. ${host.workerName} knows you picked ${f.name}.`));
    openSheet(h('p', {}, `Tell ${host.workerName} you pick `, h('strong', {}, f.name), '? It keeps the file as it is, and won’t publish or upload it without your go-ahead.'),
      h('div.board-sheet-actions', {}, go, cancelButton()));
    go.focus();
  });

  vary.addEventListener('click', () => {
    const list = chosenFiles();
    if (!list.length) return;
    touched = true;
    const many = list.length > 1;
    const text = h('textarea', { rows: 3, maxlength: 3500, 'aria-label': 'What should change',
      placeholder: many ? 'What should change? Name them by letter: “B’s layout with A’s colors, and a bigger face.”' : 'What should change? For example: a bigger face, a warmer background, three words of title at most.' }) as HTMLTextAreaElement;
    const go = h('button.btn.small.primary', { type: 'button', disabled: true }, `Send to ${host.workerName}`);
    text.addEventListener('input', () => { go.disabled = busy || !text.value.trim(); });
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go.click(); }
    });
    go.addEventListener('click', () => {
      const asked = plain(text.value);
      if (!asked) return;
      // The prompt lists the files by path, in the order chosen (reviewText), then these words: the letters follow that order.
      const said = many ? `On my board they are ${LETTERS.slice(0, list.length).join(', ')}, in the order listed above.\n\n${asked}` : asked;
      void send('variations', list, said, `Sent. ${host.workerName} will save the variations as new files next to ${many ? 'the originals' : 'the original'} and link them here.`);
    });
    openSheet(h('label', {}, many ? `Variations of ${LETTERS.slice(0, list.length).join(', ')}` : `Variations of ${list[0].name}`), text,
      h('div.board-sheet-actions', {}, go, cancelButton(), h('span.board-hint', {}, '⌘↩ sends')));
    text.focus();
  });

  async function send(kind: 'approve' | 'variations', list: ChatArtifact[], text: string | undefined, done: string) {
    if (busy) return;
    busy = true;
    for (const b of sheet.querySelectorAll('button')) b.disabled = true;
    paintActions();
    setStatus('Sending…');
    try {
      await host.review({ kind, files: list.map(ref), ...(text ? { text } : {}) });
      if (stopped) return;
      closeSheet();
      setStatus(done);
      if (kind === 'variations') waiting = new Set(files.map(artifactKey));
    } catch (error) {
      if (stopped) return;
      for (const b of sheet.querySelectorAll('button')) b.disabled = false;
      setStatus(error instanceof Error ? error.message : `${host.workerName} could not be reached`, true);
    } finally {
      busy = false;
      if (!stopped) paintActions();
    }
  }

  return {
    element,
    paint(next, snapshot) {
      data = snapshot;
      files = sections(next, snapshot, host.workerName).flatMap((s) => s.files);
      byKey = new Map(files.map((f) => [artifactKey(f), f]));
      latest = latestLinked(files, snapshot);
      const had = chosen.length;
      chosen = chosen.filter((k) => byKey.has(k));
      // Until the viewer chooses, the stage follows the newest image the worker linked.
      if (!touched || (had && !chosen.length)) {
        const first = latest ?? files[0];
        chosen = first ? [artifactKey(first)] : [];
      }
      // The variations asked for have come (the worker linked new images): they take the stage, side by side.
      const arrived = waiting ? files.filter((f) => !waiting!.has(artifactKey(f)) && originOf(f, snapshot) === 'linked') : [];
      if (arrived.length && sheet.classList.contains('hidden')) {
        waiting = undefined;
        chosen = arrived.sort((a, b) => b.modified - a.modified).slice(0, MOST).reverse().map(artifactKey);
        setStatus(`${arrived.length === 1 ? 'A new image' : `${arrived.length} new images`} from ${host.workerName}${arrived.length > MOST ? `: the newest ${MOST} are side by side` : ''}.`);
      }
      paintGrid();
      paintStage();
    },
    show(file) {
      if (!byKey.has(artifactKey(file))) return;
      choose(artifactKey(file), false);
      tileOf(artifactKey(file))?.scrollIntoView({ block: 'nearest' });
    },
    key(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { step(e.key === 'ArrowRight' ? 1 : -1); return true; }
      if (e.key === 'y' || e.key === 'Y') { setYoutube(!youtube); return true; }
      return false;
    },
    stop() {
      stopped = true;
      closeSheet();
    },
  };
}
