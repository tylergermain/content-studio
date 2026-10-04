import type { Net } from './net';
import { store } from './state';

interface Conn {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** An answer of theirs is being applied. An offer that comes meanwhile is no collision: the connection is stable as soon as it has been. */
  settingAnswer: boolean;
  /** How many times the connection has been started over (see Voice.startOver). Both sides count together, and every signal says which one it's for. */
  gen: number;
  /** Times in a row it was started over because an offer or an answer wouldn't apply, since one last did. */
  failed: number;
  /** Their signals, applied one at a time in the order they came. */
  queue: Promise<void>;
  audio: HTMLAudioElement;
  audioStream?: MediaStream;
  screen?: MediaStream;
  micSender?: RTCRtpSender;
  screenSender?: RTCRtpSender;
  level: number;
  analyser?: AnalyserNode;
}

type Signal = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit | null; gen?: number };

/** How many times in a row a connection is started over before it's left as it is. */
const RETRIES = 3;

/** What a connection keeps about the RTCPeerConnection it has now, as it is with a new one: nothing made, sent or received yet. */
function fresh() {
  return {
    pc: new RTCPeerConnection({ iceServers: store.ice }),
    makingOffer: false,
    ignoreOffer: false,
    settingAnswer: false,
    audioStream: undefined,
    screen: undefined,
    micSender: undefined,
    screenSender: undefined,
    level: 0,
    analyser: undefined,
  } satisfies Partial<Conn>;
}

/**
 * Mesh WebRTC for voice + screen share. Signaling rides the office WebSocket.
 *
 * Either side can change the connection at any time, the same moment as the other included, and what
 * each is sending still arrives. Three things see to that:
 *
 * - There's little to agree on. A connection keeps one line for audio and one for video, each made the
 *   first time either side sends that kind and open both ways from then on. A track goes on its line
 *   and comes off it again (`carry`, `takeOff`) without the two sides negotiating anything.
 * - What is negotiated (a line that isn't there yet) follows the "perfect negotiation" pattern: when
 *   both make an offer at once, the impolite side's stands and the polite side's gives way. Signals are
 *   applied one at a time, in the order they came.
 * - The polite side never gives way by rolling its offer back, which is where Chrome (154) loses
 *   tracks: on a connection that had agreed on nothing, every later offer of that side's is refused (it
 *   keeps the header extension ids it picked for the rolled-back offer, and they clash with the ones the
 *   other side's offer brought); on one that had, what that side was sending stops. So with nothing
 *   agreed on it takes a new RTCPeerConnection and answers on that, and otherwise the connection is
 *   started over on both sides (`startOver`), as it is when an offer or an answer won't apply at all.
 */
export class Voice {
  readonly conns = new Map<string, Conn>();
  private mic: MediaStream | null = null;
  private screen: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private listeners = new Set<() => void>();
  /** Asking for the mic, so a second join waits for the first instead of asking again. */
  private joining: Promise<string | null> | null = null;
  /** Push to talk is held down: letting go mutes you. */
  private talking = false;
  muted = false;
  localLevel = 0;

  constructor(private net: Net) {
    // Often enough for mouths to keep up with syllables.
    setInterval(() => this.sampleLevels(), 40);
  }

  get inVoice() {
    return !!this.mic;
  }

  get sharing() {
    return !!this.screen;
  }

  get localScreen() {
    return this.screen;
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  private changed() {
    this.listeners.forEach((fn) => fn());
    this.net.send({ t: 'voice', voice: this.inVoice, muted: this.muted, sharing: this.sharing });
  }

  /** Remote screen shares currently being received, keyed by peer id. */
  remoteScreens(): Map<string, MediaStream> {
    const out = new Map<string, MediaStream>();
    for (const [id, c] of this.conns) {
      const peer = store.peers.get(id);
      if (c.screen && peer?.sharing && c.screen.getVideoTracks().some((t) => t.readyState === 'live')) out.set(id, c.screen);
    }
    return out;
  }

  levelOf(peerId: string): number {
    return peerId === store.you ? this.localLevel : (this.conns.get(peerId)?.level ?? 0);
  }

  /** `muted` joins with the mic off, for push to talk. */
  joinVoice(muted = false): Promise<string | null> {
    if (this.mic) return Promise.resolve(null);
    this.joining ??= this.join(muted).finally(() => (this.joining = null));
    return this.joining;
  }

  private async join(muted: boolean): Promise<string | null> {
    if (!window.isSecureContext) return 'Voice needs HTTPS (or localhost). Ask whoever runs the office to enable TLS.';
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      return `Microphone unavailable: ${(err as Error).message}`;
    }
    this.muted = muted;
    this.talking = false;
    this.mic.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.ensureAudioCtx();
    if (this.audioCtx) {
      const src = this.audioCtx.createMediaStreamSource(this.mic);
      this.localAnalyser = this.audioCtx.createAnalyser();
      this.localAnalyser.fftSize = 1024;
      src.connect(this.localAnalyser);
    }
    for (const c of this.conns.values()) c.micSender = this.carry(c, this.mic.getAudioTracks()[0], this.mic);
    this.changed();
    return null;
  }

  leaveVoice() {
    if (!this.mic) return;
    for (const c of this.conns.values()) c.micSender = this.takeOff(c.micSender);
    this.mic.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.localAnalyser = null;
    this.localLevel = 0;
    this.talking = false;
    this.changed();
  }

  toggleMute() {
    this.setMuted(!this.muted);
  }

  setMuted(muted: boolean) {
    if (!this.mic) return;
    this.talking = false;
    if (muted === this.muted) return;
    this.muted = muted;
    this.mic.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.changed();
  }

  /** Push to talk: the mic is on while it's held down, and muted once you let go (see stopTalking). */
  startTalking() {
    if (!this.mic || this.talking) return;
    this.setMuted(false);
    this.talking = true;
  }

  stopTalking() {
    if (this.talking) this.setMuted(true);
  }

  /**
   * Shares your screen (the browser asks which). Given a `source`, that's what goes out instead (the
   * game on the boss's monitor, see features/boss-desk), with nothing to ask: you're sharing by the
   * time this returns.
   */
  async startShare(source?: MediaStream): Promise<string | null> {
    if (this.screen) return null;
    if (source) this.screen = source;
    else {
      if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) return 'Screen sharing needs HTTPS (or localhost).';
      try {
        this.screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      } catch (err) {
        return (err as Error).name === 'NotAllowedError' ? null : `Could not share: ${(err as Error).message}`;
      }
    }
    const track = this.screen.getVideoTracks()[0];
    track.contentHint = 'detail';
    track.addEventListener('ended', () => this.stopShare());
    for (const c of this.conns.values()) c.screenSender = this.carry(c, track, this.screen);
    this.changed();
    return null;
  }

  stopShare() {
    if (!this.screen) return;
    for (const c of this.conns.values()) c.screenSender = this.takeOff(c.screenSender);
    this.screen.getTracks().forEach((t) => t.stop());
    this.screen = null;
    this.changed();
  }

  /** Called whenever the set of peers changes. */
  syncPeers() {
    // Nobody on the 2D view has voice (see PeerInfo.lite), so there's nothing to connect to.
    for (const [id, p] of store.peers) if (id !== store.you && !p.lite && !this.conns.has(id)) this.connect(id);
    for (const id of [...this.conns.keys()]) if (!store.peers.has(id) || store.peers.get(id)!.lite) this.drop(id);
  }

  reset() {
    for (const id of [...this.conns.keys()]) this.drop(id);
  }

  /** Proximity voice: louder when you're close, never fully silent. */
  setVolume(peerId: string, volume: number) {
    const c = this.conns.get(peerId);
    if (c) c.audio.volume = Math.max(0, Math.min(1, volume));
  }

  /** A signal from a peer. A connection applies its own one at a time, in the order they came. */
  handleSignal(from: string, data: Signal): Promise<void> {
    const c = this.conns.get(from) ?? this.connect(from);
    c.queue = c.queue.then(() => this.apply(from, c, data));
    return c.queue;
  }

  private async apply(id: string, c: Conn, data: Signal) {
    if (this.conns.get(id) !== c) return;
    const gen = data.gen ?? 0;
    // For a connection we've since started over.
    if (gen < c.gen) return;
    let { pc } = c;
    try {
      // They started theirs over, and this is the first we hear of it: so do we.
      if (gen > c.gen) pc = this.restart(id, c, gen);
      if (data.description) {
        const { description } = data;
        // Signals are applied one at a time, so no offer is looked at while an answer is being set; the
        // check is the pattern's own all the same, and right by itself.
        const readyForOffer = !c.makingOffer && (pc.signalingState === 'stable' || c.settingAnswer);
        const collision = description.type === 'offer' && !readyForOffer;
        c.ignoreOffer = !c.polite && collision;
        if (c.ignoreOffer) return;
        // We're the polite side and our own offer gives way, though never by rolling back (see the class
        // comment). On a connection that has agreed on something, both sides start over, and this offer
        // of theirs goes with the connection it was for.
        if (collision && pc.currentRemoteDescription) return this.startOver(id, c);
        // With nothing agreed on yet there's nothing to lose: a new RTCPeerConnection takes their offer.
        // They ignored ours, so they've nothing to be told.
        if (collision) pc = this.reopen(id, c);
        c.settingAnswer = description.type === 'answer';
        try {
          await pc.setRemoteDescription(description);
        } finally {
          c.settingAnswer = false;
        }
        if (c.pc !== pc) return;
        if (description.type === 'offer') {
          // Every line of theirs is answered open both ways, so a track of ours can go on it at any time.
          for (const line of pc.getTransceivers()) if (line.direction === 'recvonly') line.direction = 'sendrecv';
          // A new RTCPeerConnection carries nothing yet. Now their offer is in, our tracks go on the lines
          // it brought, and a line it didn't bring is offered once this is answered.
          if (collision) this.addTracks(c);
          await pc.setLocalDescription();
          if (c.pc !== pc) return;
          this.signal(id, c, { description: pc.localDescription!.toJSON() });
        }
        c.failed = 0;
      } else if (data.candidate !== undefined) {
        try {
          await pc.addIceCandidate(data.candidate ?? undefined);
        } catch (err) {
          if (!c.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      // Closed under it (the peer left, or the connection was started over): there's nothing to put right.
      if (c.pc !== pc || this.conns.get(id) !== c) return;
      console.warn('rtc signal failed', err);
      if (data.description) this.startOver(id, c, true);
    }
  }

  private signal(to: string, c: Conn, data: Signal) {
    this.net.send({ t: 'rtc', to, data: { ...data, gen: c.gen } });
  }

  /**
   * The connection starts again from nothing, with what we're sending, and the peer is told to do the
   * same: every signal carries `gen`, and a higher one than theirs is what tells them. It's what gets a
   * connection past an offer or an answer that won't apply (`failed`: that would leave the two sides
   * out of step for good), and what the polite side does where the pattern has it roll back.
   */
  private startOver(id: string, c: Conn, failed = false) {
    if (failed && ++c.failed > RETRIES) return;
    this.restart(id, c, c.gen + 1);
    this.signal(id, c, {});
  }

  private restart(id: string, c: Conn, gen: number): RTCPeerConnection {
    c.gen = gen;
    const pc = this.reopen(id, c);
    this.addTracks(c);
    // What was coming in is gone until it's back.
    this.listeners.forEach((fn) => fn());
    return pc;
  }

  private ensureAudioCtx() {
    if (!this.audioCtx) {
      try {
        this.audioCtx = new AudioContext();
      } catch {
        this.audioCtx = null;
      }
    }
    void this.audioCtx?.resume();
  }

  private connect(id: string): Conn {
    const audio = new Audio();
    audio.autoplay = true;
    const c: Conn = { ...fresh(), polite: store.you < id, gen: 0, failed: 0, queue: Promise.resolve(), audio };
    this.conns.set(id, c);
    this.wire(id, c);
    this.addTracks(c);
    return c;
  }

  /** A new RTCPeerConnection for a connection, in place of the one it had. It sends nothing yet (see addTracks). */
  private reopen(id: string, c: Conn): RTCPeerConnection {
    const old = c.pc;
    old.onnegotiationneeded = old.onicecandidate = old.oniceconnectionstatechange = old.ontrack = null;
    old.close();
    c.audio.srcObject = null;
    Object.assign(c, fresh());
    this.wire(id, c);
    return c.pc;
  }

  /** Puts what we're sending on a connection: the mic if we're in voice, the screen if we're sharing. */
  private addTracks(c: Conn) {
    if (this.mic && !c.micSender) c.micSender = this.carry(c, this.mic.getAudioTracks()[0], this.mic);
    if (this.screen && !c.screenSender) c.screenSender = this.carry(c, this.screen.getVideoTracks()[0], this.screen);
  }

  /**
   * Puts a track of ours on a connection: on the line it has for that kind, which takes nothing more
   * than that, or on a new line, which the two sides then negotiate.
   */
  private carry(c: Conn, track: MediaStreamTrack, stream: MediaStream): RTCRtpSender {
    const line = c.pc.getTransceivers().find((t) => t.receiver.track.kind === track.kind && t.direction !== 'stopped');
    if (!line) return c.pc.addTrack(track, stream);
    // A line of theirs from before lines were answered open (an older page's): opening it is negotiated.
    if (line.direction !== 'sendrecv') line.direction = 'sendrecv';
    void line.sender.replaceTrack(track).catch(() => {});
    return line.sender;
  }

  /** Takes our track off the line it was on. The line stays, for the next one. */
  private takeOff(sender: RTCRtpSender | undefined): undefined {
    // It only fails on a connection that's closed.
    void sender?.replaceTrack(null).catch(() => {});
  }

  /** Follows a connection's RTCPeerConnection: offers when it needs one, sends its candidates, takes in what arrives. */
  private wire(id: string, c: Conn) {
    const { pc, audio } = c;
    pc.onnegotiationneeded = async () => {
      try {
        c.makingOffer = true;
        await pc.setLocalDescription();
        if (c.pc === pc) this.signal(id, c, { description: pc.localDescription!.toJSON() });
      } catch (err) {
        // Closed under it (the peer left, or the connection was started over): there's nothing to put right.
        if (c.pc !== pc || this.conns.get(id) !== c) return;
        console.warn('rtc negotiation failed', err);
        // In its turn among their signals: one of those may be half applied, and a connection closed
        // under that never says so.
        c.queue = c.queue.then(() => {
          if (c.pc === pc && this.conns.get(id) === c) this.startOver(id, c, true);
        });
      } finally {
        if (c.pc === pc) c.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => this.signal(id, c, { candidate: candidate ? candidate.toJSON() : null });
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') pc.restartIce();
    };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      if (track.kind === 'audio') {
        c.audioStream = stream;
        audio.srcObject = stream;
        void audio.play().catch(() => {
          // Autoplay blocked until the user interacts; retry on the next click.
          window.addEventListener('pointerdown', () => void audio.play().catch(() => {}), { once: true });
        });
        this.ensureAudioCtx();
        if (this.audioCtx) {
          try {
            const src = this.audioCtx.createMediaStreamSource(stream);
            c.analyser = this.audioCtx.createAnalyser();
            c.analyser.fftSize = 1024;
            src.connect(c.analyser);
          } catch {
            // analyser is optional
          }
        }
      } else {
        c.screen = stream;
        track.addEventListener('unmute', () => this.listeners.forEach((fn) => fn()));
        track.addEventListener('ended', () => this.listeners.forEach((fn) => fn()));
      }
      this.listeners.forEach((fn) => fn());
    };
  }

  private drop(id: string) {
    const c = this.conns.get(id);
    if (!c) return;
    c.pc.close();
    c.audio.srcObject = null;
    this.conns.delete(id);
    this.listeners.forEach((fn) => fn());
  }

  private readonly levelBuf = new Uint8Array(1024);

  private sampleLevels() {
    const buf = this.levelBuf;
    const rms = (a: AnalyserNode) => {
      a.getByteTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += ((v - 128) / 128) ** 2;
      return Math.sqrt(s / buf.length);
    };
    this.localLevel = this.localAnalyser && !this.muted ? rms(this.localAnalyser) : 0;
    for (const c of this.conns.values()) c.level = c.analyser ? rms(c.analyser) : 0;
  }
}
