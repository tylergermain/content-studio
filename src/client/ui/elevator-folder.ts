import './elevator-folder.css';
import type { FloorInfo } from '../../shared/protocol';
import type { Net } from '../net';
import { h, openModal } from './dom';

// The elevator's own floors, for admins: a floor that's just a folder on the office's machine (no
// repository, nothing to do with GitHub), and renaming a floor or moving it up or down the building.

/**
 * "Use a folder": a name and a folder make a new floor. The office answers with `floor.added`, which the
 * elevator hears (its toast says why, when it couldn't), and the floor shows up in the list when it's there.
 */
export function folderFloor(net: Net): HTMLElement {
  const name = h('input', { type: 'text', placeholder: 'Friday Labs', 'aria-label': 'Floor name', maxlength: 100, autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const dir = h('input', { type: 'text', placeholder: '~/Workspaces/friday-labs', 'aria-label': 'Folder', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const add = h('button.btn.primary', { type: 'button' }, '🛗 Add floor');
  const form = h('div.folder-form.hidden', {}, h('label', {}, 'Name', name), h('label', {}, 'Folder on the office’s machine', dir), h('p.note', {}, 'It’s made if it isn’t there. Workers on the floor work in it; nothing is cloned or pushed.'), add);
  const open = h('button.btn', { type: 'button' }, '📁 Use a folder');
  const send = () => {
    if (!dir.value.trim()) return dir.focus();
    net.send({ t: 'floor.folder', dir: dir.value.trim(), name: name.value.trim() });
    name.value = dir.value = '';
  };
  open.addEventListener('click', () => {
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) name.focus();
  });
  add.addEventListener('click', send);
  for (const input of [name, dir]) input.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && send());
  return h('div.folder-floor', {}, open, form);
}

/** A floor's row gets these: its name, and one storey up or down (the list has the top floor first). */
export function floorTools(net: Net, f: FloorInfo, i: number, count: number): HTMLElement[] {
  const rename = h('button.btn.floor-tool', { type: 'button', title: `Rename ${f.name}`, 'aria-label': `Rename ${f.name}` }, '✏️');
  rename.addEventListener('click', () => renameFloor(net, f));
  const move = (label: string, to: number, what: string) => {
    const b = h('button.btn.floor-tool', { type: 'button', title: `Move ${f.name} ${what}`, 'aria-label': `Move ${f.name} ${what}`, disabled: to < 0 || to >= count }, label);
    b.addEventListener('click', () => net.send({ t: 'floor.edit', floor: f.id, to }));
    return b;
  };
  return [rename, move('▲', i + 1, 'up a storey'), move('▼', i - 1, 'down a storey')];
}

function renameFloor(net: Net, f: FloorInfo) {
  const input = h('input', { type: 'text', maxlength: 100, 'aria-label': 'Floor name', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  input.value = f.name;
  const save = h('button.btn.primary', { type: 'button' }, 'Rename');
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const el = h('div.modal', { role: 'dialog', 'aria-label': 'Rename floor' }, h('header', {}, h('h2', {}, '✏️ Rename floor'), close), h('div.body', {}, input), h('footer', {}, save));
  const modal = openModal(el);
  const done = () => {
    const name = input.value.trim();
    if (name && name !== f.name) net.send({ t: 'floor.edit', floor: f.id, name });
    modal.close();
  };
  close.addEventListener('click', () => modal.close());
  save.addEventListener('click', done);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && done());
  setTimeout(() => input.select(), 0);
}
