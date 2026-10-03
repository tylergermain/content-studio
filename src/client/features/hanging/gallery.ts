import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { followPaintings } from './paintings';
import { Gallery } from './world';

/** The pictures people hung on the walls, as the office has them. */
export function installGallery(ctx: Ctx): Gallery {
  // Pictures people hung on the walls
  const gallery = new Gallery();
  ctx.office.group.add(gallery.group);
  const sync = () => gallery.sync(store.decor, ctx.office.room.get());
  store.on('decor', sync);
  // Where a picture is looked at from goes by the floor's room: one over the loft or the mezzanine, from up there.
  ctx.office.room.on(sync);
  // What's hung on the walls is there to use (and to aim at: it's on the building).
  ctx.usables.add({ usable: () => gallery.interactables });
  // The builder's paintings are furniture, not the gallery's: what each shows is loaded beside these.
  followPaintings(ctx);
  return gallery;
}
