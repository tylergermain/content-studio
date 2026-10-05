import test from 'node:test';
import assert from 'node:assert/strict';
import { FACE_ZOOM, MOST, Nearest, SEND, SHOW, camScale, cameraConstraints, cameraName, faceShows, faceUv, squareCrop, within } from '../src/client/features/webcam/logic.js';
import { webcamHandlers } from '../src/server/ws/handlers/webcam.js';

// Your webcam as your character's face (features/webcam): the rules it goes by, its own line on a voice
// connection (voice-camera.ts, and where Voice hands signals to it), and the flag the office keeps.

// The store keeps things in localStorage: stand it in.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, String(v)), removeItem: (k: string) => void storage.delete(k) },
});
const cams = await import('../src/client/voice-camera.js');
const { Voice } = await import('../src/client/voice.js');

test('a webcam comes on near enough and goes off further out, steady at the edge, and never for someone you could not see', () => {
  assert.equal(within(SHOW, false, 10), true);
  assert.equal(within(SHOW, false, SHOW.near + 0.5), false, 'not yet');
  assert.equal(within(SHOW, true, SHOW.near + 0.5), true, 'stays on between near and far');
  assert.equal(within(SHOW, true, SHOW.far + 0.5), false);
  assert.equal(within(SHOW, true, null), false, 'another floor, or the 2D view');
  assert.equal(within(SHOW, true, Number.NaN), false);
  // Yours is sent from a little further out than faces show it, so it has arrived by the time they're
  // near, and stops a little after they've stopped showing it: never while it's shown, and hardly
  // ever to someone who isn't showing it.
  assert.ok(SEND.near > SHOW.near && SEND.near <= SHOW.far);
  assert.ok(SEND.far > SHOW.far && SEND.far - SHOW.far <= 1);
  assert.equal(within(SEND, false, SHOW.near), true);
  assert.equal(within(SEND, true, SHOW.far), true, 'still sent while it can still be shown');
  assert.equal(within(SEND, true, SHOW.far + 1.5), false);
});

test('your webcam goes to the nearest few, and only the nearest few faces play theirs', () => {
  assert.equal(MOST, 8);
  const near = new Nearest(SHOW, 3);
  const pass = (people: [string, number | null][]) => {
    near.begin();
    for (const [id, d] of people) near.add(id, d);
    return [...near.end()].sort();
  };
  // Five within reach, one too far, one nowhere to be seen: the three nearest.
  assert.deepEqual(pass([['a', 5], ['b', 1], ['c', 12], ['d', 3], ['e', 20], ['far', 40], ['gone', null]]), ['b', 'd', 'a'].sort());
  // Someone new a little nearer than the third doesn't take its place, or two would take turns.
  assert.deepEqual(pass([['a', 5], ['b', 1], ['d', 3], ['new', 4]]), ['a', 'b', 'd']);
  // Nearer by more than the margin, it does.
  assert.deepEqual(pass([['a', 5], ['b', 1], ['d', 3], ['new', 2.5]]), ['b', 'd', 'new']);
  // The margin at the edge of the range holds as it does for one (see within).
  assert.deepEqual(pass([['b', SHOW.near + 1]]), ['b']);
  assert.deepEqual(pass([['b', SHOW.far + 1]]), []);
  assert.deepEqual(pass([['b', SHOW.near + 1]]), [], 'not back until near enough again');
  // Someone not there any more is let go of.
  assert.deepEqual(pass([['a', 1]]), ['a']);
  assert.deepEqual(pass([]), []);
});

test('a face is drawn, waits for the picture, or shows it', () => {
  assert.equal(faceShows(false, true), 'drawn');
  assert.equal(faceShows(true, false), 'waiting');
  assert.equal(faceShows(true, true), 'video');
});

test('the camera is asked for a small square at 15 a second, from the camera picked if there is one', () => {
  const any = cameraConstraints() as Record<string, unknown>;
  assert.equal(any.deviceId, undefined);
  assert.deepEqual(any.width, { ideal: 240 });
  assert.deepEqual(any.height, { ideal: 240 });
  assert.deepEqual(any.frameRate, { ideal: 15, max: 15 });
  assert.deepEqual((cameraConstraints('cam-2') as Record<string, unknown>).deviceId, { exact: 'cam-2' });
  // Whatever the camera hands over is shrunk to about that before it goes out.
  assert.equal(camScale(240, 240), 1);
  assert.equal(camScale(640, 480), 2);
  assert.equal(camScale(1280, 720), 3);
  assert.equal(camScale(160, 120), 1, 'never blown up');
  assert.equal(camScale(undefined, undefined), 1);
});

test('the middle of the picture goes on the face, closer in than the camera frames it, a mirror’s for your own', () => {
  // The middle three quarters of the middle square, across and down: a face, not a porthole.
  assert.equal(FACE_ZOOM, 0.5);
  assert.deepEqual(squareCrop(240, 240, false), { repeat: [0.5, 0.5], offset: [0.25, 0.25] });
  assert.deepEqual(squareCrop(640, 480, false), { repeat: [0.375, 0.5], offset: [0.3125, 0.25] });
  assert.deepEqual(squareCrop(480, 640, false), { repeat: [0.5, 0.375], offset: [0.25, 0.3125] });
  // Mirrored, left runs to right over the same square, round the same middle.
  const m = squareCrop(640, 480, true);
  assert.deepEqual(m.repeat, [-0.375, 0.5]);
  const u = (at: number) => at * m.repeat[0] + m.offset[0];
  assert.equal(u(0), 0.78125);
  assert.equal(u(1), 0.3125);
  assert.equal((u(0) + u(1)) / 2, 0.5);
  assert.deepEqual(squareCrop(0, 0, false), { repeat: [0.5, 0.5], offset: [0.25, 0.25] }, 'before the picture has a size');
});

test('the picture lies across the face the way round it would be face to face', () => {
  assert.deepEqual(faceUv(0, 0, 0.25), [0.5, 0.5]);
  // Their right (the head's -x, on your left as you face them) is the picture's left, as a camera sees it.
  assert.deepEqual(faceUv(-0.25, 0, 0.25), [0, 0.5]);
  assert.deepEqual(faceUv(0.25, 0.25, 0.25), [1, 1]);
});

test('a camera is called by its name once the browser says it, else by its place', () => {
  assert.equal(cameraName('FaceTime HD Camera (05ac:8514)', 0), 'FaceTime HD Camera');
  assert.equal(cameraName('', 1), 'Camera 2');
});

// ---- The webcam's line on a connection --------------------------------------------------------------

let made = 0;
class Line {
  mid: string | null;
  direction: RTCRtpTransceiverDirection;
  currentDirection: RTCRtpTransceiverDirection | null = null;
  readonly receiver = { track: { kind: 'video', id: `their-${++made}` } };
  readonly sender: { track: unknown; params: { encodings: Record<string, unknown>[] }; replaceTrack(t: unknown): Promise<void>; getParameters(): object; setParameters(p: object): Promise<void> };
  init?: { sendEncodings?: object[] };
  constructor(mid: string | null, direction: RTCRtpTransceiverDirection, track: unknown = null) {
    this.mid = mid;
    this.direction = direction;
    const sender = {
      track,
      params: { encodings: [{}] as Record<string, unknown>[] },
      replaceTrack: (t: unknown) => ((sender.track = t), Promise.resolve()),
      getParameters: () => structuredClone(sender.params),
      setParameters: (p: object) => ((sender.params = p as typeof sender.params), Promise.resolve()),
    };
    this.sender = sender;
  }
  stop() {
    this.direction = 'stopped';
  }
}
/** As much of an RTCPeerConnection as the webcam's line, and Voice answering an offer, lean on. Its descriptions are the mids they have. */
class FakePC {
  signalingState: RTCSignalingState = 'stable';
  readonly lines: Line[] = [];
  localDescription: { toJSON(): object } | null = null;
  getTransceivers = () => this.lines;
  addTransceiver(track: unknown, init: Line['init']) {
    const line = new Line(null, 'sendrecv', track);
    line.init = init;
    this.lines.push(line);
    return line;
  }
  /** An offer of theirs is in: a line for each mid we haven't got, ours to receive on. */
  async setRemoteDescription(d: { type: string; sdp: string }) {
    for (const mid of JSON.parse(d.sdp) as string[]) if (!this.lines.some((l) => l.mid === mid)) this.lines.push(new Line(mid, 'recvonly'));
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  /** Answers it with each line as it's set to go now. */
  async setLocalDescription() {
    this.signalingState = 'stable';
    for (const l of this.lines) l.currentDirection = l.direction;
    const lines = this.lines.map((l) => [l.mid, l.direction]);
    this.localDescription = { toJSON: () => ({ type: 'answer', sdp: JSON.stringify(lines) }) };
  }
  /** Our offer of the lines we made is answered: each gets the next mid. */
  agree() {
    for (const l of this.lines) l.mid ??= String(this.lines.indexOf(l));
    for (const l of this.lines) l.currentDirection = l.direction;
  }
}
const asPc = (pc: FakePC) => pc as unknown as RTCPeerConnection;
const camTrack = { kind: 'video', id: 'my-webcam' };
/** Makes our webcam's line on `pc` the way the webcam does, on a connection that settled long ago. */
function ourLine(t: { mock: { method: typeof test.mock.method } }, pc: FakePC): Line {
  let clock = Math.ceil(performance.now());
  const now = t.mock.method(performance, 'now', () => (clock += cams.CAM_SETTLE));
  cams.sendCam(asPc(pc), camTrack as never);
  now.mock.restore();
  return pc.lines.at(-1)!;
}

test('the first webcam on a connection makes its line once the connection has settled, and after that it goes on and off without a word', (t) => {
  let now = 1000;
  t.mock.method(performance, 'now', () => now);
  const pc = new FakePC();
  // Nothing to send makes nothing, but starts the clock.
  cams.sendCam(asPc(pc), null);
  now += cams.CAM_SETTLE - 1;
  cams.sendCam(asPc(pc), camTrack as never, 2);
  assert.equal(pc.lines.length, 0, 'a brand-new connection is left to whatever the other side opens it with');
  now += 1;
  pc.signalingState = 'have-local-offer';
  cams.sendCam(asPc(pc), camTrack as never, 2);
  assert.equal(pc.lines.length, 0, 'not while something else is being negotiated');
  pc.signalingState = 'stable';
  cams.sendCam(asPc(pc), camTrack as never, 2);
  assert.equal(pc.lines.length, 1);
  const [line] = pc.lines;
  assert.equal(line.direction, 'sendrecv');
  assert.equal(line.sender.track, camTrack);
  assert.deepEqual(line.init?.sendEncodings, [{ ...cams.CAM_ENCODING, scaleResolutionDownBy: 2 }], 'small and slow from the start');
  pc.agree();
  assert.equal(cams.camMid(asPc(pc)), '0', 'signals name it from now on');
  // Off (or too far away) and on again: the same line, nothing new to agree on.
  cams.sendCam(asPc(pc), null);
  assert.equal(line.sender.track, null);
  cams.sendCam(asPc(pc), camTrack as never, 2);
  assert.equal(line.sender.track, camTrack);
  assert.equal(pc.lines.length, 1);
  // What comes back on it is theirs only once they say so (they put theirs on it too, see openCam).
  assert.equal(cams.theirCam(asPc(pc)), null);
  assert.equal(cams.theirCamLine(asPc(pc), line as never), false);
  cams.heardCam(asPc(pc), '0');
  assert.equal(cams.theirCamLine(asPc(pc), line as never), true);
  assert.equal(cams.theirCam(asPc(pc)), line.receiver.track);
});

test('both turning theirs on at once, the polite side waits a moment for the other’s line, to share it', (t) => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const pc = new FakePC();
  cams.sendCam(asPc(pc), null, 1, true);
  now += cams.CAM_SETTLE;
  cams.sendCam(asPc(pc), camTrack as never, 1, true);
  now += cams.CAM_DEFER - 1;
  cams.sendCam(asPc(pc), camTrack as never, 1, true);
  assert.equal(pc.lines.length, 0, 'still waiting');
  // Theirs arrives meanwhile: ours goes on it, and no line of our own is offered across theirs.
  pc.lines.push(new Line('0', 'recvonly'));
  cams.heardCam(asPc(pc), '0');
  cams.openCam(asPc(pc));
  pc.agree();
  cams.sendCam(asPc(pc), camTrack as never, 1, true);
  assert.equal(pc.lines.length, 1);
  assert.equal(pc.lines[0].sender.track, camTrack);
  assert.equal(cams.camMid(asPc(pc)), '0');
  // Without one coming, it makes its own once the moment's up.
  const alone = new FakePC();
  cams.sendCam(asPc(alone), null, 1, true);
  now += cams.CAM_SETTLE;
  cams.sendCam(asPc(alone), camTrack as never, 1, true);
  assert.equal(alone.lines.length, 0);
  now += cams.CAM_DEFER;
  cams.sendCam(asPc(alone), camTrack as never, 1, true);
  assert.equal(alone.lines.length, 1);
});

test('a webcam line our share landed on as two offers crossed stays the share’s, and ours goes on a line of its own', (t) => {
  const pc = new FakePC();
  // Their webcam's line, which our share's line was matched up with as their offer came in.
  const shared = new Line('0', 'sendrecv', { kind: 'video', id: 'my-screen' });
  pc.lines.push(shared);
  cams.heardCam(asPc(pc), '0');
  cams.openCam(asPc(pc));
  assert.equal(shared.sender.track?.id, 'my-screen', 'the share stays on it');
  assert.equal(cams.camMid(asPc(pc)), undefined, 'so we name no line of ours: what we send on it is a share to them');
  assert.equal(cams.theirCam(asPc(pc)), shared.receiver.track, 'what they send on it is their webcam');
  // Our webcam, turned on, makes a line of its own.
  const ours = ourLine(t, pc);
  assert.notEqual(ours, shared);
  assert.equal(pc.lines.length, 2);
});

test('their webcam’s line is answered open both ways and is ours too, and a line of ours that was never agreed on gives way to it', (t) => {
  const pc = new FakePC();
  // Ours was offered at the same moment as theirs, and gave way: it never got a mid.
  const ours = ourLine(t, pc);
  assert.equal(ours.mid, null);
  cams.heardCam(asPc(pc), '0');
  pc.lines.push(new Line('0', 'recvonly'));
  cams.openCam(asPc(pc));
  const theirs = pc.lines[1];
  assert.equal(theirs.direction, 'sendrecv');
  assert.equal(ours.direction, 'stopped');
  assert.equal(theirs.sender.track, camTrack, 'our webcam moved over');
  assert.equal(cams.camMid(asPc(pc)), '0');
  assert.equal(cams.theirCamLine(asPc(pc), theirs as never), true);
  assert.equal(cams.theirCam(asPc(pc)), theirs.receiver.track);
  // A screen's line is no webcam's.
  assert.equal(cams.theirCamLine(asPc(pc), new Line('1', 'recvonly') as never), false);
  assert.equal(cams.theirCamLine(asPc(new FakePC()), theirs as never), false);
});

test('a webcam’s line is one to keep anything else of ours off: ours from when it’s made, theirs once they name it', (t) => {
  const pc = new FakePC();
  assert.equal(cams.isCamLine(asPc(pc), undefined), false);
  const video = new Line('0', 'sendrecv');
  pc.lines.push(video);
  assert.equal(cams.isCamLine(asPc(pc), video as never), false, 'a video line is a share’s until someone says otherwise');
  // Ours, before its offer has even given it a mid.
  const ours = ourLine(t, pc);
  assert.equal(ours.mid, null);
  assert.equal(cams.isCamLine(asPc(pc), ours as never), true);
  assert.equal(cams.isCamLine(asPc(new FakePC()), ours as never), false, 'on its own connection only');
  // Theirs, once a signal of theirs names it.
  const theirs = new Line('1', 'recvonly');
  pc.lines.push(theirs);
  assert.equal(cams.isCamLine(asPc(pc), theirs as never), false);
  cams.heardCam(asPc(pc), '1');
  assert.equal(cams.isCamLine(asPc(pc), theirs as never), true);
  assert.equal(cams.isCamLine(asPc(pc), video as never), false);
});

test('two webcam lines that were both agreed on stay, each side’s webcam on its own', (t) => {
  const pc = new FakePC();
  const ours = ourLine(t, pc);
  pc.agree();
  pc.lines.push(new Line('1', 'recvonly'));
  cams.heardCam(asPc(pc), '1');
  cams.openCam(asPc(pc));
  assert.equal(ours.direction, 'sendrecv');
  assert.equal(cams.camMid(asPc(pc)), '0', 'ours goes on ours');
  assert.equal(cams.theirCam(asPc(pc)), pc.lines[1].receiver.track, 'theirs comes on theirs');
  assert.equal(pc.lines[1].direction, 'recvonly', 'nothing of ours goes on theirs');
  assert.equal(cams.theirCamLine(asPc(pc), ours as never), false, 'nor theirs on ours');
  // Both are webcams' lines, for anything else of ours that's after a video line to go on.
  assert.equal(cams.isCamLine(asPc(pc), ours as never), true);
  assert.equal(cams.isCamLine(asPc(pc), pc.lines[1] as never), true);
  assert.equal(cams.isCamLine(asPc(pc), new Line('2', 'recvonly') as never), false);
});

test('a line they made is held to the same bitrate as one we made, once it has been agreed on', async () => {
  const pc = new FakePC();
  pc.lines.push(new Line('0', 'recvonly'));
  cams.heardCam(asPc(pc), '0');
  cams.openCam(asPc(pc));
  pc.agree();
  cams.sendCam(asPc(pc), camTrack as never, 1);
  await Promise.resolve();
  assert.equal(pc.lines[0].sender.track, camTrack);
  assert.deepEqual(pc.lines[0].sender.params.encodings[0], { ...cams.CAM_ENCODING, scaleResolutionDownBy: 1 });
});

test('a browser that won’t cap a line is asked a few times, not for ever', async () => {
  const pc = new FakePC();
  pc.lines.push(new Line('0', 'recvonly'));
  cams.heardCam(asPc(pc), '0');
  cams.openCam(asPc(pc));
  pc.agree();
  const sender = pc.lines[0].sender;
  let asked = 0;
  sender.setParameters = () => (asked++, Promise.reject(new Error('not supported')));
  // The webcam's looked at five times a second: a minute of it.
  for (let i = 0; i < 300; i++) {
    cams.sendCam(asPc(pc), camTrack as never, 1);
    await Promise.resolve();
    await Promise.resolve();
  }
  assert.equal(asked, cams.CAP_TRIES);
  assert.equal(sender.track, camTrack, 'the webcam goes all the same');
  // One that takes it the third time is capped, and asked no more.
  const later = new FakePC();
  later.lines.push(new Line('0', 'recvonly'));
  cams.heardCam(asPc(later), '0');
  cams.openCam(asPc(later));
  later.agree();
  let tries = 0;
  const setParameters = later.lines[0].sender.setParameters;
  later.lines[0].sender.setParameters = (p) => (++tries < 3 ? Promise.reject(new Error('not yet')) : setParameters(p));
  for (let i = 0; i < 20; i++) {
    cams.sendCam(asPc(later), camTrack as never, 1);
    await Promise.resolve();
    await Promise.resolve();
  }
  assert.equal(tries, 3);
  assert.deepEqual(later.lines[0].sender.params.encodings[0], { ...cams.CAM_ENCODING, scaleResolutionDownBy: 1 });
});

test('a closed connection is left alone', () => {
  const pc = new FakePC();
  pc.signalingState = 'closed';
  cams.sendCam(asPc(pc), camTrack as never);
  assert.equal(pc.lines.length, 0);
  assert.equal(cams.theirCam(asPc(pc)), null);
});

test('Voice names its webcam line in its signals, and answers their webcam’s line open before it says so', async () => {
  const sent: { t: string; to?: string; data?: { description?: { sdp: string }; cam?: string } }[] = [];
  // Voice samples its levels on a timer of its own, which would keep the test from ending.
  const every = globalThis.setInterval;
  globalThis.setInterval = (() => 0) as never;
  const voice = new Voice({ send: (m: (typeof sent)[number]) => void sent.push(m) } as never);
  globalThis.setInterval = every;
  const pc = new FakePC();
  // (The fields the glare-proof Voice keeps too: what generation of connection it is, and its queue of signals.)
  voice.conns.set('them', { pc, polite: true, makingOffer: false, ignoreOffer: false, settingAnswer: false, gen: 0, failed: 0, queue: Promise.resolve() } as never);
  await voice.handleSignal('them', { description: { type: 'offer', sdp: JSON.stringify(['0']) }, cam: '0' } as never);
  const answer = sent.at(-1)!;
  assert.equal(answer.t, 'rtc');
  assert.equal(answer.data?.cam, '0', 'the answer names the line as ours too');
  assert.deepEqual(JSON.parse(answer.data!.description!.sdp), [['0', 'sendrecv']], 'answered open both ways');
  assert.equal(voice.remoteCamera('them'), pc.lines[0].receiver.track);
  // Turning ours on now is the same line: nothing to negotiate.
  voice.sendCamera('them', camTrack as never);
  assert.equal(pc.lines.length, 1);
  assert.equal(pc.lines[0].sender.track, camTrack);
  assert.equal(voice.remoteCamera('nobody'), null);
});

test('the office keeps whether a webcam is on, tells everyone once, and keeps nothing more', () => {
  const told: { t: string; peer: { webcam?: boolean } }[] = [];
  const ctx = { broadcast: (m: (typeof told)[number]) => void told.push(m) } as never;
  const c = { peer: { id: 'p1', name: 'Sam' } as { webcam?: boolean } } as never as { peer: { webcam?: boolean } };
  webcamHandlers.webcam(ctx, c as never, { t: 'webcam', on: true });
  assert.equal(c.peer.webcam, true);
  webcamHandlers.webcam(ctx, c as never, { t: 'webcam', on: true });
  assert.equal(told.length, 1, 'no news, nothing sent');
  webcamHandlers.webcam(ctx, c as never, { t: 'webcam', on: 'yes' as never });
  assert.equal('webcam' in c.peer, false, 'only a real true turns it on');
  assert.equal(told.length, 2);
  assert.equal(told[1].peer.webcam, undefined);
});
