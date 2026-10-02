import './ui.css';
import { STATION_AGENT, type StationKind } from '../../../shared/layout';
import { LIMITS, STUDIO_AGENTS, STUDIO_BOARDS, type BoardFeed, type SlackChannel, type StudioBoard, type StudioSetup } from '../../../shared/studio';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, toast } from '../../ui/dom';

// Making a floor its own (admins): what the two wall boards are for and where their posts come from,
// who stands at each kiosk and what they're told, the ticker round the walls, and what the office is
// signed in to so it can fill a board by itself.

const WHERE: Record<StudioBoard, string> = { issues: 'Left board (where Issues hangs)', pulls: 'Right board (where Pull Requests hangs)' };
const KIOSK: Record<StationKind, string> = { issues: 'Kiosk by the left board', queue: 'Kiosk by the task queue', pulls: 'Kiosk by the right board' };

const text = (value: string, attrs: Record<string, string | number> = {}) => {
  const input = h('input', { type: 'text', autocomplete: 'off', ...attrs }) as HTMLInputElement;
  input.value = value;
  return input;
};
const field = (label: string, input: HTMLElement) => h('label.studio-field', {}, h('span', {}, label), input);

export function openStudioSetup(net: Net) {
  if (!store.me.admin) return toast('Only admins can set a floor’s boards up', 'warn');
  const was = store.studio.setup;
  /** The Slack channels the office can read, once it's been asked. */
  let channels: SlackChannel[] | null = null;
  let channelsError = '';

  // ---- The boards -------------------------------------------------------------------------------
  const boards = STUDIO_BOARDS.map((key) => {
    const b = was.boards[key];
    const on = h('input', { type: 'checkbox' }) as HTMLInputElement;
    on.checked = !!b;
    const title = text(b?.title ?? '', { maxlength: LIMITS.name, placeholder: key === 'issues' ? 'Newsroom' : 'Pipeline' });
    const icon = text(b?.icon ?? '', { maxlength: 4, placeholder: '📰', class: 'studio-icon' });
    const about = text(b?.about ?? '', { maxlength: LIMITS.about, placeholder: 'What goes on it, in a line' });
    const source = h('select', {}, h('option', { value: 'posts' }, 'People and agents post to it'), h('option', { value: 'slack' }, 'Slack: the latest in some channels'), h('option', { value: 'metricool' }, 'Metricool: how the socials are doing')) as HTMLSelectElement;
    source.value = b?.feed?.kind ?? 'posts';
    let picked: SlackChannel[] = b?.feed?.kind === 'slack' ? [...b.feed.channels] : [];
    const pick = h('div.studio-channels');
    const drawChannels = () => {
      if (source.value !== 'slack') return pick.replaceChildren();
      if (!store.integrations.slack) return pick.replaceChildren(h('p.note', {}, 'Sign the office in to Slack below, then pick the channels to watch.'));
      if (!channels) return pick.replaceChildren(h('p.note', {}, channelsError || 'Asking Slack for its channels…'));
      const all = [...picked.filter((p) => !channels!.some((c) => c.id === p.id)), ...channels];
      pick.replaceChildren(
        ...all.map((c) => {
          const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
          box.checked = picked.some((p) => p.id === c.id);
          box.addEventListener('change', () => (picked = box.checked ? [...picked, c] : picked.filter((p) => p.id !== c.id)));
          return h('label.studio-channel', {}, box, `#${c.name}`);
        }),
      );
    };
    const fields = h('div.studio-fields', {}, h('div.studio-row', {}, field('Icon', icon), field('Called', title)), field('What it’s for', about), field('Where its posts come from', source), pick);
    const sync = () => {
      fields.classList.toggle('hidden', !on.checked);
      if (source.value === 'slack' && store.integrations.slack && !channels) net.send({ t: 'integrations.channels' });
      drawChannels();
    };
    on.addEventListener('change', sync);
    source.addEventListener('change', sync);
    const el = h('section.studio-section', {}, h('label.studio-toggle', {}, on, h('strong', {}, WHERE[key]), h('span.note', {}, 'a board of this floor’s own, instead of the GitHub one')), fields);
    const value = (): StudioSetup['boards'][StudioBoard] | undefined => {
      if (!on.checked || !title.value.trim()) return undefined;
      const feed: BoardFeed | undefined = source.value === 'slack' ? { kind: 'slack', channels: picked } : source.value === 'metricool' ? { kind: 'metricool' } : undefined;
      return { title: title.value, icon: icon.value || '📌', about: about.value, ...(feed ? { feed } : {}) };
    };
    return { key, el, value, sync, drawChannels };
  });

  // ---- The kiosks -------------------------------------------------------------------------------
  const agents = STUDIO_AGENTS.map((key) => {
    const a = was.agents[key];
    const on = h('input', { type: 'checkbox' }) as HTMLInputElement;
    on.checked = !!a;
    const name = text(a?.name ?? '', { maxlength: LIMITS.name, placeholder: STATION_AGENT[key].name });
    const offer = text(a?.offer ?? '', { maxlength: LIMITS.offer, placeholder: 'Ask me for…' });
    const brief = h('textarea', { rows: 5, maxlength: LIMITS.brief, placeholder: 'What this agent does here, and how. It’s told this when it’s hired, ahead of the first request.' }) as HTMLTextAreaElement;
    brief.value = a?.brief ?? '';
    const fields = h('div.studio-fields', {}, h('div.studio-row', {}, field('Called', name), field('On its card', offer)), field('Its brief', brief));
    const sync = () => fields.classList.toggle('hidden', !on.checked);
    on.addEventListener('change', sync);
    const el = h('section.studio-section', {}, h('label.studio-toggle', {}, on, h('strong', {}, KIOSK[key]), h('span.note', {}, `an agent of this floor’s own, instead of the ${STATION_AGENT[key].name}`)), fields);
    const value = (): StudioSetup['agents'][StationKind] | undefined => (on.checked && name.value.trim() ? { name: name.value, offer: offer.value, brief: brief.value } : undefined);
    return { key, el, value, sync };
  });

  // ---- The ticker, and what the office is signed in to -------------------------------------------
  const symbols = text(was.ticker?.symbols.join(', ') ?? '', { placeholder: 'AAPL, NVDA, MSFT, GOOGL, META, TSLA, ^GSPC, BTC-USD', spellcheck: 'false' });
  const slackToken = h('input', { type: 'password', autocomplete: 'off', placeholder: 'xoxb-… (a Slack app’s bot token)' }) as HTMLInputElement;
  const mcToken = h('input', { type: 'password', autocomplete: 'off', placeholder: 'Metricool API token' }) as HTMLInputElement;
  const mcUser = text('', { placeholder: 'userId', class: 'studio-icon' });
  const mcBlog = text('', { placeholder: 'blogId (the brand)', class: 'studio-icon' });
  const signedIn = h('p.note');
  const connect = (label: string, run: () => void) => h('button.btn', { type: 'button', onclick: run }, label);
  const drawSignedIn = () => {
    const s = store.integrations;
    signedIn.textContent = `Slack: ${s.slack ? 'signed in' : 'not signed in'}${s.errors.slack ? ` (${s.errors.slack})` : ''} · Metricool: ${s.metricool ? 'signed in' : 'not signed in'}${s.errors.metricool ? ` (${s.errors.metricool})` : ''}`;
  };
  const connections = h(
    'section.studio-section',
    {},
    h('strong', {}, 'What the office is signed in to'),
    h('p.note', {}, 'For the boards the office fills by itself, on every floor. The tokens stay on the office’s machine: nobody is ever shown one back.'),
    signedIn,
    h('div.studio-row', {}, field('Slack', slackToken), connect('Sign in', () => slackToken.value.trim() && (net.send({ t: 'integrations.signIn', slack: slackToken.value.trim() }), (slackToken.value = ''))), connect('Sign out', () => net.send({ t: 'integrations.signIn', slack: '' }))),
    h(
      'div.studio-row',
      {},
      field('Metricool', mcToken),
      mcUser,
      mcBlog,
      connect('Sign in', () => {
        if (!mcToken.value.trim() || !mcUser.value.trim() || !mcBlog.value.trim()) return toast('Metricool takes its API token, your userId and the brand’s blogId', 'warn');
        net.send({ t: 'integrations.signIn', metricool: { token: mcToken.value.trim(), userId: mcUser.value.trim(), blogId: mcBlog.value.trim() } });
        mcToken.value = '';
      }),
      connect('Sign out', () => net.send({ t: 'integrations.signIn', metricool: null })),
    ),
  );

  const save = h('button.btn.primary', { type: 'button' }, 'Save for this floor');
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const el = h(
    'div.modal.studio-setup',
    { role: 'dialog', 'aria-label': 'Floor setup' },
    h('header', {}, h('h2', {}, `🪧 ${store.currentFloor()?.name ?? 'This floor'}: boards and agents`), close),
    h(
      'div.body',
      {},
      h('h3', {}, 'Wall boards'),
      ...boards.map((b) => b.el),
      h('h3', {}, 'Kiosk agents'),
      ...agents.map((a) => a.el),
      h('h3', {}, 'Ticker'),
      h('section.studio-section', {}, field('Symbols round the walls, in order (none for no ticker)', symbols), h('p.note', {}, 'Live prices, read every minute. Stocks by their symbol, indexes like ^GSPC, crypto like BTC-USD.')),
      h('h3', {}, 'Connections'),
      connections,
    ),
    h('footer', {}, h('span.grow', {}, 'Applies to everyone on this floor'), save),
  );
  const offs = [
    store.on('integrations', () => {
      drawSignedIn();
      for (const b of boards) b.sync();
    }),
    net.onMessage((m) => {
      if (m.t !== 'integrations.channels') return;
      channels = m.channels;
      channelsError = m.error ?? '';
      if (m.error) channels = null;
      for (const b of boards) b.drawChannels();
    }),
  ];
  const modal = openModal(el, { doing: '🪧 setting up the floor', onClose: () => offs.forEach((off) => off()) });
  close.addEventListener('click', () => modal.close());
  save.addEventListener('click', () => {
    const setup: StudioSetup = { boards: {}, agents: {} };
    for (const b of boards) {
      const v = b.value();
      if (v) setup.boards[b.key] = v;
    }
    for (const a of agents) {
      const v = a.value();
      if (v) setup.agents[a.key] = v;
    }
    const list = symbols.value.split(/[\s,]+/).filter(Boolean);
    if (list.length) setup.ticker = { symbols: list };
    net.send({ t: 'studio.setup', setup });
    modal.close();
  });
  drawSignedIn();
  for (const b of boards) b.sync();
  for (const a of agents) a.sync();
}
