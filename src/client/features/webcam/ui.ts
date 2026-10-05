// What you see of your own webcam: your picture in the corner while it's on (a mirror's, as a selfie
// is), which says so in red and turns it off when clicked; and its setting in ⚙️ Settings.

import './ui.css';
import { $, h, toast } from '../../ui/dom';
import type { Webcam } from './camera';
import { cameraName } from './logic';

/** The key that turns it on and off (see the controls help). */
export const WEBCAM_KEY = 'I';

/** Your picture in the bottom-right corner while your webcam is on. Hands back what redraws it. */
export function selfView(cam: Webcam, turnOff: () => void): () => void {
  const video = h('video', { 'aria-hidden': 'true' });
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  const live = h('span.cam-live', {}, h('i', { 'aria-hidden': 'true' }), h('span'));
  const el = h('button.cam-self.panel.hidden', { type: 'button', onclick: turnOff }, video, live);
  $('hud').append(el);
  return () => {
    const { state, stream } = cam;
    el.classList.toggle('hidden', state === 'off');
    el.classList.toggle('starting', state === 'starting');
    live.lastElementChild!.textContent = state === 'starting' ? 'Starting camera…' : 'On camera';
    el.title = `Your webcam is your face: people near you on your floor see it. Click (or ${WEBCAM_KEY}) to turn it off.`;
    el.setAttribute('aria-label', state === 'starting' ? 'Your webcam is starting: turn it off' : 'Your webcam is on: turn it off');
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      if (stream) void video.play().catch(() => {});
    }
  };
}

/** The webcam's setting in ⚙️ Settings: on or off, which camera, and what it means. */
export function webcamSetting(cam: Webcam, turn: (on: boolean) => void): { body: Node[]; close: () => void } {
  const seg = h('div.seg', { role: 'radiogroup', 'aria-label': 'Show my webcam as my face' });
  const pick = h('select.cam-pick.hidden', { 'aria-label': 'Which camera' }) as HTMLSelectElement;
  const note = h('p.setting-note');
  const paint = () => {
    const on = cam.state !== 'off';
    seg.replaceChildren(
      ...([
        [true, cam.state === 'starting' ? '📷 Starting…' : '📷 Show my webcam as my face'],
        [false, 'Off'],
      ] as const).map(([value, label]) =>
        h('button.btn', { type: 'button', role: 'radio', 'aria-checked': String(on === value), class: on === value ? 'on' : '', onclick: () => on !== value && turn(value) }, label),
      ),
    );
    note.textContent =
      (on ? 'On: your webcam is on your character’s face for the people near you on your floor, and you see yourself in the corner. ' : 'Off. Turned on, your webcam is on your character’s face for the people near you on your floor. ') +
      `It goes from your browser to theirs (through the office’s relay server if it has one, still encrypted), small and only to the few near enough to see it, and the office never decodes, records or keeps it. Off, the camera stops and its light goes out. It never comes on by itself: ${WEBCAM_KEY} or the ☰ menu turns it on and off too.`;
    void fill();
  };
  /** The cameras to pick from, when there's more than one. */
  const fill = async () => {
    const cams = await cam.cameras();
    pick.classList.toggle('hidden', cams.length < 2);
    const now = cam.deviceId;
    pick.replaceChildren(...cams.map((d, i) => h('option', { value: d.deviceId, selected: d.deviceId === now }, cameraName(d.label, i))));
  };
  pick.addEventListener('change', async () => {
    const err = await cam.pick(pick.value);
    if (err) toast(`📷 ${err}`, 'warn');
  });
  paint();
  const off = cam.onChange(paint);
  navigator.mediaDevices?.addEventListener('devicechange', fill);
  return {
    body: [seg, pick, note],
    close: () => {
      off();
      navigator.mediaDevices?.removeEventListener('devicechange', fill);
    },
  };
}
