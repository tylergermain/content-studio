// A webcam worn as a face: the picture laid over the front of a character's head where the drawn face
// is (see Person.wearFace), under their hair like a face would be, unlit so it reads in any light.
// Until the picture comes it's a card saying it's on its way.

import * as THREE from 'three';
import type { Person } from '../../world/character';
import { faceShows, faceUv, squareCrop } from './logic';

/** The head is a ball 0.34 m round; the face sits just over it, as far round as the drawn one reaches, tipped down a little. */
const R = 0.348;
const SPREAD = 0.88;
const TILT = 0.12;
const EDGE = R * Math.sin(SPREAD);

/** The part of the head the picture covers, its UVs laid flat across it (see faceUv). Made once and shared. */
const capGeometry = (() => {
  const g = new THREE.SphereGeometry(R, 32, 12, 0, Math.PI * 2, 0, SPREAD);
  // Round the head's front (+z) instead of its top.
  g.rotateX(Math.PI / 2);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, ...faceUv(pos.getX(i), pos.getY(i), EDGE));
  uv.needsUpdate = true;
  g.rotateX(TILT);
  return g;
})();

/** A dark rim round its edge, the way the drawn face's eyes are inked. */
const rimGeometry = (() => {
  const g = new THREE.TorusGeometry(EDGE, 0.009, 6, 48);
  g.translate(0, 0, R * Math.cos(SPREAD));
  g.rotateX(TILT);
  return g;
})();
const rimMaterial = new THREE.MeshBasicMaterial({ color: '#1d1d1d' });
rimMaterial.userData.outlineParameters = { visible: false };

/** The card a face shows while the picture's on its way (or they're too far off for it to have come): sharp up close. */
const waitingTexture = (() => {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(S / 2, S * 0.42, S / 16, S / 2, S / 2, S * 0.7);
  grad.addColorStop(0, '#4b5563');
  grad.addColorStop(1, '#1f2937');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${S * 0.375}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  g.fillText('📷', S / 2, S * 0.47);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

export class CamFace {
  readonly group = new THREE.Group();
  private readonly material = new THREE.MeshBasicMaterial({ map: waitingTexture, toneMapped: false });
  private video: HTMLVideoElement | null = null;
  private texture: THREE.VideoTexture | null = null;
  private track: MediaStreamTrack | null = null;
  /** A frame has been drawn from the picture since it was put on (it stays up while paused). */
  private framed = false;

  constructor(
    readonly person: Person,
    /** Your own, seen by you: a mirror's, as a selfie is. */
    private readonly mirror: boolean,
  ) {
    this.material.userData.outlineParameters = { visible: false };
    this.group.add(new THREE.Mesh(capGeometry, this.material), new THREE.Mesh(rimGeometry, rimMaterial));
    person.wearFace(this.group);
  }

  /**
   * Shows `track` playing (`play`), or paused on its last frame (someone walked out of range), or the
   * waiting card when there's no track or no frame of it yet. A new track is only taken up to play it:
   * someone who's never been near enough is never played at all.
   */
  show(track: MediaStreamTrack | null, play: boolean) {
    if (track !== this.track && (play || !track)) this.attach(track);
    const video = this.video;
    if (video) {
      if (play && video.paused) void video.play().catch(() => {});
      else if (!play && !video.paused) video.pause();
      if (!this.framed && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        this.framed = true;
        this.fit();
      }
    }
    const map = faceShows(true, this.framed) === 'video' ? this.texture : waitingTexture;
    if (this.material.map !== map) {
      this.material.map = map;
      this.material.needsUpdate = true;
    }
  }

  private attach(track: MediaStreamTrack | null) {
    this.detach();
    this.track = track;
    if (!track) return;
    const video = (this.video = document.createElement('video'));
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = new MediaStream([track]);
    // A camera turned round, or another picked: square it up again.
    video.addEventListener('resize', () => this.framed && this.fit());
    const texture = (this.texture = new THREE.VideoTexture(video));
    texture.colorSpace = THREE.SRGBColorSpace;
  }

  /** The middle square of the picture, the right way round for whoever's looking (see squareCrop). */
  private fit() {
    const { video, texture } = this;
    if (!video || !texture) return;
    const { repeat, offset } = squareCrop(video.videoWidth, video.videoHeight, this.mirror);
    texture.repeat.set(...repeat);
    texture.offset.set(...offset);
  }

  private detach() {
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.texture?.dispose();
    this.video = null;
    this.texture = null;
    this.track = null;
    this.framed = false;
  }

  /** Takes it off: the drawn face comes back, and the picture is let go of. */
  dispose() {
    this.detach();
    this.person.wearFace(null);
    this.material.dispose();
  }
}
