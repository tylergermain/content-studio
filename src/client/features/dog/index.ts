import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { noOutline } from '../../core/outline';
import { store } from '../../state';
import { Dog } from './world';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    dog: true;
  }
}

/** The floor's dog, the office's own: it walks about, barks at workers waiting on someone, and E pets it. */
export function installDog(ctx: Ctx): Dog {
  // The floor's dog. It goes quiet once someone has the terminal of the worker it's barking at open.
  const dog = new Dog(ctx.sound, (id) => (store.workers.get(id)?.viewers.length ?? 0) > 0);
  ctx.scene.add(dog.root);
  noOutline(dog.root);
  // The dog walks about on its own, not on the building: it's there to aim at by itself.
  ctx.usables.add({ usable: () => dog.interactables, pickable: () => dog.root });
  store.on('dog', () => dog.sync(store.dog, store.dogStart));
  ctx.ticks.add('others', ({ dt }) => dog.update(dt));
  ctx.interactions.define('dog', {
    reach: 3.2,
    hint: () => {
      const doing = dog.doing(
        (id) => store.workers.get(id)?.name,
        (id) => (id === store.you ? 'you' : store.peers.get(id)?.name),
      );
      return { k: `${dog.name}|${doing}`, parts: [hintTitle(`🐶 ${dog.name}`), doing ? aside(doing) : '', key('E', 'Pet')] };
    },
    use: onE(() => ctx.net.send({ t: 'dog.pet' })),
  });
  return dog;
}
