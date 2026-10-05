import type * as THREE from 'three';
import { lookFromSeed } from '../../../shared/avatar';
import { SEAT_HIPS } from '../../../shared/garage';
import { HELI } from '../../../shared/heli';
import type { HeliCrew, HeliPose, PeerInfo } from '../../../shared/protocol';
import { Person } from '../../world/character';
import { disposeSprite, textSprite } from '../../world/toon';
import { heliPoint } from './model';

// Who's aboard Friday One that you can't see as themselves: someone who got in on another floor (or is
// up on the roof while you're down here) sits in their seat as a figure with their name over them, and
// while the pilot isn't with you a bigger tag over the rotor says who's flying it ("Tyler · Friday One").
// Everyone who is with you is drawn by features/peers, seated through rideOf (see index.ts).

/** The tag over the rotor: how far over the hub. */
const TAG_UP = 1.3;

export class CrewFigures {
  private readonly figures = new Map<string, { person: Person; place: number }>();
  private tag: THREE.Sprite | null = null;
  private tagText = '';
  private readonly at = { x: 0, h: 0, z: 0 };

  /** Builds into `group`, which is drawn in the same frame as the helicopter. */
  constructor(private readonly group: THREE.Group) {}

  /**
   * Who's aboard (`crew`), and whether each is drawn as themselves where you are (`here`): a figure for
   * everyone who isn't, in the look `peer` has for them, and the tag while the pilot isn't here.
   */
  sync(crew: readonly HeliCrew[], here: (id: string) => boolean, peer: (id: string) => PeerInfo | undefined) {
    const shown = new Set<string>();
    for (const c of crew) {
      if (here(c.id)) continue;
      shown.add(c.id);
      let f = this.figures.get(c.id);
      if (!f) {
        const person = new Person(c.name, c.color, peer(c.id)?.look ?? lookFromSeed(c.id));
        // The pilot's name goes on the tag instead.
        if (c.seat !== 'pilot') person.setLabel(c.name, null);
        person.sit(SEAT_HIPS);
        this.group.add(person.root);
        f = { person, place: c.place };
        this.figures.set(c.id, f);
      }
      f.place = c.place;
    }
    for (const [id, f] of this.figures) {
      if (shown.has(id)) continue;
      this.group.remove(f.person.root);
      this.figures.delete(id);
    }
    const pilot = crew.find((c) => c.seat === 'pilot');
    const text = pilot && !here(pilot.id) ? `🚁 ${pilot.name} · Friday One` : '';
    if (text === this.tagText) return;
    this.tagText = text;
    if (this.tag) {
      this.group.remove(this.tag);
      disposeSprite(this.tag);
      this.tag = null;
    }
    if (!text) return;
    this.tag = textSprite(text, { bg: '#fffaf3', size: 64 });
    this.group.add(this.tag);
  }

  /** Each frame: everyone in their seat as it's drawn at `pose`, its street at `base` in the group's frame. */
  place(pose: HeliPose, base: number, dt: number, t: number) {
    for (const f of this.figures.values()) {
      const s = HELI.seats[f.place] ?? HELI.seats[0];
      heliPoint(pose, s.x, s.y - SEAT_HIPS, s.z, this.at);
      f.person.root.position.set(this.at.x, base + this.at.h, this.at.z);
      f.person.root.rotation.y = pose.yaw;
      f.person.update(dt, t, false, false);
    }
    this.tag?.position.set(pose.x, base + pose.h + HELI.hub + TAG_UP, pose.z);
  }
}
