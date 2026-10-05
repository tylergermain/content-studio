// Whether someone's webcam is their face (see shared/protocol/webcam.ts). The office only keeps the
// flag, on their PeerInfo for everyone to see: the picture goes browser to browser, over the voice
// connections the office relays signals for, and never through the office or onto its disk.
import type { WebcamClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap } from './types.js';

export const webcamHandlers = {
  webcam(ctx, c, msg) {
    const on = msg.on === true;
    if (on === !!c.peer.webcam) return;
    if (on) c.peer.webcam = true;
    else delete c.peer.webcam;
    ctx.broadcast({ t: 'peer.update', peer: c.peer });
  },
} satisfies HandlerMap<WebcamClientMsg>;
