import { h } from '../dom';
import './ui.css';
export function spotifyPanel(stopOfficeMusic: () => void) {
  const root = h('section.spotify-panel');
  let disposed = false, busy = false;
  let selected = '';
  async function request(path = '', body?: unknown) {
    const res = await fetch(`/api/spotify${path}`, { ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error ?? 'Spotify request failed'); return data;
  }
  const note = h('p.setting-note');
  const buttons = (label: string, run: () => Promise<void>) => h('button.btn', { type: 'button', onclick: async () => {
    if (busy) return; busy = true;
    try { await run(); } catch (e) { note.textContent = e instanceof Error ? e.message : 'Spotify request failed'; }
    finally { busy = false; }
  } }, label);
  async function refresh() {
    if (disposed) return;
    try {
      const s = await request(); if (disposed) return;
      const title = h('h3', {}, 'Spotify');
      const intro = h('p.setting-note', {}, 'Control music on your Spotify devices. Audio plays through Spotify on the device you choose.');
      note.textContent = '';
      if (!s.connected) {
        const connect = buttons('Connect Spotify', async () => { const result = await request('/connect', {}); window.open(result.url, '_blank', 'noopener,noreferrer'); note.textContent = 'Finish connecting in the Spotify tab, then click Refresh.'; });
        const clientId = h('input', { type: 'text', 'aria-label': 'Spotify Client ID', placeholder: 'Spotify app Client ID', autocomplete: 'off' }) as HTMLInputElement;
        const callback = h('input', { type: 'text', 'aria-label': 'Spotify redirect URI', value: `http://127.0.0.1:${location.port || '14600'}/api/spotify/callback` }) as HTMLInputElement;
        root.replaceChildren(title, intro, ...(s.configured ? [connect] : [clientId, callback, buttons('Save Spotify app', async () => { await request('/config', { clientId: clientId.value.trim(), redirect: callback.value.trim() }); await refresh(); })]), buttons('Refresh', refresh), note);
        return;
      }
      const player = s.player;
      const devices = h('select', { 'aria-label': 'Spotify playback device' }) as HTMLSelectElement;
      devices.append(h('option', { value: '' }, 'Choose a Spotify device'));
      for (const d of s.devices ?? []) if (d.id && !d.is_restricted) devices.append(h('option', { value: d.id }, d.name));
      devices.value = selected || player?.device?.id || ''; selected = devices.value;
      devices.addEventListener('change', () => { selected = devices.value; });
      const link = h('input', { type: 'text', 'aria-label': 'Spotify music link', placeholder: 'Paste a Spotify playlist, album, or track link' }) as HTMLInputElement;
      const action = async (action: string, uri?: string) => { await request('/playback', { action, device: selected, uri }); if (action === 'play') stopOfficeMusic(); await refresh(); };
      const playLink = buttons('Play link', async () => {
        let uri = link.value.trim();
        if (!uri.startsWith('spotify:')) { const u = new URL(uri); if (u.hostname !== 'open.spotify.com') throw new Error('Use a Spotify music link'); const match = /^\/(?:intl-[a-z]+\/)?(track|album|playlist)\/([a-zA-Z0-9]{22})/.exec(u.pathname); if (!match) throw new Error('Use a track, album, or playlist link'); uri = `spotify:${match[1]}:${match[2]}`; }
        await action('play', uri);
      });
      root.replaceChildren(title, h('p', {}, `Connected as ${s.name}`), intro,
        h('p', {}, player?.item ? `${player.item.name} · ${(player.item.artists ?? []).map((a: { name: string }) => a.name).join(', ')}` : 'Open Spotify on a device to start listening.'),
        h('div.webhook', {}, devices, buttons('Use device', () => action('device'))),
        h('div.seg', {}, buttons('Previous', () => action('previous')), buttons(player?.is_playing ? 'Pause' : 'Resume', () => action(player?.is_playing ? 'pause' : 'play')), buttons('Next', () => action('next'))),
        h('div.webhook', {}, link, playLink), buttons('Refresh', refresh), buttons('Disconnect Spotify', async () => { await request('/disconnect', {}); await refresh(); }), note);
    } catch (e) { if (!disposed) { root.replaceChildren(h('h3', {}, 'Spotify'), note); note.textContent = e instanceof Error ? e.message : 'Could not load Spotify'; } }
  }
  void refresh();
  return { element: root, dispose() { disposed = true; } };
}
