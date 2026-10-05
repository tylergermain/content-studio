import * as THREE from 'three';
import { FRAMES, FRAME_BORDER, mediaLink } from '../../shared/decor';
import { toon } from './toon';

// Pictures and the frames they hang in. The office loads an image once for everything that shows it
// and keeps it while something does; a frame is built to a size and shown a texture, cropped to fill
// it. The pictures people hang on the walls are made of these (features/hanging), and so is anything
// else in the office that's a picture in a frame.

// ---- Pictures -------------------------------------------------------------------------------------

export interface Picture {
  url: string;
  texture: THREE.CanvasTexture;
  /** The image's width / height. */
  aspect: number;
  /** An object URL of the full-size image, for showing it in the page. */
  src: string;
}

/** A wall picture never needs more pixels than this, and big photos would eat GPU memory. */
const MAX_TEXTURE = 1024;
/** Fewer still on a headset that asks for it (see capPictures); 0 for MAX_TEXTURE. */
let cap = 0;
const longest = () => (cap > 0 ? Math.min(cap, MAX_TEXTURE) : MAX_TEXTURE);
const pictures = new Map<string, Promise<Picture>>();
const holds = new Map<string, number>();

/** Draws `img` (`iw` × `ih`) into a canvas no more than `longest()` across. */
function fitted(img: CanvasImageSource, iw: number, ih: number): HTMLCanvasElement {
  const k = Math.min(1, longest() / Math.max(iw, ih));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(iw * k));
  canvas.height = Math.max(1, Math.round(ih * k));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * The pictures at most `px` across from now on (0: the office's own MAX_TEXTURE), the ones already
 * loaded drawn again at that size from the image they came from. A headset's quality profile sets it
 * (see features/vr/quality.ts): a laptop never does.
 */
export function capPictures(px: number) {
  if (px === cap) return;
  cap = px;
  for (const p of pictures.values()) {
    void p.then(async (pic) => {
      const img = new Image();
      img.src = pic.src;
      await img.decode();
      const was = pic.texture.image as HTMLCanvasElement;
      const canvas = fitted(img, img.naturalWidth || MAX_TEXTURE, img.naturalHeight || MAX_TEXTURE);
      if (canvas.width === was.width && canvas.height === was.height) return;
      // A texture of another size is made afresh: the old one let go of first.
      pic.texture.dispose();
      pic.texture.image = canvas;
      pic.texture.needsUpdate = true;
    }).catch(() => {});
  }
}

/** The office fetches images for us, so a picture shows up whatever its host allows. */
export function imageUrl(url: string): string {
  // One of a floor's own pictures comes from its media folder (see mediaLink).
  const own = mediaLink(url);
  if (own) return `/api/media?floor=${encodeURIComponent(own.floor)}&name=${encodeURIComponent(own.name)}`;
  return `/api/image?url=${encodeURIComponent(url)}`;
}

async function fetchPicture(url: string): Promise<Picture> {
  let res: Response;
  try {
    res = await fetch(imageUrl(url));
  } catch {
    throw new Error("Couldn't reach the office to load that image");
  }
  if (!res.ok) {
    let error = `The office couldn't load that image (${res.status})`;
    try {
      error = (await res.json()).error ?? error;
    } catch {
      // not JSON
    }
    throw new Error(error);
  }
  const src = URL.createObjectURL(await res.blob());
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    // An SVG without a size reports 0×0.
    const iw = img.naturalWidth || MAX_TEXTURE;
    const ih = img.naturalHeight || MAX_TEXTURE;
    const canvas = fitted(img, iw, ih);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return { url, texture, aspect: iw / ih, src };
  } catch {
    URL.revokeObjectURL(src);
    throw new Error("Your browser can't show that image");
  }
}

/** Loads an image once for everything that shows it. Failures aren't kept, so asking again retries. */
export function loadPicture(url: string): Promise<Picture> {
  let p = pictures.get(url);
  if (!p) {
    const fresh = fetchPicture(url);
    fresh.catch(() => {
      if (pictures.get(url) === fresh) pictures.delete(url);
    });
    pictures.set(url, fresh);
    p = fresh;
  }
  return p;
}

/** Keeps a picture loaded while something besides the walls shows it. Call the result to let go. */
export function holdPicture(url: string): () => void {
  holds.set(url, (holds.get(url) ?? 0) + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const n = (holds.get(url) ?? 1) - 1;
    if (n > 0) holds.set(url, n);
    else holds.delete(url);
  };
}

/** Frees the pictures nothing shows anymore: those not in `onWalls`, and not held (see holdPicture). */
export function prunePictures(onWalls: Set<string>) {
  for (const [url, p] of pictures) {
    if (onWalls.has(url) || holds.has(url)) continue;
    pictures.delete(url);
    p.then(
      (pic) => {
        pic.texture.dispose();
        URL.revokeObjectURL(pic.src);
      },
      () => {},
    );
  }
}

function notice(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 384;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '800 44px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText(text, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let loadingTex: THREE.CanvasTexture | null = null;
let brokenTex: THREE.CanvasTexture | null = null;
let blankTex: THREE.CanvasTexture | null = null;
const loadingTexture = () => (loadingTex ??= notice('🖼️ Loading…', '#e9ecef', '#7a6f65'));
export const brokenTexture = () => (brokenTex ??= notice('⚠️ Image unavailable', '#ffd6e0', '#2b2d42'));
/** A bare canvas: what a frame shows while no picture's been picked for it. */
export const blankTexture = () => (blankTex ??= notice('', '#f4efe6', '#7a6f65'));

// ---- Frames ---------------------------------------------------------------------------------------

/** How far the frame stands off the wall; the picture sits recessed inside it. */
const FRAME_DEPTH = 0.06;

export type PictureMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

/** A flat material the cartoon outline pass leaves alone. */
export function flat(params: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial(params);
  m.userData.outlineParameters = { visible: false };
  return m;
}

function frameGeometry(w: number, h: number): THREE.ExtrudeGeometry {
  const ow = w / 2 + FRAME_BORDER;
  const oh = h / 2 + FRAME_BORDER;
  const shape = new THREE.Shape().moveTo(-ow, -oh).lineTo(ow, -oh).lineTo(ow, oh).lineTo(-ow, oh).lineTo(-ow, -oh);
  const iw = w / 2;
  const ih = h / 2;
  shape.holes.push(new THREE.Path().moveTo(-iw, -ih).lineTo(-iw, ih).lineTo(iw, ih).lineTo(iw, -ih).lineTo(-iw, -ih));
  return new THREE.ExtrudeGeometry(shape, { depth: FRAME_DEPTH, bevelEnabled: false });
}

/** A framed w×h picture facing +z, its back against z = 0. It shows "Loading…" until given a texture. */
export function buildFrame(w: number, h: number, frame: number): { group: THREE.Group; picture: PictureMesh } {
  const group = new THREE.Group();
  const color = (FRAMES[frame] ?? FRAMES[0]).color;
  // With no frame the picture's straight on the wall, see-through where it is: a logo, lettering.
  if (color) {
    const border = new THREE.Mesh(frameGeometry(w, h), toon(color));
    border.receiveShadow = true;
    group.add(border);
  }
  const picture: PictureMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flat(color ? { map: loadingTexture() } : { map: loadingTexture(), transparent: true, alphaTest: 0.04 }));
  picture.position.z = color ? FRAME_DEPTH * 0.35 : 0.004;
  group.add(picture);
  return { group, picture };
}

/** Shows an image of `aspect` on a picture, cropped to fill it (like CSS object-fit: cover). */
export function showTexture(picture: PictureMesh, texture: THREE.Texture, aspect: number) {
  const { width, height } = picture.geometry.parameters;
  const shape = width / height;
  const fx = aspect > shape ? shape / aspect : 1;
  const fy = aspect > shape ? 1 : aspect / shape;
  const uv = picture.geometry.attributes.uv;
  // A one-segment plane's corners, in order: top left, top right, bottom left, bottom right.
  [
    [0, 1],
    [1, 1],
    [0, 0],
    [1, 0],
  ].forEach(([u, v], i) => uv.setXY(i, 0.5 + (u - 0.5) * fx, 0.5 + (v - 0.5) * fy));
  uv.needsUpdate = true;
  picture.material.map = texture;
  picture.material.needsUpdate = true;
}

/** Lets go of a frame's shapes, and of its picture's material (not the image on it: see prunePictures). */
export function disposeFrame(group: THREE.Group) {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    // Frame borders use shared toon materials; only the picture's material is its own.
    if (m.material instanceof THREE.MeshBasicMaterial) m.material.dispose();
  });
}
