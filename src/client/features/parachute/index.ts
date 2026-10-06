/**
 * Parachuting off the balcony: jump up onto the railing (Space), step off the far side, and once
 * you're falling with a few meters still to go, a chute opens over you by itself. You sink gently
 * under it and steer with W A S D wherever you like to land: the lot out front, the street, the
 * sidewalk. Down on the ground it crumples behind you. Everyone on your floor sees a chute over
 * anyone hanging up off the ground, worked out from where they are, so nothing new goes over the wire.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { STOREY } from '../../../shared/layout';
import { groundAt } from '../../player';
import { store } from '../../state';
import { toast } from '../../ui/dom';
import { CANOPIES, disposeParachute, parachute } from '../../world/parachute';
import { POP, STRAP, airborne, crumpleAt, popScale, shouldOpen, sinkAt } from './logic';

/** A chute over someone, and how far along it is: opening, open, or crumpling once they're down. */
interface Chute {
  holder: THREE.Group;
  view: { group: THREE.Group; dome: THREE.Group };
  t: number;
  /** Seconds since they landed; null while they're still up. */
  down: number | null;
  /** How fast they were falling when it opened, so it catches them over POP rather than all at once. */
  from: number;
}

/** A chute is a touch bigger over a person than over a worker. */
const SIZE = 1.15;

export function installParachute(ctx: Ctx, parts: Pick<Parts, 'peers' | 'cars' | 'heli' | 'travel'>) {
  const { player, scene } = ctx;
  let mine: Chute | null = null;
  const theirs = new Map<string, Chute>();
  let told = false;

  /** How far there is to fall from (x, y, z) on this floor: down to whatever's under it, or the street. */
  const heightAt = (x: number, y: number, z: number) => y - Math.max(groundAt(player.colliders, x, z, y), player.street);

  function make(from: number, color: string): Chute {
    const view = parachute(color, STRAP);
    view.group.scale.setScalar(0.05);
    const holder = new THREE.Group();
    holder.add(view.group);
    scene.add(holder);
    return { holder, view, t: 0, down: null, from };
  }

  /** It opens over, follows and sways with someone up in the air, crumples once they're down, and says when it's gone. */
  function step(c: Chute, dt: number, at: THREE.Vector3, facing: number, moving: boolean): boolean {
    c.t += dt;
    const { group, dome } = c.view;
    if (c.down === null) {
      c.holder.position.copy(at);
      c.holder.rotation.y = facing;
      group.scale.setScalar(popScale(c.t) * SIZE);
      group.rotation.set(moving ? 0.14 : 0.04, 0, Math.sin(c.t * 1.7) * 0.07);
      return true;
    }
    c.down += dt;
    const p = crumpleAt(c.down);
    // Tipping over behind them and settling flat as the air goes out of it.
    group.rotation.set(-1.35 * Math.min(1, p * 1.6), 0, 0);
    dome.scale.y = 0.62 * (1 - 0.65 * p);
    group.scale.setScalar(SIZE * Math.max(0.001, 1 - Math.max(0, (p - 0.55) / 0.45) ** 2));
    if (p < 1) return true;
    disposeParachute(c.view);
    c.holder.removeFromParent();
    return false;
  }

  // ---- Yours ----

  ctx.ticks.add('moved', ({ dt }) => {
    const free = !player.rig && !player.seat && !player.riding;
    if (!mine && free && !player.grounded && shouldOpen(heightAt(player.pos.x, player.pos.y, player.pos.z), player.vy)) {
      mine = make(-player.vy, CANOPIES[Math.floor(Math.random() * CANOPIES.length)]);
      ctx.sound.chute('open');
      if (!told) {
        told = true;
        toast('🪂 Chute open: steer with W A S D');
      }
    }
    if (!mine) return;
    if (mine.down === null) {
      if (player.grounded || !free) {
        mine.down = 0;
        player.maxFall = Infinity;
        if (free) ctx.sound.chute('land');
        // Off the roof, down on the street: that's the bottom floor's street now (see landFromRoof).
        if (free && ctx.upTop() && player.pos.y < -STOREY) parts.travel.landFromRoof(player.pos.x, player.pos.z, player.facing);
      } else {
        // It catches you over the time it takes to open, not all at once, and lets you down quicker while you're high up.
        const k = Math.min(1, mine.t / POP);
        const sink = sinkAt(heightAt(player.pos.x, player.pos.y, player.pos.z));
        player.maxFall = sink + Math.max(0, mine.from - sink) * (1 - k);
      }
    }
    // In first person the cords would run right past your eyes: only the canopy shows, overhead.
    const cords = mine.view.group.children.find((o) => o instanceof THREE.LineSegments);
    if (cords) cords.visible = player.view !== 'first';
    if (!step(mine, dt, player.pos, player.facing, player.moving)) mine = null;
  });

  // ---- Everyone else's, worked out from where they are ----

  ctx.ticks.add('others', ({ dt }) => {
    const { remotes } = parts.peers;
    for (const [id, r] of remotes) {
      const p = store.peers.get(id);
      const riding = !!p?.seat || !!parts.cars.rideOf(id) || !!parts.heli.rideOf(id) || !!r.grip || !r.person.root.visible;
      const at = r.person.root.position;
      const c = theirs.get(id);
      const up = !riding && airborne(heightAt(at.x, at.y, at.z), !!c && c.down === null);
      if (up && !c) theirs.set(id, make(0, CANOPIES[[...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % CANOPIES.length]));
      else if (!up && c && c.down === null) c.down = 0;
    }
    for (const [id, c] of theirs) {
      const r = remotes.get(id);
      if (!r) c.down ??= 0;
      const at = r ? r.person.root.position : c.holder.position;
      if (!step(c, dt, at, r ? r.person.root.rotation.y : c.holder.rotation.y, !!r?.moving)) theirs.delete(id);
    }
  });

  return {
    /** Whether a chute is open over you now. */
    open: () => !!mine && mine.down === null,
  };
}
