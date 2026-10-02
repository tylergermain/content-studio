/**
 * What a video screen plays, in the builder's inspector (see ui.ts): the floor's own videos in turn,
 * one of its files by name, or the newest videos from the YouTube channels the floor watches (which
 * are listed in the floor's setup). It's kept in the piece's `media`: nothing, a file's name, or WATCH_MEDIA.
 */
import './media-picker.css';
import { WATCH_MEDIA } from '../../../shared/furniture';
import { h } from '../../ui/dom';

type Mode = 'all' | 'file' | 'watch';

const NOTES: Record<Mode, string> = {
  all: 'Every video in the floor’s .agent-office/media folder, one after another.',
  file: 'The one file, on a loop.',
  watch: 'The newest videos from the YouTube channels this floor watches, through YouTube’s own player. The channels are in the floor’s setup (🪧 Set up the floor › Channels to watch).',
};

/** The inspector's rows for a piece that plays `media`; `set` is told what it plays instead ('' for every video in the folder). */
export function mediaPicker(media: string | undefined, set: (media: string) => void): HTMLElement[] {
  const mode: Mode = media === WATCH_MEDIA ? 'watch' : media ? 'file' : 'all';
  const select = h('select', {}, h('option', { value: 'all' }, 'This floor’s videos, in turn'), h('option', { value: 'file' }, 'One file from its media folder'), h('option', { value: 'watch' }, 'Channels we watch: newest videos')) as HTMLSelectElement;
  select.value = mode;
  const name = h('input', { type: 'text', maxlength: 120, autocomplete: 'off', spellcheck: 'false', placeholder: 'clip.mp4' }) as HTMLInputElement;
  name.value = mode === 'file' ? media! : '';
  const file = h('label.ob-field', {}, h('span', {}, 'The file’s name'), name);
  const note = h('p.ob-note', {}, NOTES[mode]);
  file.hidden = mode !== 'file';
  select.addEventListener('change', () => {
    const to = select.value as Mode;
    note.textContent = NOTES[to];
    file.hidden = to !== 'file';
    // One file: it plays what it did until the file has a name.
    if (to === 'file') return name.focus();
    set(to === 'watch' ? WATCH_MEDIA : '');
  });
  name.addEventListener('change', () => set(name.value.trim()));
  return [h('label.ob-field', {}, h('span', {}, 'What it plays'), select), file, note];
}
