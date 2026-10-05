/**
 * What the builder's paintings show (the kinds that show a picture, see KindDef.shows in
 * shared/furniture.ts). A painting is furniture: the office builds its frame and stands it on its wall
 * (world/office/furniture-decor.ts), and names one of the floor's own picture files (Piece.media, in
 * the floor's media folder, see server/media.ts). The picture itself comes from the same cache as the
 * ones people hang with F (world/frames.ts), so a file hung both ways is loaded once.
 */
import type * as THREE from 'three';
import { kindDef } from '../../../shared/furniture';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { blankTexture, brokenTexture, holdPicture, loadPicture, prunePictures, showTexture, type Picture, type PictureMesh } from '../../world/frames';

/** How long a picture that wouldn't load is left before it's asked for again, in milliseconds: its file may only just have been put in the folder. */
const RETRY_AFTER = 30_000;

/** A painting on the floor, and what's in its frame. */
interface Hung {
  /** Its picture as a link (`media:<floor>/<file>`, see mediaLink in shared/decor.ts): '' while none's picked. */
  url: string;
  /** Lets go of the picture (see holdPicture). */
  release(): void;
  /** The picture once it's loaded, or when it wouldn't load. */
  picture?: Picture;
  failedAt?: number;
  /** The mesh that was last given a texture, and which one. */
  on?: PictureMesh;
  showing?: THREE.Texture;
}

/**
 * Registers the paintings' tick: each shows the file it names, a bare canvas while it names none, and
 * the "unavailable" notice when its file won't load. Called with the gallery (see installGallery).
 */
export function followPaintings(ctx: Ctx) {
  const hung = new Map<string, Hung>();
  const seen = new Set<string>();

  function load(h: Hung) {
    h.failedAt = undefined;
    loadPicture(h.url).then(
      (picture) => (h.picture = picture),
      () => (h.failedAt = performance.now()),
    );
  }

  function show(h: Hung, on: PictureMesh, texture: THREE.Texture, aspect: number) {
    showTexture(on, texture, aspect);
    h.on = on;
    h.showing = texture;
  }

  ctx.ticks.add('world', ({ now }) => {
    const floor = store.floor;
    let letGo = false;
    seen.clear();
    for (const v of ctx.office.furniture.all()) {
      if (!v.screen || !kindDef(v.piece.kind).shows) continue;
      const id = v.piece.id;
      seen.add(id);
      const url = v.piece.media && floor ? `media:${floor}/${v.piece.media}` : '';
      let h = hung.get(id);
      if (!h || h.url !== url) {
        const was = h;
        h = { url, release: url ? holdPicture(url) : () => {} };
        hung.set(id, h);
        if (url) load(h);
        if (was) {
          was.release();
          letGo = true;
          // Its old picture may be freed now, so that comes out of the frame before the new one is in.
          if (was.on === v.screen) show(h, v.screen, blankTexture(), 4 / 3);
        }
      } else if (h.failedAt !== undefined && now - h.failedAt > RETRY_AFTER) {
        load(h);
      }
      // Nothing yet while it loads: a new frame comes showing "Loading…", and one whose picture changed is bare until then.
      const texture = !url ? blankTexture() : h.picture ? h.picture.texture : h.failedAt !== undefined ? brokenTexture() : undefined;
      // A piece built again (a new size, frame or height) has a new mesh, which shows "Loading…" until it's given its picture back.
      if (texture && (h.on !== v.screen || h.showing !== texture)) show(h, v.screen, texture, h.picture ? h.picture.aspect : 4 / 3);
    }
    for (const [id, h] of hung) {
      if (seen.has(id)) continue;
      h.release();
      hung.delete(id);
      letGo = true;
    }
    // A picture nothing shows anymore is freed, as the gallery frees its own (the walls' pictures are kept).
    if (letGo) prunePictures(new Set(store.decor.map((d) => d.url)));
  });
}
