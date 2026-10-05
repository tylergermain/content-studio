// Your webcam as your character's face (see the client's features/webcam). The picture itself goes
// browser to browser, on the voice connections; the office only hears whether it's on, which it keeps
// on PeerInfo (`webcam`) so everyone knows to look for it.

export type WebcamClientMsg =
  /** Your webcam is your face now, or not any more. */
  { t: 'webcam'; on: boolean };
