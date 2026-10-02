/**
 * The "Channels to watch" part of a floor's setup (see setup.ts): the YouTube channels whose newest
 * videos play on the floor's screens that are set to (the office builder's inspector, on a video
 * screen). One link a line; the office finds which channel each is and reads its public feed
 * (server/watch.ts), and what it found, or why it couldn't, is listed under the box.
 */
import './watch.css';
import { LIMITS, type WatchChannel, type WatchSetup } from '../../../shared/studio';
import { channelLink } from '../../../shared/youtube';
import { store } from '../../state';
import { h, timeAgo } from '../../ui/dom';

export interface WatchSection {
  el: HTMLElement;
  /** What's in the box, as the setup keeps it; or the lines that aren't YouTube links, when some aren't. */
  value(): WatchSetup | { bad: string[] };
  /** Stops following what the office reads. */
  off(): void;
}

export function watchSection(): WatchSection {
  const was = store.studio.setup.watch?.channels ?? [];
  const box = h('textarea', { rows: 5, spellcheck: 'false', autocomplete: 'off', placeholder: 'https://www.youtube.com/@a-channel\nhttps://www.youtube.com/channel/UC…\nor a link to any video of theirs' }) as HTMLTextAreaElement;
  box.value = was.map((c) => c.url).join('\n');
  const found = h('ul.watch-found');

  /** What the office knows of the channels that are saved: what each is called, or why it couldn't be read. */
  function draw() {
    const channels = store.studio.setup.watch?.channels ?? [];
    const { errors = {}, videos, at } = store.watch;
    if (!channels.length) return found.replaceChildren(h('li.note', {}, 'No channels yet. Paste their links above, one a line, and save.'));
    found.replaceChildren(
      ...channels.map((c) => {
        const out = videos.filter((v) => v.channel === c.name).length;
        const error = errors[c.url];
        const state = error ? h('span.watch-bad', {}, error) : h('span.note', {}, c.id ? (at ? `${out ? `${out} of the newest ${videos.length}` : 'nothing among the newest'} · read ${timeAgo(at)}` : 'reading its feed…') : 'finding the channel…');
        return h('li', {}, h('strong', {}, c.name || c.url.replace(/^https:\/\/www\.youtube\.com\//, '')), state);
      }),
    );
  }
  const offs = [store.on('watch', draw), store.on('studio', draw)];
  draw();

  const el = h(
    'section.studio-section',
    {},
    h('label.studio-field', {}, h('span', {}, `YouTube channels, one link a line (up to ${LIMITS.channels})`), box),
    h('p.note', {}, 'A channel’s own link (youtube.com/@name or youtube.com/channel/UC…), or a link to one of its videos. The office reads each channel’s public feed every ten minutes: no sign-in and no API key.'),
    h('p.note', {}, 'Their newest videos play, through YouTube’s own player, on every video screen set to “Channels we watch” (office builder: pick a video screen, then What it plays).'),
    found,
  );

  return {
    el,
    value() {
      const lines = box.value.split(/\n/).map((l) => l.trim()).filter(Boolean);
      const bad = lines.filter((l) => !channelLink(l));
      if (bad.length) return { bad };
      const channels: WatchChannel[] = [];
      for (const line of lines) {
        const link = channelLink(line)!;
        if (channels.some((c) => c.url === link.url)) continue;
        // What the office had found out about it comes along.
        const known = was.find((c) => c.url === link.url) ?? store.studio.setup.watch?.channels.find((c) => c.url === link.url);
        channels.push({ id: link.kind === 'channel' ? link.id : (known?.id ?? ''), name: known?.name ?? '', url: link.url });
      }
      return { channels: channels.slice(0, LIMITS.channels) };
    },
    off: () => offs.forEach((off) => off()),
  };
}
