// Two browsers changing the one RTCPeerConnection between them at the same moment (src/client/voice.ts).
// The case that used to lose a track: one starts a screen share (Voice.startShare) while the other joins
// voice (Voice.joinVoice), on a connection that has negotiated nothing yet. Both tracks must arrive,
// every time, whichever of the two is the polite side. The other scenes are the same moment with other
// changes in it, the webcam's own line among them (src/client/voice-camera.ts), and an offer that's
// made to fail, which the connection has to get over by itself.
//
//   node tests/support/rtc-glare-browser.mjs            20 rounds each way (5 of each other scene)
//   RTC_ROUNDS=5 RTC_VERBOSE=1 node tests/support/…     fewer, and say what each round did
//   RTC_SCENE='offer fails' node tests/support/…         only the scenes with that in their name
//   RTC_SCENE=webcam node tests/support/…                only the webcam's
//
// It needs no office running: it serves the page's own modules with Vite, and stands in for the
// office's socket itself (signals go from one browser to the other in order, a few ms late, as the
// socket would carry them). The mic is Chrome's fake one, the share and the webcam canvases.
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const ROUNDS = Number(process.env.RTC_ROUNDS ?? 20);
const FEW = Math.max(1, Math.round(ROUNDS / 4));
const VERBOSE = !!process.env.RTC_VERBOSE;
/** How long a round's tracks are given to arrive, in ms. */
const PATIENCE = Number(process.env.RTC_PATIENCE ?? 10_000);
/** One way across the stand-in socket, in ms: a round takes the next of these, so the signals cross in different orders. */
const LAGS = [0, 1, 3, 6, 12, 25, 50];

/**
 * What the two sides do, X and Y (each scene runs with X the polite side, then with Y). A scene is its
 * steps in turn: what X and what Y do in the same moment, then what has to be arriving at X and at Y
 * from the other ('!' for what must have stopped) before the next. A fifth entry is how many times the
 * connection has been started over by then, where the step is one that takes that (Voice.startOver);
 * everywhere else it must not have been, and nothing may have been warned of unless the scene `warns`.
 * In a `loose` scene the signals aren't held back until both have made their change, so they cross
 * however the mic's opening and the lag have them.
 */
const SCENES = [
  { name: 'a share meets a mic, nothing negotiated', rounds: ROUNDS, steps: [['share', 'mic', 'audio', 'video']] },
  { name: 'a share meets a mic, signals crossing as they come', rounds: FEW * 2, loose: true, steps: [['share', 'mic', 'audio', 'video']] },
  { name: 'both join voice at once', rounds: FEW, steps: [['mic', 'mic', 'audio', 'audio']] },
  { name: 'both share at once', rounds: FEW, steps: [['share', 'share', 'video', 'video']] },
  { name: 'one in voice shares as the other joins', rounds: FEW, steps: [['mic', '', '', 'audio'], ['share', 'mic', 'audio', 'audio video']] },
  {
    name: 'a share stops as a mic leaves, then both are back at once',
    rounds: FEW,
    steps: [['share', 'mic', 'audio', 'video'], ['stopShare', 'leave', '!audio', '!video'], ['share', 'mic', 'audio', 'video']],
  },
  {
    // Both need a line for video at once, on a connection that's carrying the call: the one collision left that starts it over.
    name: 'on a call, both share, both stop and both share again, then both leave and join again, each at once',
    rounds: FEW,
    steps: [
      ['mic', 'mic', 'audio', 'audio'],
      ['share', 'share', 'audio video', 'audio video', 1],
      ['stopShare', 'stopShare', 'audio !video', 'audio !video'],
      ['share', 'share', 'audio video', 'audio video'],
      ['leave', 'leave', '!audio video', '!audio video'],
      ['mic', 'mic', 'audio video', 'audio video'],
    ],
  },
  // The webcam (features/webcam): its own line, made by whichever side turns one on first, then replaceTrack.
  { name: 'webcam: one turns theirs on as the other shares', rounds: FEW, steps: [['warm', 'warm', '', ''], ['cam', 'share', 'video', 'cam']] },
  { name: 'webcam: both turn theirs on at once', rounds: FEW, steps: [['warm', 'warm', '', ''], ['cam', 'cam', 'cam', 'cam']] },
  { name: 'webcam: both at once, on a call', rounds: FEW, steps: [['mic', 'mic', 'audio', 'audio'], ['warm', 'warm', 'audio', 'audio'], ['cam', 'cam', 'audio cam', 'audio cam']] },
  { name: 'webcam: a share and a webcam from one side, as the other joins voice', rounds: FEW, steps: [['warm', 'warm', '', ''], ['camShare', 'mic', 'audio', 'cam video']] },
  { name: 'webcam: off and on again, and on beside a share', rounds: FEW, steps: [['warm', 'warm', '', ''], ['cam', '', '', 'cam'], ['camOff', 'share', 'video', '!cam'], ['cam', '', 'video', 'cam']] },
  { name: 'on a call, an offer fails', rounds: FEW, warns: true, steps: [['mic', 'mic', 'audio', 'audio'], ['failingShare', '', 'audio', 'audio video', 1]] },
];

// A cache of its own: a worktree's node_modules is often the main checkout's, and its dev server's
// optimized dependencies are in there, which a Vite with another root would otherwise clear out.
const cacheDir = path.join(os.tmpdir(), 'agent-office-rtc-glare-vite');
const vite = await createServer({ logLevel: 'error', cacheDir, server: { port: 0, host: '127.0.0.1', proxy: {} }, optimizeDeps: { noDiscovery: true } });
await vite.listen();
const port = vite.httpServer.address().port;
const launch = () =>
  chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
const browsers = await Promise.all([launch(), launch()]);

/** The page's side: a Voice of its own, with the store saying who it is and who else is there. */
async function rig() {
  const { Voice } = await import('/voice.ts');
  const { store } = await import('/state/index.ts');
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const paint = canvas.getContext('2d');
  // A picture that changes, so there are frames to send.
  setInterval(() => {
    paint.fillStyle = `hsl(${(performance.now() / 10) % 360} 80% 50%)`;
    paint.fillRect(0, 0, 320, 180);
  }, 50);
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => (warnings.push(a.map(String).join(' ')), warn(...a));
  const voice = new Voice({ send: (m) => window.relay(m) });
  let peer = '';
  /** How much of each track had come in, the last time `seen` looked. */
  const counted = new Map();
  const share = () => voice.startShare(canvas.captureStream(15));
  // A webcam: another canvas, sent the way features/webcam does, again every 200 ms.
  const camCanvas = document.createElement('canvas');
  camCanvas.width = camCanvas.height = 240;
  const camPaint = camCanvas.getContext('2d');
  setInterval(() => {
    camPaint.fillStyle = `hsl(${(performance.now() / 7) % 360} 70% 40%)`;
    camPaint.fillRect(0, 0, 240, 240);
  }, 50);
  let camTrack = null;
  let camTick = 0;
  const camSend = () => voice.sendCamera(peer, camTrack);
  const camLoop = () => {
    clearInterval(camTick);
    camTick = setInterval(camSend, 200);
    camSend();
  };
  window.rig = {
    /** A new connection between `you` and `them`, with nothing sent on it yet. */
    meet(you, them) {
      clearInterval(camTick);
      camTrack?.stop();
      camTrack = null;
      voice.stopShare();
      voice.leaveVoice();
      voice.reset();
      warnings.length = 0;
      peer = them;
      store.you = you;
      store.peers = new Map([you, them].map((id) => [id, { id, name: id }]));
      voice.syncPeers();
    },
    mic: () => voice.joinVoice(),
    /** The webcam's tick running with nothing to send, long enough for the connection to have settled (CAM_SETTLE). */
    async warm() {
      camLoop();
      await new Promise((r) => setTimeout(r, 1700));
    },
    cam() {
      camTrack = camCanvas.captureStream(15).getVideoTracks()[0];
      camLoop();
    },
    camOff() {
      camTrack?.stop();
      camTrack = null;
      camSend();
    },
    async camShare() {
      this.cam();
      return share();
    },
    leave: () => voice.leaveVoice(),
    share,
    stopShare: () => voice.stopShare(),
    /** A share whose offer the browser refuses, once, as Chrome did the one after a rollback. */
    failingShare() {
      const real = RTCPeerConnection.prototype.setLocalDescription;
      RTCPeerConnection.prototype.setLocalDescription = function (...args) {
        if (args.length || this.signalingState !== 'stable') return real.apply(this, args);
        RTCPeerConnection.prototype.setLocalDescription = real;
        return Promise.reject(new DOMException('Failed to set local offer sdp: made to fail', 'InvalidAccessError'));
      };
      return share();
    },
    signal: (from, data) => void voice.handleSignal(from, data),
    says: (from, m) => Object.assign(store.peers.get(from) ?? {}, { voice: m.voice, sharing: m.sharing }),
    /** What's arriving from the other side as this is asked, and what the connection looks like. */
    async seen() {
      const c = voice.conns.get(peer);
      if (!c) return { audio: false, video: false, gen: -1, state: 'no connection', warnings };
      // Arriving: the track Voice has for it is live, and more of it has come in since the last look
      // (frames it could show, for a share).
      const arriving = async (stream) => {
        const track = stream?.getTracks().find((t) => t.readyState === 'live');
        const receiver = track && c.pc.getReceivers().find((r) => r.track === track);
        if (!receiver) return false;
        let got = 0;
        for (const r of (await receiver.getStats()).values()) if (r.type === 'inbound-rtp') got += (track.kind === 'video' ? r.framesDecoded : r.packetsReceived) ?? 0;
        const before = counted.get(track.id) ?? Infinity;
        counted.set(track.id, got);
        return got > before;
      };
      // Each line of the connection: which way it goes, and how much has been sent and received on it.
      const lines = [];
      for (const t of c.pc.getTransceivers()) {
        const count = async (part, type, field) => [...(await part.getStats()).values()].filter((r) => r.type === type).reduce((n, r) => n + (r[field] ?? 0), 0);
        lines.push(`${t.mid}:${t.receiver.track.kind} ${t.direction}>${t.currentDirection} sent ${await count(t.sender, 'outbound-rtp', 'packetsSent')} got ${await count(t.receiver, 'inbound-rtp', 'packetsReceived')}`);
      }
      return {
        audio: await arriving(c.audioStream),
        video: await arriving(voice.remoteScreens().get(peer)),
        cam: await arriving(voice.remoteCamera(peer) && new MediaStream([voice.remoteCamera(peer)])),
        gen: c.gen ?? 0,
        settled: c.pc.signalingState === 'stable',
        state: `${c.pc.signalingState}/${c.pc.connectionState}, started over ${c.gen ?? 0}×; ${lines.join('; ') || 'no lines'}`,
        warnings,
      };
    },
  };
}

const pages = await Promise.all(browsers.map((b) => b.newPage()));
/** Who each page is this round. */
let names = ['', ''];
/** The stand-in socket: what each page sends reaches the other in the order it was sent, `lag` ms later (once `held` lets go). */
let lag = 0;
let held = Promise.resolve();
const lines = pages.map(() => Promise.resolve());
for (const [i, page] of pages.entries()) {
  const other = pages[1 - i];
  await page.exposeFunction('relay', (m) => {
    const due = Date.now() + lag;
    const hold = held;
    const from = names[i];
    lines[i] = lines[i].then(async () => {
      await hold;
      await new Promise((r) => setTimeout(r, Math.max(0, due - Date.now())));
      // Sent in a round that's over: the connection it was for is gone.
      if (from !== names[i]) return;
      if (m.t === 'rtc') await other.evaluate(([who, data]) => window.rig.signal(who, data), [from, m.data]);
      else if (m.t === 'voice') await other.evaluate(([who, msg]) => window.rig.says(who, msg), [from, m]);
    });
  });
  page.on('pageerror', (err) => console.error(`page ${i}:`, err.message));
  await page.goto(`http://127.0.0.1:${port}/claim.html`);
  await page.evaluate(rig);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const act = (page, what) => (what ? page.evaluate((w) => window.rig[w](), what) : Promise.resolve(null));
const seen = () => Promise.all(pages.map((p) => p.evaluate(() => window.rig.seen())));
const has = (s, wants) => wants.split(' ').every((want) => !want || (want[0] === '!' ? !s[want.slice(1)] && s.settled : s[want]));

/**
 * Waits for what each side wants from the other, and says how long it took (null if it never came).
 * Arriving is more coming in at every look for half a second: a track that starts and stops again hasn't.
 */
async function arrives(wants) {
  const start = Date.now();
  let s;
  let took = 0;
  for (let held = 0; held < 5 && Date.now() - start < PATIENCE; ) {
    await sleep(100);
    s = await seen();
    held = has(s[0], wants[0]) && has(s[1], wants[1]) ? held + 1 : 0;
    if (held === 1) took = Date.now() - start;
    if (held === 5) return { s, took };
  }
  return { s, took: null };
}

/** One round of a scene: page `x` is X, and X is the polite side if `politeX`. */
async function round(scene, n, x, politeX) {
  const y = 1 - x;
  const side = [x, y];
  // The polite side of a connection is the one whose id sorts first (see Voice.connect).
  names = [];
  names[x] = politeX ? `a${n}` : `b${n}`;
  names[y] = politeX ? `b${n}` : `a${n}`;
  lag = LAGS[n % LAGS.length];
  held = Promise.resolve();
  await Promise.all(pages.map((p, i) => p.evaluate(([you, them]) => window.rig.meet(you, them), [names[i], names[1 - i]])));
  const fail = (why, s) => {
    console.log(`FAIL ${scene.name}, round ${n} (X is ${politeX ? 'polite' : 'impolite'}, ${lag} ms each way): ${why}`);
    for (const [k, i] of side.entries()) {
      console.log(`     ${'XY'[k]} ${names[i]}: ${s[i].state}`);
      for (const w of s[i].warnings) console.log(`     ${'XY'[k]} ${names[i]} warned: ${w}`);
    }
    return false;
  };
  /** How many times the connection has been started over, as far as the scene has it. */
  let over = 0;
  for (const [at, [doX, doY, wantX, wantY, startedOver]] of scene.steps.entries()) {
    // Nothing crosses until both have made their change: that's the same moment, whatever the mic takes to open.
    let go = () => {};
    if (!scene.loose) held = new Promise((r) => (go = r));
    const errs = await Promise.all([act(pages[x], doX), act(pages[y], doY)]);
    go();
    if (errs.some(Boolean)) throw new Error(`could not start: ${errs.filter(Boolean).join('; ')}`);
    // Started over, the connection is a new one: wait for that, so what was arriving on the old one doesn't count.
    if (startedOver) {
      over = startedOver;
      const start = Date.now();
      while ((await seen()).some((s) => s.gen < over)) {
        if (Date.now() - start > PATIENCE) return fail(`step ${at + 1}: the connection was never started over`, await seen());
        await sleep(20);
      }
    }
    const wants = [];
    wants[x] = wantX;
    wants[y] = wantY;
    const { s, took } = await arrives(wants);
    const got = (i) => ['audio', 'video', 'cam'].filter((kind) => s[i][kind]).join(' and ') || 'nothing';
    if (took === null) return fail(`step ${at + 1}: X has ${got(x)} arriving (wants ${wantX || 'nothing'}), Y has ${got(y)} (wants ${wantY || 'nothing'})`, s);
    if (s.some((p) => p.gen !== over)) return fail(`step ${at + 1}: it arrived, but the connection was started over to get there`, s);
    if (!scene.warns && s.some((p) => p.warnings.length)) return fail(`step ${at + 1}: it arrived, but only after something went wrong`, s);
    if (VERBOSE && at === scene.steps.length - 1) console.log(`ok   ${scene.name}, round ${n} (X is ${politeX ? 'polite' : 'impolite'}, ${lag} ms each way): ${took} ms`);
  }
  return true;
}

let failed = 0;
let total = 0;
try {
  for (const scene of SCENES) {
    if (!scene.name.includes(process.env.RTC_SCENE ?? '')) continue;
    let ok = 0;
    for (const politeX of [true, false]) {
      // Which browser is X swaps each round too, so neither is always the one that asked for the mic.
      for (let n = 0; n < scene.rounds; n++) if (await round(scene, n, n % 2, politeX)) ok++;
    }
    total += scene.rounds * 2;
    failed += scene.rounds * 2 - ok;
    console.log(`${ok === scene.rounds * 2 ? 'ok  ' : 'FAIL'} ${scene.name}: ${ok} of ${scene.rounds * 2} rounds, ${scene.rounds} each way`);
  }
} finally {
  await Promise.all(browsers.map((b) => b.close()));
  await vite.close();
}
if (failed) {
  console.log(`FAIL ${failed} of ${total} rounds lost a track`);
  process.exit(1);
}
console.log(`PASS ${total} rounds: every track arrived every time, with either side polite`);
