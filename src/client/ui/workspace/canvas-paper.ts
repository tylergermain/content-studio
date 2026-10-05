import { h } from '../dom';

// "Import from Paper" on the design canvas (canvas.ts): the files in your Paper team, the ones open in
// Paper Desktop first, and one click to bring the page of one you pick in as a design. The office does
// the bringing (server/canvas/paper.ts); this only asks which file.

export interface PaperFile {
  id: string;
  name: string;
  updatedAt?: number;
  open?: boolean;
  active?: boolean;
}

export interface PaperPickerDeps {
  /** Paper's files, or why they can't be listed. */
  list(): Promise<{ installed: boolean; files: PaperFile[] }>;
  /** Brings the file's page in; resolves once it's in, rejects with why not. */
  bring(file: PaperFile): Promise<void>;
  close(): void;
}

const when = (ms?: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

/** The picker, already asking Paper for its files. */
export function paperPicker(deps: PaperPickerDeps): HTMLElement {
  const body = h('div.canvas-paper-body', {}, h('p.canvas-note', {}, 'Asking Paper for your files\u2026'));
  const close = h('button.btn.small', { type: 'button', 'aria-label': 'Close', title: 'Close' }, '\u2715');
  close.addEventListener('click', () => deps.close());
  const el = h('div.canvas-paper', { role: 'dialog', 'aria-label': 'Import from Paper' },
    h('div.canvas-paper-head', {}, h('strong', {}, 'Import from Paper'), close),
    h('p.canvas-note', {}, 'Brings the page you\u2019re on in a Paper file across as a design: every artboard, its pictures and its fonts. Paper Desktop needs to be open, and it counts against your Paper plan\u2019s agent allowance.'),
    body);

  function confirm(file: PaperFile) {
    const go = h('button.btn.primary.small', { type: 'button' }, 'Bring it in');
    const back = h('button.btn.small', { type: 'button' }, 'Back');
    const status = h('p.canvas-note', { 'aria-live': 'polite' });
    body.replaceChildren(h('p', {}, h('strong', {}, file.name)), h('p.canvas-note', {}, file.open ? 'It\u2019s open in Paper Desktop: the page showing there comes across.' : 'Paper Desktop will open it to read it.'), h('div.canvas-row', {}, go, back), status);
    back.addEventListener('click', () => void paint());
    go.addEventListener('click', async () => {
      go.disabled = back.disabled = true;
      status.classList.remove('error');
      status.textContent = 'Bringing it in\u2026 a big file takes a minute.';
      try {
        await deps.bring(file);
      } catch (e) {
        go.disabled = back.disabled = false;
        status.classList.add('error');
        status.textContent = e instanceof Error ? e.message : 'It couldn\u2019t come across';
      }
    });
  }

  async function paint() {
    try {
      const { installed, files } = await deps.list();
      if (!installed) return body.replaceChildren(h('p.canvas-note', {}, 'Paper Desktop isn\u2019t installed on the office\u2019s computer.'));
      if (!files.length) return body.replaceChildren(h('p.canvas-note', {}, 'No Paper files yet.'));
      body.replaceChildren(h('div.canvas-paper-files', {}, ...files.map((f) => {
        const b = h('button.canvas-paper-file', { type: 'button' }, h('span.canvas-paper-name', {}, f.name), h('span.canvas-paper-meta', {}, f.active ? 'Showing in Paper' : f.open ? 'Open in Paper' : when(f.updatedAt)));
        b.addEventListener('click', () => confirm(f));
        return b;
      })));
    } catch (e) {
      body.replaceChildren(h('p.canvas-note.error', {}, e instanceof Error ? e.message : 'Paper didn\u2019t answer'));
    }
  }
  void paint();
  return el;
}
