// The webcam's line on a voice connection (Voice.sendCamera, for features/webcam).
//
// A webcam goes on a video line of its own, apart from the screen share's, so someone can share their
// screen and wear their webcam at once. Whichever side turns its webcam on first makes the line; the
// other answers it open both ways and puts its own webcam on the same line when it turns one on. From
// then on a webcam goes on and comes off it (or stops going to someone too far away to see it) with
// replaceTrack, which the two sides don't negotiate, so there's nothing for them to collide over.
//
// Each side says which line its own webcam goes on: every signal names it by its mid (`cam`). What
// arrives on the line the other side names is their webcam, and nothing else is, whichever side made
// the line: so a share that lands on a webcam's line in the other direction (two offers crossing can do
// that) is still a share. And when both turn theirs on at once, the polite side waits a moment for the
// other's line to arrive and shares it, rather than offering one of its own across it.
//
// What's kept goes by RTCPeerConnection, so a connection started over on a new one starts with no line.

interface CamLine {
  /** The line our webcam goes on, once there is one. */
  line?: RTCRtpTransceiver;
  /** The line theirs goes on, by its mid, as their signals name it. */
  theirs?: string;
  /** When we first heard of the connection (see CAM_SETTLE). */
  since: number;
  /** When we first had a webcam for it and no line to put it on (see CAM_DEFER). */
  wanted?: number;
  /** The scale the line's sender was capped at (see CAM_ENCODING), once it has been. */
  capped?: number;
  /** Times in a row capping it has failed (see CAP_TRIES). */
  capFailed: number;
}

/**
 * How long a new connection is left before a webcam line is offered on it, in ms: the mic or the share
 * the other side opens it with goes first, rather than the two offers crossing.
 */
export const CAM_SETTLE = 1500;
/** How much longer the polite side waits before making a line of its own, in ms: one of theirs, on its way, is shared instead. */
export const CAM_DEFER = 1000;

/** The most a webcam sends: 15 frames a second in about 150 kbit/s (a small square, see features/webcam). */
export const CAM_ENCODING = { maxBitrate: 150_000, maxFramerate: 15 } as const;
/**
 * How many times in a row capping a line to CAM_ENCODING is tried on a connection before it's left
 * as it is: a browser that won't take it won't take it however often it's asked.
 */
export const CAP_TRIES = 3;

const lines = new WeakMap<RTCPeerConnection, CamLine>();

function stateOf(pc: RTCPeerConnection): CamLine {
  let st = lines.get(pc);
  if (!st) lines.set(pc, (st = { since: performance.now(), capFailed: 0 }));
  return st;
}

const live = (t: RTCRtpTransceiver | undefined) => (t && t.currentDirection !== 'stopped' && t.direction !== 'stopped' ? t : undefined);
const byMid = (pc: RTCPeerConnection, mid: string | undefined) => (mid ? live(pc.getTransceivers().find((t) => t.mid === mid)) : undefined);
/** A line that's theirs to receive on and ours to send on is open both ways (opening it after it's been answered is negotiated). */
const open = (t: RTCRtpTransceiver) => {
  if (t.direction === 'recvonly' || t.direction === 'inactive') t.direction = 'sendrecv';
};

/** Our webcam's line, by its mid, for a signal to name (none until it has been offered). */
export function camMid(pc: RTCPeerConnection): string | undefined {
  return lines.get(pc)?.line?.mid ?? undefined;
}

/** A signal of theirs named their webcam's line: noted before its description is applied, so the track that arrives on it is known for theirs. */
export function heardCam(pc: RTCPeerConnection, mid: unknown) {
  if (typeof mid === 'string' && mid) stateOf(pc).theirs = mid;
}

/**
 * Their offer is in and not yet answered: the line it names for their webcam is answered open both
 * ways, and is ours too. A line of ours that was never agreed on (its offer gave way to theirs) gives
 * way to it, our webcam with it; one that was agreed on stays, each side's webcam on its own. So does a
 * line one of our other tracks is already on (a share or a mic, put there as the offers crossed).
 */
export function openCam(pc: RTCPeerConnection) {
  const st = stateOf(pc);
  const theirs = byMid(pc, st.theirs);
  const ours = live(st.line);
  if (!theirs || theirs === ours || ours?.mid) return;
  if (theirs.sender.track && theirs.sender.track !== ours?.sender.track) return;
  open(theirs);
  if (ours) {
    void theirs.sender.replaceTrack(ours.sender.track).catch(() => {});
    // Never agreed on, so it goes without anything to negotiate.
    try {
      ours.stop();
    } catch {
      // closed
    }
  }
  st.line = theirs;
  st.capped = undefined;
}

/** Whether a track that arrives on `t` is their webcam (and not a share): the line their signals name. */
export function theirCamLine(pc: RTCPeerConnection, t: RTCRtpTransceiver | undefined): boolean {
  const st = lines.get(pc);
  return !!st?.theirs && t?.mid === st.theirs;
}

/**
 * Whether `t` is a webcam's line, ours or theirs: one to keep anything else of ours off, for whatever
 * picks a line by its kind to put a track on (a screen put on ours would take our webcam's place).
 */
export function isCamLine(pc: RTCPeerConnection, t: RTCRtpTransceiver | undefined): boolean {
  return !!t && (t === lines.get(pc)?.line || theirCamLine(pc, t));
}

/**
 * Puts our webcam on the connection (`track`), or takes it off (null). The first time it needs a line:
 * theirs if they've one free, else a new one, once the connection has settled (CAM_SETTLE) and nothing
 * is being negotiated on it, the `polite` side a moment later (CAM_DEFER). After that it's replaceTrack.
 * `scale` is how far the camera's picture is shrunk to send (see camScale).
 */
export function sendCam(pc: RTCPeerConnection, track: MediaStreamTrack | null, scale = 1, polite = false) {
  if (pc.signalingState === 'closed') return;
  const st = stateOf(pc);
  let line = live(st.line);
  if (!line && track) {
    const theirs = byMid(pc, st.theirs);
    if (theirs && !theirs.sender.track) {
      open(theirs);
      line = st.line = theirs;
    }
  }
  if (!line) {
    if (!track) return void (st.wanted = undefined);
    const now = performance.now();
    st.wanted ??= now;
    if (pc.signalingState !== 'stable' || now - st.since < CAM_SETTLE || (polite && now - st.wanted < CAM_DEFER)) return;
    st.line = pc.addTransceiver(track, { direction: 'sendrecv', sendEncodings: [{ ...CAM_ENCODING, scaleResolutionDownBy: scale }] });
    st.capped = scale;
    return;
  }
  if (line.sender.track !== track) void line.sender.replaceTrack(track).catch(() => {});
  // A line they made (or one made for another camera) is held to the same as one we made.
  if (track && st.capped !== scale && line.mid && pc.signalingState === 'stable' && st.capFailed < CAP_TRIES) {
    st.capped = scale;
    void cap(line.sender, scale).then(
      () => (st.capFailed = 0),
      () => {
        st.capped = undefined;
        st.capFailed++;
      },
    );
  }
}

async function cap(sender: RTCRtpSender, scale: number) {
  const p = sender.getParameters();
  if (!p.encodings?.length) throw new Error('no encodings yet');
  p.encodings[0] = { ...p.encodings[0], ...CAM_ENCODING, scaleResolutionDownBy: scale };
  await sender.setParameters(p);
}

/** Their webcam's track, once they've named a line for it: it shows nothing until they put their webcam on it. */
export function theirCam(pc: RTCPeerConnection): MediaStreamTrack | null {
  if (pc.signalingState === 'closed') return null;
  return byMid(pc, lines.get(pc)?.theirs)?.receiver.track ?? null;
}
