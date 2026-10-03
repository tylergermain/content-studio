import './ui.css';
import { LIMITS, type Post, type StudioBoard } from '../../../shared/studio';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, timeAgo } from '../../ui/dom';

/**
 * One of the floor's own boards, opened: everything posted on it, newest first, with a line to post
 * something yourself (unless the office fills it: the Slack and Metricool ones). Opening it is looking
 * at it, so what was new isn't any more.
 */
export function openBulletin(net: Net, board: StudioBoard, openSetup: () => void) {
  const setup = () => store.studio.setup.boards[board];
  if (!setup()) return;
  const list = h('ul.studio-posts');
  const about = h('p.studio-about');
  const title = h('h2', {});
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');

  const headline = h('input', { type: 'text', maxlength: LIMITS.title, placeholder: 'Headline', 'aria-label': 'Headline', autocomplete: 'off' }) as HTMLInputElement;
  const link = h('input', { type: 'text', maxlength: LIMITS.url, placeholder: 'https://… (optional)', 'aria-label': 'Link', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const note = h('input', { type: 'text', maxlength: LIMITS.body, placeholder: 'A line about it (optional)', 'aria-label': 'Note', autocomplete: 'off' }) as HTMLInputElement;
  const post = h('button.btn.primary', { type: 'button' }, 'Post');
  const form = h('div.studio-form', {}, headline, link, note, post);
  const send = () => {
    if (!headline.value.trim()) return headline.focus();
    net.send({ t: 'studio.post', board, title: headline.value, ...(link.value.trim() ? { url: link.value.trim() } : {}), ...(note.value.trim() ? { body: note.value } : {}) });
    headline.value = link.value = note.value = '';
    headline.focus();
  };
  post.addEventListener('click', send);
  for (const input of [headline, link, note]) input.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && send());

  const row = (p: Post) => {
    const head = p.url ? h('a.studio-title', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, p.title) : h('span.studio-title', {}, p.title);
    const filled = !!setup()?.feed;
    const off = filled ? null : h('button.btn.studio-off', { type: 'button', title: 'Take it down', 'aria-label': `Take down ${p.title}`, onclick: () => net.send({ t: 'studio.unpost', id: p.id }) }, '✕');
    return h('li', {}, h('div.studio-post', {}, head, p.body ? h('p', {}, p.body) : null, h('span.studio-meta', {}, [p.source, p.by !== p.source ? p.by : '', p.at ? timeAgo(p.at) : ''].filter(Boolean).join(' · '))), off);
  };

  const render = () => {
    const s = setup();
    if (!s) return modal.close();
    title.textContent = `${s.icon} ${s.title}`;
    const why = s.feed?.kind === 'slack' ? (store.integrations.errors.slack ?? (store.integrations.slack ? '' : 'The office isn’t signed in to Slack yet.')) : s.feed?.kind === 'metricool' ? (store.integrations.errors.metricool ?? (store.integrations.metricool ? '' : 'The office isn’t signed in to Metricool yet.')) : '';
    about.textContent = [s.about, s.feed?.kind === 'slack' ? `Watching ${s.feed.channels.map((c) => `#${c.name}`).join(', ') || 'no channels yet'}.` : '', why].filter(Boolean).join(' ');
    form.classList.toggle('hidden', !!s.feed);
    const posts = store.studio.posts.filter((p) => p.board === board);
    list.replaceChildren(...(posts.length ? posts.map(row) : [h('li.empty', {}, 'Nothing here yet.')]));
  };

  const tools = store.me.admin ? h('button.btn', { type: 'button', onclick: () => openSetup() }, '⚙️ Set up this floor’s boards') : null;
  const el = h('div.modal.studio-board', { role: 'dialog', 'aria-label': 'Board' }, h('header', {}, title, close), h('div.body', {}, about, form, list), h('footer', {}, h('span.grow', {}, 'Everyone on this floor sees this board on the wall'), tools));
  const offs = [store.on('studio', render), store.on('integrations', render)];
  const modal = openModal(el, { doing: `📌 reading ${setup()!.title}`, onClose: () => offs.forEach((off) => off()) });
  close.addEventListener('click', () => modal.close());
  render();
  net.send({ t: 'studio.seen', board });
}
