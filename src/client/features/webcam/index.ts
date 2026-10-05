/**
 * Your webcam as your character's face. Off until you turn it on (I, the ☰ menu, or ⚙️ Settings →
 * Sound & voice), every time: nothing turns it on by itself. While it's on, the people on your floor
 * near enough to see your face (the nearest few, see MOST) see your webcam on it, you see yourself in
 * the corner, and turning it off stops the camera. The picture goes on the voice connections, a line
 * of its own beside the screen share's (see voice-camera.ts), browser to browser or, where the office
 * has a TURN server, relayed through it still encrypted, and to nobody on another floor. The office
 * never decodes, records or keeps it: it only hears that it's on (PeerInfo.webcam), so everyone knows
 * to look for it.
 *
 * Nobody has to be in voice for it: the connections are there between everyone on a floor either way.
 */
import type { PeerInfo } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { toast } from '../../ui/dom';
import { addHudAction } from '../../ui/menu';
import { addSetting } from '../../ui/settings-rows';
import type { RemotePeer } from '../peers';
import { Webcam } from './camera';
import { CamFace } from './face';
import { MOST, Nearest, SEND, SHOW } from './logic';
import { WEBCAM_KEY, selfView, webcamSetting } from './ui';

export interface WebcamDeps {
  /** Everyone else on your floor, as you see them (see features/peers). */
  remotes: ReadonlyMap<string, RemotePeer>;
}

/** How often (ms) who your webcam goes to, and whose faces show theirs, is looked at again. */
const EVERY = 200;

/** Binds I, adds the webcam to the ☰ menu and ⚙️ Settings, and follows who's near enough to send it to and see. */
export function installWebcam(ctx: Ctx, deps: WebcamDeps) {
  const { voice, net, player } = ctx;
  const cam = new Webcam();

  async function turnOn() {
    if (cam.state !== 'off') return;
    const err = await cam.start();
    if (err) toast(`📷 ${err}`, 'warn');
    // (Unless it was turned off again while the browser asked.)
    else if (cam.track) toast(`📷 Your webcam is your face: people near you on your floor see it. ${WEBCAM_KEY} turns it off`);
  }
  const turn = (on: boolean) => (on ? void turnOn() : cam.stop());
  const toggle = () => turn(cam.state === 'off');

  ctx.keys.bind({ code: `Key${WEBCAM_KEY}`, repeat: false, run: toggle });
  addHudAction({
    id: 'webcam',
    icon: '📷',
    label: () => (cam.state === 'off' ? 'Webcam as my face' : 'Turn my webcam off'),
    section: 'Together',
    key: WEBCAM_KEY,
    on: () => cam.state !== 'off',
    // Up on the top bar the whole time it's on, in red.
    status: () => cam.state !== 'off',
    chip: () => (cam.state === 'starting' ? 'Starting camera…' : 'On camera'),
    tone: () => (cam.state === 'on' ? 'danger' : undefined),
    blocked: () => (window.isSecureContext ? undefined : 'Your webcam needs HTTPS or localhost, like voice does'),
    title: () => (cam.state === 'off' ? `Show your webcam on your character’s face (${WEBCAM_KEY})` : `Your webcam is your face: click (or ${WEBCAM_KEY}) to turn it off`),
    run: toggle,
  });
  addSetting({ pane: 'sound', title: 'Webcam face', scope: 'you', make: () => webcamSetting(cam, turn) });
  const paintSelf = selfView(cam, () => cam.stop());

  /** Whether the office has been told it's on. */
  let told = false;
  const tell = () => {
    const on = cam.state === 'on';
    if (on !== told) net.send({ t: 'webcam', on });
    told = on;
  };
  cam.onChange(() => {
    tell();
    paintSelf();
    ctx.hud.refresh();
    follow();
  });
  // After a reconnect the office has forgotten.
  ctx.messages.on('welcome', () => {
    told = false;
    tell();
  });

  /** How far `peer` is from you (m), or null when they're nowhere you could see them. */
  const away = (peer: PeerInfo | undefined): number | null =>
    peer && store.onMyFloor(peer) && !peer.lite ? Math.hypot(peer.x - player.pos.x, peer.y - player.pos.y, peer.z - player.pos.z) : null;

  /** Who your webcam's going to now: the nearest on your floor near enough (see SEND and MOST). */
  const sending = new Nearest(SEND, MOST);
  /** Whose webcam plays on their face: the nearest near enough (see SHOW and MOST). The faces wearing them. */
  const showing = new Nearest(SHOW, MOST);
  const faces = new Map<string, CamFace>();
  let mine: CamFace | null = null;

  function follow() {
    const track = cam.state === 'on' ? cam.track : null;
    sending.begin();
    if (track) for (const id of voice.conns.keys()) sending.add(id, away(store.peers.get(id)));
    const to = sending.end();
    for (const id of voice.conns.keys()) voice.sendCamera(id, to.has(id) ? track : null, cam.scale);

    showing.begin();
    for (const [id, r] of deps.remotes) {
      const peer = store.peers.get(id);
      let face = faces.get(id);
      // Someone who left the floor and came back is a new character.
      if (face && (face.person !== r.person || !peer?.webcam)) {
        face.dispose();
        faces.delete(id);
        face = undefined;
      }
      if (!peer?.webcam) continue;
      if (!face) faces.set(id, (face = new CamFace(r.person, false)));
      showing.add(id, r.person.root.position.distanceTo(player.pos));
    }
    const near = showing.end();
    // Further off (or further than the nearest few) it's paused on its last frame, and someone never
    // near enough is never played at all.
    for (const [id, face] of faces) {
      if (deps.remotes.has(id)) face.show(voice.remoteCamera(id), near.has(id));
      else {
        face.dispose();
        faces.delete(id);
      }
    }

    // Yours, as you see it in third person: a mirror's.
    if (cam.state === 'off') {
      mine?.dispose();
      mine = null;
    } else (mine ??= new CamFace(ctx.me, true)).show(cam.track, true);
  }
  // On a timer, not the frame: a tab in the background draws no frames, but who your webcam goes to
  // still has to be looked at while it's there (someone walking off, or taking the elevator to another
  // floor), and timers keep going in a background tab, about once a second. Where people are keeps
  // coming over the socket all the while.
  setInterval(follow, EVERY);
  // Off the page (a tab closed, a reload): the camera's let go of with it.
  window.addEventListener('pagehide', () => cam.stop());

  return { webcam: cam };
}
