// A stand-in RTCPeerConnection for tests/voice-glare.test.ts: as much of the offer/answer state machine
// as "perfect negotiation" leans on, with nothing sent anywhere. It keeps to the specification where the
// negotiation can tell the difference:
//
// - setLocalDescription() makes an offer or an answer by the state it's in, and setRemoteDescription()
//   of an offer rolls back an offer of our own first;
// - a track added with addTrack goes on a line of the other side's offer of the same kind, if there's
//   one free, and on a line of our own in our next offer otherwise; a line of theirs is ours to receive
//   on until its direction is opened, and replaceTrack changes what a line carries with nothing to agree;
// - "negotiationneeded" fires once, when the connection is stable and nothing is being applied, and not
//   again until a negotiation has gone through (so an offer that failed is not tried again by itself);
// - an answer only fits the offer it was made for, a later offer has to keep the lines agreed so far,
//   and a candidate only fits the connection whose description we hold;
// - closed, it settles nothing that was still being applied.
//
// And what is Chrome's own (`FakePC.chrome`, as measured in Chrome 154), both to do with rolling back:
// the ids it picked for a kind in an offer made before anything was agreed stay picked after that offer
// is rolled back, so if the other side's offer didn't have that kind, every later offer of ours that
// adds it is refused; and on a connection that had agreed on something, what it was sending stops.

export type Kind = 'audio' | 'video';
interface Line {
  mid: string;
  kind: Kind;
  /** Whoever wrote the description sends on this line. */
  sends: boolean;
}
interface Sdp {
  /** The connection that wrote it, and which of its descriptions this is. */
  pc: number;
  n: number;
  lines: Line[];
  /** An answer: the offer it answers. */
  to?: [pc: number, n: number];
}
export interface Desc {
  type: 'offer' | 'answer';
  sdp: string;
  toJSON(): { type: 'offer' | 'answer'; sdp: string };
}

let made = 0;
const parse = (d: { sdp: string }) => JSON.parse(d.sdp) as Sdp;
const describe = (type: Desc['type'], sdp: Sdp): Desc => {
  const d = { type, sdp: JSON.stringify(sdp), toJSON: () => ({ type: d.type, sdp: d.sdp }) };
  return d;
};
const error = (name: string, message: string) => Object.assign(new Error(message), { name });
const turn = () => new Promise<void>((r) => setImmediate(r));

export class FakeTrack {
  readonly id = `track-${++made}`;
  readyState: 'live' | 'ended' = 'live';
  enabled = true;
  contentHint = '';
  constructor(readonly kind: Kind) {}
  addEventListener() {}
  stop() {
    this.readyState = 'ended';
  }
}

export class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks = () => this.tracks;
  getAudioTracks = () => this.tracks.filter((t) => t.kind === 'audio');
  getVideoTracks = () => this.tracks.filter((t) => t.kind === 'video');
}

class Transceiver {
  mid: string | null = null;
  /** Its mid is from an offer of ours that hasn't been answered: a rollback takes it away again. */
  provisional = false;
  /** It has been open our way, so addTrack won't take it for another track. */
  sent = false;
  /** The other side sends on it, and `ontrack` has said so. */
  receiving = false;
  /** A rollback stopped what it was sending (Chrome): nothing goes out until its track is put on again. */
  dead = false;
  readonly sender: { track: FakeTrack | null; replaceTrack(track: FakeTrack | null): Promise<void> };
  readonly receiver: { track: { kind: Kind } };
  private way: 'sendrecv' | 'recvonly';
  constructor(
    readonly kind: Kind,
    track: FakeTrack | null,
    /** Made by addTrack, not by an offer of theirs. */
    readonly added: boolean,
    private readonly changed: () => void,
  ) {
    this.way = added ? 'sendrecv' : 'recvonly';
    this.receiver = { track: { kind } };
    const sender = {
      track,
      replaceTrack: (now: FakeTrack | null) => {
        sender.track = now;
        this.dead = false;
        return Promise.resolve();
      },
    };
    this.sender = sender;
  }
  get direction() {
    return this.way;
  }
  set direction(way: 'sendrecv' | 'recvonly') {
    if (way === this.way) return;
    this.way = way;
    this.changed();
  }
}

export class FakePC {
  /** What Chrome loses to a rollback (see the top of the file). */
  static chrome = true;
  /** How long each step takes to apply. A test makes it a few turns of its own choosing. */
  static pause: (pc: FakePC, step: string) => Promise<void> = () => Promise.resolve();
  /** How many of the next offers are refused, whoever makes them. */
  static refuse = 0;
  /** How many offers have been rolled back, by anyone. */
  static rolledBack = 0;

  readonly id = ++made;
  signalingState: 'stable' | 'have-local-offer' | 'have-remote-offer' | 'closed' = 'stable';
  iceConnectionState = 'new';
  localDescription: Desc | null = null;
  currentLocalDescription: Desc | null = null;
  currentRemoteDescription: Desc | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((e: { candidate: { toJSON(): object } | null }) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ontrack: ((e: { track: FakeTrack; streams: FakeStream[] }) => void) | null = null;

  private pendingRemote: Desc | null = null;
  private readonly transceivers: Transceiver[] = [];
  /** The mids both sides have agreed on, in the order of their lines. */
  private agreed: string[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private applying = 0;
  private described = 0;
  /** "negotiationneeded" has fired, and no negotiation has gone through since. */
  private asked = false;
  private gathered = false;
  /** Kinds it made an offer for before anything was agreed, and those it can no longer add in an offer. */
  private readonly picked = new Set<Kind>();
  private readonly spoiled = new Set<Kind>();

  addTrack(track: FakeTrack) {
    if (this.signalingState === 'closed') throw error('InvalidStateError', 'The RTCPeerConnection is closed.');
    if (this.transceivers.some((t) => t.sender.track === track)) throw error('InvalidAccessError', 'A sender already exists for the track.');
    let t = this.transceivers.find((x) => x.kind === track.kind && !x.sender.track && !x.sent);
    if (t) {
      t.sender.track = track;
      t.direction = 'sendrecv';
    } else this.transceivers.push((t = this.line(track.kind, track, true)));
    this.need();
    return t.sender;
  }

  getTransceivers() {
    return [...this.transceivers];
  }

  setLocalDescription(): Promise<void> {
    return this.apply('setLocalDescription', () => (this.signalingState === 'have-remote-offer' ? this.answer() : this.offer()));
  }

  setRemoteDescription(desc: { type: string; sdp: string }): Promise<void> {
    return this.apply(`setRemoteDescription ${desc.type}`, () => {
      const sdp = parse(desc);
      const theirs = describe(desc.type as Desc['type'], sdp);
      if (desc.type === 'answer') {
        if (this.signalingState !== 'have-local-offer') throw error('InvalidStateError', `Failed to set remote answer sdp: Called in wrong state: ${this.signalingState}`);
        const mine = parse(this.localDescription!);
        if (sdp.to?.[0] !== mine.pc || sdp.to[1] !== mine.n) throw error('InvalidAccessError', 'Failed to set remote answer sdp: it answers another offer');
        this.receive(sdp.lines);
        return this.settle(this.localDescription!, theirs);
      }
      if (this.signalingState === 'have-local-offer') this.rollback();
      else if (this.signalingState !== 'stable') throw error('InvalidStateError', `Failed to set remote offer sdp: Called in wrong state: ${this.signalingState}`);
      if (this.agreed.some((mid, i) => sdp.lines[i]?.mid !== mid)) throw error('InvalidAccessError', "Failed to set remote offer sdp: The order of m-lines in subsequent offer doesn't match order from previous offer/answer.");
      if (FakePC.chrome && !this.currentRemoteDescription) for (const kind of this.picked) if (!sdp.lines.some((l) => l.kind === kind)) this.spoiled.add(kind);
      for (const l of sdp.lines) {
        if (this.at(l.mid)) continue;
        const ours = this.transceivers.find((t) => t.mid === null && t.added && t.kind === l.kind);
        if (ours) ours.mid = l.mid;
        else this.transceivers.push(Object.assign(this.line(l.kind, null, false), { mid: l.mid }));
      }
      this.receive(sdp.lines);
      this.pendingRemote = theirs;
      this.signalingState = 'have-remote-offer';
    });
  }

  addIceCandidate(candidate?: { candidate?: string }): Promise<void> {
    return this.apply('addIceCandidate', () => {
      const theirs = this.pendingRemote ?? this.currentRemoteDescription;
      if (!theirs) throw error('InvalidStateError', 'The remote description was null');
      if (candidate?.candidate && candidate.candidate !== `candidate of ${parse(theirs).pc}`) throw error('OperationError', 'Error processing ICE candidate');
    });
  }

  restartIce() {}

  close() {
    this.signalingState = 'closed';
  }

  /** One step, in its turn after the ones before it. */
  private apply(step: string, run: () => void): Promise<void> {
    if (this.signalingState === 'closed') return Promise.reject(error('InvalidStateError', 'The RTCPeerConnection is closed.'));
    this.applying++;
    const done = this.chain
      .then(() => FakePC.pause(this, step))
      // Closed meanwhile: nothing more is heard of it.
      .then(() => (this.signalingState === 'closed' ? new Promise<void>(() => {}) : run()));
    this.chain = done.catch(() => {});
    return done.finally(() => {
      if (--this.applying === 0) this.need();
    });
  }

  private at(mid: string) {
    return this.transceivers.find((t) => t.mid === mid);
  }

  private line(kind: Kind, track: FakeTrack | null, added: boolean) {
    return new Transceiver(kind, track, added, () => this.need());
  }

  private offer() {
    const added = this.transceivers.filter((t) => t.mid === null);
    const refused = FakePC.refuse > 0 && FakePC.refuse--;
    if (refused || (FakePC.chrome && added.some((t) => this.spoiled.has(t.kind)))) {
      throw error('InvalidAccessError', "Failed to execute 'setLocalDescription' on 'RTCPeerConnection': Failed to set local offer sdp: A BUNDLE group contains a codec collision for header extension id=1. The id must be the same across all bundled media descriptions");
    }
    for (const t of added) {
      let n = 0;
      while (this.at(String(n))) n++;
      t.mid = String(n);
      t.provisional = true;
      if (!this.currentRemoteDescription) this.picked.add(t.kind);
    }
    const mids = [...this.agreed, ...added.map((t) => t.mid!)];
    this.localDescription = describe('offer', { pc: this.id, n: ++this.described, lines: mids.map((mid) => this.says(mid)) });
    this.signalingState = 'have-local-offer';
    this.gather();
  }

  private answer() {
    const offer = parse(this.pendingRemote!);
    const mine = describe('answer', { pc: this.id, n: ++this.described, lines: offer.lines.map((l) => this.says(l.mid)), to: [offer.pc, offer.n] });
    this.settle(mine, this.pendingRemote!);
    this.gather();
  }

  private says(mid: string): Line {
    const t = this.at(mid)!;
    return { mid, kind: t.kind, sends: t.direction === 'sendrecv' };
  }

  private rollback() {
    FakePC.rolledBack++;
    for (const t of this.transceivers) {
      if (t.provisional) t.mid = null;
      else if (FakePC.chrome) t.dead = true;
      t.provisional = false;
    }
    this.localDescription = this.currentLocalDescription;
    this.signalingState = 'stable';
    this.asked = false;
  }

  /** The negotiation has gone through: what the two descriptions say is how it is now. */
  private settle(mine: Desc, theirs: Desc) {
    const lines = parse(mine).lines;
    this.localDescription = this.currentLocalDescription = mine;
    this.currentRemoteDescription = theirs;
    this.pendingRemote = null;
    this.agreed = lines.map((l) => l.mid);
    for (const t of this.transceivers) {
      t.provisional = false;
      if (lines.some((l) => l.mid === t.mid && l.sends)) t.sent = true;
    }
    this.signalingState = 'stable';
    this.asked = false;
  }

  private receive(lines: Line[]) {
    for (const l of lines) {
      const t = this.at(l.mid)!;
      const was = t.receiving;
      t.receiving = l.sends;
      if (!l.sends || was) continue;
      const track = new FakeTrack(l.kind);
      this.ontrack?.({ track, streams: [new FakeStream([track])] });
    }
  }

  private gather() {
    if (this.gathered) return;
    this.gathered = true;
    void turn().then(() => {
      this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: `candidate of ${this.id}` }) } });
      this.onicecandidate?.({ candidate: null });
    });
  }

  /** Whether what's wanted differs from what's agreed: a line of ours in no description yet, or one open a way it isn't agreed to be. */
  private get wanting(): boolean {
    const lines = this.currentLocalDescription ? parse(this.currentLocalDescription).lines : [];
    return this.transceivers.some((t) => (t.mid === null ? t.added : lines.find((l) => l.mid === t.mid)?.sends !== (t.direction === 'sendrecv')));
  }

  private need() {
    void turn().then(() => {
      if (this.signalingState !== 'stable' || this.applying || this.asked || !this.wanting) return;
      this.asked = true;
      this.onnegotiationneeded?.();
    });
  }
}

/** Whether `kind` from `a` is arriving at `b`: the two have agreed on the same pair of descriptions, with a line for it open from `a`, and `a` has a track on that line. */
export function flows(a: FakePC, b: FakePC, kind: Kind): boolean {
  if (a.signalingState !== 'stable' || b.signalingState !== 'stable' || !a.currentLocalDescription || !b.currentLocalDescription) return false;
  if (a.currentLocalDescription.sdp !== b.currentRemoteDescription?.sdp || b.currentLocalDescription.sdp !== a.currentRemoteDescription?.sdp) return false;
  const open = parse(a.currentLocalDescription).lines.filter((l) => l.kind === kind && l.sends);
  return a.getTransceivers().some((t) => open.some((l) => l.mid === t.mid) && !!t.sender.track && !t.dead);
}
