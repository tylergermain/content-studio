import './ui.css';
import { JUKEBOX_TUNES, NAME_MAX, STREAM, YOUTUBE, checkStreamUrl, trackName, trackTitle, tuneById, videoTitle } from '../../../shared/jukebox';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, toast } from '../../ui/dom';

/** The jukebox: what's on, the tunes to pick from, skip and stop, and a box for a stream or a YouTube video. */
export function openJukebox(net: Net, openVolume: () => void) {
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const now = h('div.jb-now');
  const list = h('ul.svc-list');
  const url = h('input', { type: 'text', placeholder: 'https://… internet radio, an .mp3, or a YouTube link', 'aria-label': 'Stream, audio file or YouTube link', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const name = h('input.jb-name', { type: 'text', placeholder: 'What to call it (optional)', 'aria-label': 'What to call it', maxlength: String(NAME_MAX), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const playUrl = h('button.btn.primary', { type: 'button' }, '📻 Play');
  const volume = h('button.btn', { type: 'button' }, '🔈 Your volume');
  const el = h(
    'div.modal.jukebox',
    { role: 'dialog', 'aria-label': 'Jukebox' },
    h('header', {}, h('h2', {}, '🎵 Jukebox'), close),
    h(
      'div.body',
      {},
      now,
      h('label', { style: 'margin-top:16px' }, 'Put on a tune'),
      list,
      h('label', { style: 'margin-top:16px' }, 'Or play a stream or a YouTube video'),
      h('div.webhook', {}, url, playUrl),
      name,
      h('p.setting-note', {}, 'Internet radio or an audio file plays from the jukebox, for everyone on this floor. A YouTube video plays on the lounge TV, in YouTube’s own player, and its sound is the floor’s music.'),
    ),
    h('footer', {}, h('span.grow', {}, 'Everyone on this floor hears the same song, louder the closer they are to the lounge.'), volume),
  );

  const button = (label: string, title: string, send: () => void, primary = false) => h(primary ? 'button.btn.primary' : 'button.btn', { type: 'button', title, onclick: send }, label);

  const render = () => {
    const j = store.jukebox;
    const stream = j.track === STREAM;
    const video = j.track === YOUTUBE;
    now.replaceChildren(
      h('span.jb-disc', { class: j.on && !video ? 'spin' : '' }, video ? '📺' : stream ? '📻' : '💿'),
      h(
        'div.svc-main',
        {},
        h('div.svc-title', {}, j.on ? trackTitle(j) : 'The jukebox is off'),
        j.on && video && videoTitle(j) ? h('div.svc-meta.jb-full', { title: videoTitle(j) }, videoTitle(j)) : '',
        h('div.svc-meta', {}, j.on ? [video ? 'playing on the lounge TV' : stream ? 'a stream' : tuneById(j.track)?.mood, j.by && `put on by ${j.by}`].filter(Boolean).join(' · ') : j.by ? `${j.by} turned it off` : 'Pick a tune to put it on'),
      ),
      j.on ? button('⏭️ Skip', 'On to the next tune', () => net.send({ t: 'jukebox.skip' })) : button('▶️ Play', `Put ${trackTitle(j)} back on`, () => net.send({ t: 'jukebox.play' }), true),
      j.on ? button('⏹️ Stop', 'Turn the jukebox off', () => net.send({ t: 'jukebox.stop' })) : '',
    );
    list.replaceChildren(
      ...JUKEBOX_TUNES.map((t) => {
        const playing = j.on && j.track === t.id;
        const li = h(
          'li',
          { class: playing ? 'on' : '', tabindex: 0, role: 'button', 'aria-pressed': String(playing), title: playing ? 'Playing now' : `Put on ${t.title}` },
          h('span.jb-icon', {}, playing ? '🔊' : '🎵'),
          h('div.svc-main', {}, h('div.svc-title', {}, t.title), h('div.svc-meta', {}, t.mood)),
        );
        const pick = () => {
          if (!playing) net.send({ t: 'jukebox.play', track: t.id });
        };
        li.addEventListener('click', pick);
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
          }
        });
        return li;
      }),
    );
  };

  const play = () => {
    const u = checkStreamUrl(url.value);
    if ('error' in u) {
      toast(u.error, 'warn');
      return url.focus();
    }
    const called = trackName(name.value);
    net.send({ t: 'jukebox.play', url: u.url, ...(called ? { name: called } : {}) });
    url.value = '';
    name.value = '';
  };
  playUrl.addEventListener('click', play);
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') play();
  });
  url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') play();
  });

  const modal = openModal(el, { doing: '🎵 at the jukebox', onClose: store.on('jukebox', render) });
  close.addEventListener('click', () => modal.close());
  volume.addEventListener('click', () => {
    modal.close();
    openVolume();
  });
  render();
}
