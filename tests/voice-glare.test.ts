import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/shared/rng.js';
import { FakePC, FakeStream, FakeTrack, flows } from './support/rtc-fake.js';

// Two people changing the connection between them at the same moment (Voice, src/client/voice.ts): one
// starts a share while the other joins voice, and both tracks have to arrive whichever of them is the
// polite side. The browsers are stood in for (tests/support/rtc-fake.ts), what Chrome loses when an
// offer is rolled back included, and the office's socket is two lines the test carries signals along in
// order. tests/support/rtc-glare-browser.mjs is the same with two real browsers.

// The store keeps things in localStorage, and Voice asks the page for the mic and for something to play through.
const storage = new Map<string, string>();
const fake = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
fake('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, String(v)), removeItem: (k: string) => void storage.delete(k) });
fake('window', { isSecureContext: true, addEventListener() {} });
fake('navigator', { mediaDevices: { getUserMedia: async () => new FakeStream([new FakeTrack('audio')]) } });
fake('RTCPeerConnection', FakePC);
fake('MediaStream', FakeStream);
fake(
  'Audio',
  class {
    srcObject: unknown = null;
    volume = 1;
    play = () => Promise.resolve();
  },
);

const { Voice } = await import('../src/client/voice.js');
const { store } = await import('../src/client/state/index.js');
const cams = await import('../src/client/voice-camera.js');
type Voice = InstanceType<typeof Voice>;
type Msg = { t: string; to?: string; data?: { description?: { type: string }; gen?: number } };

const turns = async (n: number) => {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r));
};

/** The time as the webcam's line sees it (performance.now, in a test that stands it in): moved on by hand. */
let clock = 0;

/** What Voice warned of while `run` went on. */
async function warnings(run: () => Promise<void>): Promise<string[]> {
  const said: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void said.push(a.map(String).join(' '));
  try {
    await run();
  } finally {
    console.warn = warn;
  }
  return said;
}

/**
 * Two people, 'a' and 'b', with a connection between them that has negotiated nothing ('a' sorts first,
 * so it's the polite side). What each sends waits in its line until the test carries it across.
 */
function pair(seed: number) {
  const rand = mulberry32(seed);
  const ids = ['a', 'b'] as const;
  const lines: Msg[][] = [[], []];
  /** How many signals have been sent, by either side. */
  let signals = 0;
  // Voice samples its levels on a timer of its own, which would keep the test from ending.
  const every = globalThis.setInterval;
  globalThis.setInterval = (() => 0) as never;
  const send = (i: number) => (m: Msg) => {
    if (m.t === 'rtc') signals++;
    lines[i].push(m);
  };
  const voices = ids.map((_, i) => new Voice({ send: send(i) } as never));
  globalThis.setInterval = every;
  store.peers = new Map(ids.map((id) => [id, { id, name: id } as never]));
  for (const [i, id] of ids.entries()) {
    store.you = id;
    voices[i].syncPeers();
  }
  // Every step a browser takes is a few turns long, by the seed: the two sides fall in a different order each time.
  FakePC.pause = () => turns(Math.floor(rand() * 3));
  const conn = (i: number) => voices[i].conns.get(ids[1 - i])!;
  const pc = (i: number) => conn(i).pc as unknown as FakePC;

  /** Carries the next signal of side `i` across. Nobody waits for it to be applied, as on the page. */
  function carry(i: number) {
    const m = lines[i].shift()!;
    if (m.t === 'rtc') void voices[1 - i].handleSignal(ids[i], JSON.parse(JSON.stringify(m.data)));
  }

  /** Carries signals across, either side's next by the seed, until nothing more comes. */
  async function settle() {
    for (let quiet = 0; quiet < 30; ) {
      const waiting = [0, 1].filter((i) => lines[i].length);
      if (waiting.length) carry(waiting[Math.floor(rand() * waiting.length)]);
      quiet = waiting.length ? 0 : quiet + 1;
      await turns(1 + Math.floor(rand() * 2));
    }
  }

  /** Waits until each side's line has an offer in it: both have made their change, and neither has heard of the other's. */
  async function crossed() {
    const offered = (i: number) => lines[i].some((m) => m.data?.description?.type === 'offer');
    for (let n = 0; !(offered(0) && offered(1)); n++) {
      assert.ok(n < 200, 'both sides make an offer');
      await turns(1);
    }
  }

  return {
    ids,
    voices,
    lines,
    conn,
    pc,
    carry,
    settle,
    crossed,
    signals: () => signals,
    share: (i: number) => void voices[i].startShare(new FakeStream([new FakeTrack('video')]) as never),
    /**
     * Side `i` turns its webcam on, sent the way features/webcam sends it, on a connection that has had
     * time to settle (CAM_SETTLE, and CAM_DEFER for the polite side). Hands back the webcam's track.
     */
    cam(i: number) {
      const track = new FakeTrack('video');
      const send = (t: FakeTrack | null) => voices[i].sendCamera(ids[1 - i], t as never);
      send(null);
      clock += cams.CAM_SETTLE;
      send(track);
      clock += cams.CAM_DEFER;
      send(track);
      return track;
    },
    /**
     * `kind` from side `from` (its mic, or its share) is arriving: agreed on by both connections, and what
     * the far side's Voice plays for it is what comes in on the line it's sent on, not on another line.
     */
    arrives(from: number, kind: 'audio' | 'video') {
      const sender: unknown = kind === 'audio' ? conn(from).micSender : conn(from).screenSender;
      const mid = sender ? pc(from).getTransceivers().find((l) => l.sender === sender)?.mid : null;
      const line = mid ? pc(1 - from).getTransceivers().find((l) => l.mid === mid) : undefined;
      const there = conn(1 - from);
      const played: unknown = (kind === 'audio' ? there.audioStream : there.screen)?.getTracks()[0];
      return flows(pc(from), pc(1 - from), kind) && !!line && played === line.receiver.track;
    },
  };
}

/** Side `sharer` starts a share and the other joins voice, before either hears from the other. */
async function shareMeetsMic(seed: number, sharer: number) {
  const p = pair(seed);
  const joiner = 1 - sharer;
  p.share(sharer);
  assert.equal(await p.voices[joiner].joinVoice(), null);
  await p.crossed();
  await p.settle();
  return { ...p, joiner };
}

for (const sharer of [0, 1]) {
  const who = sharer === 0 ? 'the polite side shares and the other joins voice' : 'the polite side joins voice and the other shares';
  test(`a share and a mic added at the same moment both arrive, twenty times: ${who}`, async () => {
    FakePC.chrome = true;
    for (let seed = 1; seed <= 20; seed++) {
      let p!: Awaited<ReturnType<typeof shareMeetsMic>>;
      const warned = await warnings(async () => void (p = await shareMeetsMic(seed, sharer)));
      assert.ok(p.arrives(sharer, 'video'), `seed ${seed}: the share arrives`);
      assert.ok(p.arrives(p.joiner, 'audio'), `seed ${seed}: the voice arrives`);
      // And it got there the straight way: nothing was refused, and the connection wasn't started over.
      assert.deepEqual(warned, [], `seed ${seed}`);
      assert.deepEqual([p.conn(0).gen, p.conn(1).gen], [0, 0], `seed ${seed}`);
      // One line for each kind, open both ways on both sides: the next change has nothing to negotiate.
      for (const i of [0, 1]) assert.deepEqual(p.pc(i).getTransceivers().map((t) => `${t.kind} ${t.direction}`).sort(), ['audio sendrecv', 'video sendrecv'], `seed ${seed}`);
    }
  });
}

test('the same in a browser that rolls back as the specification has it', async () => {
  FakePC.chrome = false;
  for (const sharer of [0, 1]) {
    for (let seed = 1; seed <= 5; seed++) {
      const p = await shareMeetsMic(seed, sharer);
      assert.ok(p.arrives(sharer, 'video') && p.arrives(p.joiner, 'audio'), `seed ${seed}`);
    }
  }
  FakePC.chrome = true;
});

test('other changes made at the same moment: both join voice, both share, a share and a mic on a call', async () => {
  for (let seed = 1; seed <= 10; seed++) {
    // Both join: the polite side puts its mic on the line the other's offer brought.
    let p = pair(seed);
    await Promise.all(p.voices.map((v) => v.joinVoice()));
    await p.crossed();
    await p.settle();
    assert.ok(p.arrives(0, 'audio') && p.arrives(1, 'audio'), `seed ${seed}: both voices`);
    assert.deepEqual([p.conn(0).gen, p.conn(1).gen], [0, 0]);

    // Then both share, on the connection the call is on. Each needs a line for it, and the polite side's
    // offer gives way by the connection starting over: it doesn't roll back.
    p.share(0);
    p.share(1);
    await p.crossed();
    await p.settle();
    for (const i of [0, 1]) assert.ok(p.arrives(i, 'audio') && p.arrives(i, 'video'), `seed ${seed}: voice and share from side ${i}`);
    assert.deepEqual([p.conn(0).gen, p.conn(1).gen], [1, 1]);

    // One's in voice already; it shares as the other joins. The mic goes on the line that's there, so
    // only the share is negotiated, and nothing collides.
    for (const first of [0, 1]) {
      p = pair(seed);
      await p.voices[first].joinVoice();
      await p.settle();
      assert.ok(p.arrives(first, 'audio'));
      p.share(first);
      await p.voices[1 - first].joinVoice();
      await p.settle();
      assert.ok(p.arrives(first, 'audio') && p.arrives(first, 'video') && p.arrives(1 - first, 'audio'), `seed ${seed}: side ${first} was in voice`);
      assert.deepEqual([p.conn(0).gen, p.conn(1).gen], [0, 0]);
    }
  }
  assert.equal(FakePC.rolledBack, 0, 'no offer was ever rolled back');
});

test('a track goes on a line that is there, and comes off it, with nothing to negotiate', async () => {
  for (const first of [0, 1]) {
    const p = pair(21 + first);
    const other = 1 - first;
    // The first to send a kind makes the line for it; the other answers it open both ways.
    await p.voices[first].joinVoice();
    p.share(first);
    await p.settle();
    assert.ok(p.arrives(first, 'audio') && p.arrives(first, 'video'));
    assert.deepEqual(p.pc(other).getTransceivers().map((t) => [t.kind, t.direction]), [['audio', 'sendrecv'], ['video', 'sendrecv']]);

    // From here on nothing is signalled, whoever does what, and however much at once.
    const signals = p.signals();
    await p.voices[other].joinVoice();
    p.share(other);
    await p.settle();
    assert.ok(p.arrives(other, 'audio') && p.arrives(other, 'video'), 'the other side sends on the same lines');
    p.voices[first].stopShare();
    p.voices[other].leaveVoice();
    await p.settle();
    assert.equal(p.arrives(first, 'video'), false);
    assert.equal(p.arrives(other, 'audio'), false);
    assert.ok(p.arrives(first, 'audio') && p.arrives(other, 'video'), 'what was left alone still arrives');
    p.share(first);
    await p.voices[other].joinVoice();
    await p.settle();
    for (const i of [0, 1]) assert.ok(p.arrives(i, 'audio') && p.arrives(i, 'video'));
    assert.equal(p.signals(), signals);
    assert.deepEqual(p.pc(first).getTransceivers().map((t) => t.kind), ['audio', 'video'], 'and no line was added');
  }
});

test("an offer that comes while an answer is still being set isn't ignored", async () => {
  // The impolite side ('b') shares, and the polite side answers, then joins voice: its offer is right
  // behind its answer. 'b' takes its time over the answer, so the offer is there before it's stable again.
  const p = pair(7);
  FakePC.pause = () => turns(1);
  p.share(1);
  await turns(10);
  while (p.lines[1].length) p.carry(1);
  await turns(10);
  assert.equal(p.lines[0][0].data?.description?.type, 'answer');
  await p.voices[0].joinVoice();
  await turns(10);
  assert.equal(p.lines[0].at(-1)?.data?.description?.type, 'offer');
  FakePC.pause = (_pc, step) => turns(step === 'setRemoteDescription answer' ? 20 : 1);
  while (p.lines[0].length) p.carry(0);
  await turns(5);
  assert.equal(p.pc(1).signalingState, 'have-local-offer', 'the answer is still being set as the offer arrives');
  await p.settle();
  assert.equal(p.conn(1).ignoreOffer, false);
  assert.ok(p.arrives(1, 'video'), 'the share arrives');
  assert.ok(p.arrives(0, 'audio'), 'the voice arrives');
  assert.deepEqual([p.conn(0).gen, p.conn(1).gen], [0, 0]);
});

test('signals are applied one at a time, in the order they came', async () => {
  const p = pair(3);
  const steps: string[] = [];
  FakePC.pause = async (pc, step) => {
    if (pc !== p.pc(0)) return turns(1);
    steps.push(`${step} begins`);
    await turns(step.startsWith('setRemoteDescription') ? 6 : 2);
    steps.push(`${step} ends`);
  };
  p.share(1);
  await turns(10);
  // The offer and its candidates, all handed over in one go.
  assert.ok(p.lines[1].length >= 3);
  while (p.lines[1].length) p.carry(1);
  await p.settle();
  assert.deepEqual(steps.slice(0, 6), ['setRemoteDescription offer begins', 'setRemoteDescription offer ends', 'setLocalDescription begins', 'setLocalDescription ends', 'addIceCandidate begins', 'addIceCandidate ends']);
  assert.ok(p.arrives(1, 'video'));
});

for (const failing of [0, 1]) {
  test(`an offer the browser refuses starts the connection over on both sides, and everything arrives again: the ${failing === 0 ? 'polite' : 'impolite'} side's`, async () => {
    for (let seed = 1; seed <= 5; seed++) {
      const p = pair(seed);
      await Promise.all(p.voices.map((v) => v.joinVoice()));
      await p.settle();
      assert.ok(p.arrives(0, 'audio') && p.arrives(1, 'audio'));
      const before = [p.pc(0), p.pc(1)];

      // The share needs a line of its own, and the offer of it is refused.
      FakePC.refuse = 1;
      const warned = await warnings(async () => {
        p.share(failing);
        await p.settle();
      });
      assert.equal(warned.length, 1, `seed ${seed}: ${warned.join(' | ')}`);
      assert.match(warned[0], /rtc negotiation failed.*codec collision/);
      assert.deepEqual([p.conn(0).gen, p.conn(1).gen], [1, 1], 'started over once, both sides');
      assert.ok(p.pc(0) !== before[0] && p.pc(1) !== before[1]);
      assert.deepEqual(before.map((pc) => pc.signalingState), ['closed', 'closed']);
      for (const i of [0, 1]) assert.ok(p.arrives(i, 'audio'), `seed ${seed}: the voice of side ${i} is back`);
      assert.ok(p.arrives(failing, 'video'), `seed ${seed}: the share arrives`);
      assert.equal(p.conn(failing).failed, 0, 'and it counts from nothing again');
    }
  });
}

test("a browser that refuses every offer isn't started over for ever", async () => {
  const p = pair(11);
  FakePC.refuse = Infinity;
  const warned = await warnings(async () => {
    await p.voices[0].joinVoice();
    await p.settle();
  });
  FakePC.refuse = 0;
  assert.ok(warned.length >= 3 && warned.length <= 8, `${warned.length} warnings`);
  assert.ok(p.conn(0).gen >= 3 && p.conn(0).gen <= 6, `started over ${p.conn(0).gen} times`);
  assert.equal(p.conn(0).gen, p.conn(1).gen);
  assert.equal(p.arrives(0, 'audio'), false);
});

test('a signal for a connection that has since been started over is dropped', async () => {
  const p = pair(5);
  await p.voices[1].joinVoice();
  await p.settle();
  assert.ok(p.arrives(1, 'audio'));
  // 'b' starts a share, and its offer of a line for it is on its way when 'a' starts the connection over
  // (a share of its own, whose offer is refused).
  p.share(1);
  await turns(10);
  const late = p.lines[1].find((m) => m.data?.description);
  assert.equal(late?.data?.description?.type, 'offer');
  assert.equal(late?.data?.gen, 0);
  FakePC.refuse = 1;
  const warned = await warnings(async () => {
    p.share(0);
    await turns(10);
    assert.equal(p.conn(0).gen, 1);
    const fresh = p.pc(0);
    // The late offer is for the connection that's gone: the new one isn't touched by it.
    while (p.lines[1][0] !== late) p.carry(1);
    p.carry(1);
    await turns(10);
    assert.equal(p.pc(0), fresh);
    assert.equal(fresh.currentRemoteDescription, null);
    await p.settle();
  });
  assert.equal(warned.length, 1, warned.join(' | '));
  assert.deepEqual([p.conn(0).gen, p.conn(1).gen], [1, 1]);
  assert.ok(p.arrives(0, 'video'), "a's share");
  assert.ok(p.arrives(1, 'audio') && p.arrives(1, 'video'), "b's voice and share");
});

/** The line side `i` sends `track` on, if it's on one. */
const lineOf = (p: ReturnType<typeof pair>, i: number, track: unknown) => p.pc(i).getTransceivers().find((t) => t.sender.track === track);

for (const camSide of [0, 1]) {
  test(`a share never goes on a webcam's line, ours or theirs: the ${camSide === 0 ? 'polite' : 'impolite'} side's webcam is on`, async (t) => {
    t.mock.method(performance, 'now', () => clock);
    const other = 1 - camSide;
    for (const [sharer, when] of [[camSide, 'at once'], [camSide, 'after'], [other, 'after']] as const) {
      for (let seed = 1; seed <= 5; seed++) {
        const at = `seed ${seed}, side ${sharer} shares ${when}`;
        const p = pair(seed);
        let cam!: FakeTrack;
        const warned = await warnings(async () => {
          cam = p.cam(camSide);
          // Before its line has been offered, or once both sides have agreed on it.
          if (when === 'after') await p.settle();
          p.share(sharer);
          await p.settle();
        });
        const mid = lineOf(p, camSide, cam)?.mid;
        assert.ok(mid, `${at}: the webcam has its line`);
        // Both sides take it for a webcam's: ours on the one side, theirs on the other.
        for (const i of [0, 1]) assert.ok(cams.isCamLine(p.conn(i).pc, p.pc(i).getTransceivers().find((l) => l.mid === mid) as never), `${at}: side ${i}`);
        const screen = p.voices[sharer].localScreen!.getVideoTracks()[0];
        const shared = lineOf(p, sharer, screen);
        assert.ok(shared?.mid && shared.mid !== mid, `${at}: the share is on a line of its own`);
        assert.equal(lineOf(p, camSide, cam)?.mid, mid, `${at}: and the webcam still on its own`);
        assert.ok(p.arrives(sharer, 'video'), `${at}: the share arrives as a share`);
        assert.ok(p.voices[other].remoteCamera(p.ids[camSide]), `${at}: the webcam arrives as a webcam`);
        assert.deepEqual(warned, [], at);
        assert.deepEqual([p.conn(0).gen, p.conn(1).gen], [0, 0], at);
      }
    }
  });
}

test("nor on their webcam's line while their offer of it is still being answered, where addTrack would take it", async (t) => {
  t.mock.method(performance, 'now', () => clock);
  for (const camSide of [0, 1]) {
    for (let seed = 1; seed <= 5; seed++) {
      const at = `seed ${seed}, side ${camSide}'s webcam`;
      const p = pair(seed);
      const other = 1 - camSide;
      const cam = p.cam(camSide);
      await turns(10);
      assert.equal(p.lines[camSide][0]?.data?.description?.type, 'offer', at);
      // The other side takes its time over the answer, and starts a share while it's at it: their line
      // is open its way by then, and nothing of its own has gone out on it yet.
      FakePC.pause = (pc, step) => turns(pc === p.pc(other) && step === 'setLocalDescription' ? 20 : 1);
      while (p.lines[camSide].length) p.carry(camSide);
      for (let n = 0; p.pc(other).signalingState !== 'have-remote-offer'; n++) {
        assert.ok(n < 100, `${at}: the offer is in`);
        await turns(1);
      }
      await turns(1);
      const mid = lineOf(p, camSide, cam)!.mid;
      const theirs = p.pc(other).getTransceivers().find((l) => l.mid === mid)!;
      assert.equal(theirs.direction, 'sendrecv', at);
      assert.ok(cams.isCamLine(p.conn(other).pc, theirs as never), at);
      p.share(other);
      FakePC.pause = () => turns(1);
      await p.settle();
      const shared = lineOf(p, other, p.voices[other].localScreen!.getVideoTracks()[0]);
      assert.ok(shared !== theirs && shared?.mid && shared.mid !== mid, `${at}: the share is on a line of its own`);
      assert.equal(theirs.sender.track, null, `${at}: nothing of theirs on the webcam's line`);
      assert.ok(p.arrives(other, 'video'), `${at}: the share arrives as a share`);
      assert.ok(p.voices[other].remoteCamera(p.ids[camSide]), `${at}: the webcam arrives as a webcam`);
      assert.deepEqual([p.conn(0).gen, p.conn(1).gen], [0, 0], at);
    }
  }
});

test("with a webcam's line agreed, a mic or a share added as an offer of a line for one comes in goes on that line: one line, heard both ways", async (t) => {
  t.mock.method(performance, 'now', () => clock);
  for (const kind of ['audio', 'video'] as const) {
    for (const camSide of [0, 1]) {
      for (const first of [0, 1]) {
        const at = `${kind === 'audio' ? 'voice' : 'a share'}, side ${camSide}'s webcam on, side ${first} first`;
        const p = pair(7);
        const second = 1 - first;
        const add = async (i: number) => void (kind === 'audio' ? await p.voices[i].joinVoice() : p.share(i));
        p.cam(camSide);
        await p.settle();
        // The first joins voice (or shares), and its offer of a line for it is on its way across.
        await add(first);
        const offer = () => p.lines[first].findIndex((m) => m.data?.description?.type === 'offer');
        for (let n = 0; offer() < 0; n++) {
          assert.ok(n < 100, `${at}: the first makes an offer`);
          await turns(1);
        }
        while (offer() > 0) p.carry(first);
        // The second does the same, and the offer comes in before the second has offered a line of its
        // own: its track goes on the line the offer brings, rather than a second line beside it that the
        // first answers open, sends nothing on, and the second then plays instead.
        const warned = await warnings(async () => {
          await add(second);
          p.carry(first);
          await p.settle();
        });
        const lines = (i: number) => p.pc(i).getTransceivers().filter((l) => l.kind === kind && !cams.isCamLine(p.conn(i).pc, l as never));
        for (const i of [0, 1]) assert.equal(lines(i).length, 1, `${at}: one line for it on side ${i}`);
        for (const i of [0, 1]) assert.ok(p.arrives(i, kind), `${at}: side ${i}'s arrives`);
        assert.deepEqual(warned, [], at);
        assert.deepEqual([p.conn(0).gen, p.conn(1).gen], [0, 0], at);
      }
    }
  }
});

test('no offer is rolled back, in any of the above', () => {
  assert.equal(FakePC.rolledBack, 0);
});
