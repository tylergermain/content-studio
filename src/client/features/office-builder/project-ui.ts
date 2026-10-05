/**
 * A project room, in the builder's inspector (see ui.ts): how big a stretch of floor it marks out, the
 * folder its project is in, where its app runs, and whether it's a room you keep. It's all kept on the
 * piece (w, d and project: see Piece, and shared/project-rooms.ts); the office checks the folder when
 * the layout's saved.
 */
import './project-ui.css';
import type { Piece } from '../../../shared/furniture';
import { PROJECT_SIZE, cleanProject, cleanProjectDir, cleanProjectUrl, type ProjectLink } from '../../../shared/project-rooms';
import { h } from '../../ui/dom';

/** The inspector's rows for the project room `piece`; `edit` is told what changes of it. Nothing can be changed while it's `fixed`. */
export function projectUi(piece: Piece, edit: (patch: Partial<Piece>) => void, fixed: boolean): HTMLElement[] {
  const link = piece.project ?? {};
  /** The project with `patch` over it: nothing at all once every part of it is gone. */
  const relink = (patch: Partial<ProjectLink>) => edit({ project: cleanProject({ ...link, ...patch }) });

  /** A slider that says its value in meters beside its name, and changes the room when it's let go. */
  function slider(label: string, value: number, set: (n: number) => void): HTMLElement {
    const says = h('output', {}, `${value.toFixed(2)} m`);
    const input = h('input', { type: 'range', min: PROJECT_SIZE.min, max: PROJECT_SIZE.max, step: 0.25, disabled: fixed }) as HTMLInputElement;
    input.value = String(value);
    input.addEventListener('input', () => (says.textContent = `${input.valueAsNumber.toFixed(2)} m`));
    input.addEventListener('change', () => set(input.valueAsNumber));
    return h('label.ob-field', {}, h('span.ob-measure', {}, label, says), input);
  }

  /** A line of text that's kept once it's fit to keep (`clean`), with `warn` under it until then. */
  function text(label: string, value: string | undefined, placeholder: string, clean: (raw: string) => string | undefined, warn: string, set: (v: string | undefined) => void): HTMLElement {
    const input = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder, disabled: fixed }) as HTMLInputElement;
    input.value = value ?? '';
    const note = h('p.ob-note.warn', { hidden: true }, warn);
    input.addEventListener('change', () => {
      const raw = input.value.trim();
      const kept = raw ? clean(raw) : undefined;
      note.hidden = !raw || !!kept;
      if (!raw || kept) set(kept);
    });
    return h('label.ob-field', {}, h('span', {}, label), input, note);
  }

  const keep = h('input', { type: 'checkbox', disabled: fixed }) as HTMLInputElement;
  keep.checked = !!link.keep;
  keep.addEventListener('change', () => relink({ keep: keep.checked || undefined }));

  const rows: HTMLElement[] = [
    h('p.ob-note', {}, 'Lay it under the desks of one project. Whoever’s hired at a desk on it starts in the project’s folder; a specialist keeps its role’s folder and is told where the project is.'),
    h('div.ob-row', {}, slider('Wide', piece.w ?? PROJECT_SIZE.min, (w) => edit({ w })), slider('Deep', piece.d ?? PROJECT_SIZE.min, (d) => edit({ d }))),
    text('Project folder', link.dir, '/Users/you/Workspaces/project', cleanProjectDir, 'Use the folder’s full path, starting with /.', (dir) => relink({ dir, git: undefined })),
    text('Its app’s address', link.url, 'http://localhost:3000', cleanProjectUrl, 'Use an http or https address.', (url) => relink({ url })),
    h('label.ob-field.ob-check', {}, keep, h('span', {}, 'Keep this room: a project we’re always on')),
  ];
  if (link.git) rows.push(h('p.ob-note', {}, 'It’s a git checkout. Everyone in the room shares it, so workers here are told not to switch branches or commit unless asked.'));
  if (link.url) rows.push(h('a.btn', { href: link.url, target: '_blank', rel: 'noopener' }, 'Open the app ↗'));
  return rows;
}
