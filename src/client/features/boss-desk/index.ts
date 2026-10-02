/**
 * The boss's desk, up in the loft: sit in the boss's chair and the desk's menu opens (share your
 * screen, or play a game on the monitor); sit in one of the two chairs across it and you're meeting
 * with whoever's there. A second monitor faces the guests and shows what the boss's does (screens.ts),
 * E from a guest's chair brings that up big, and whoever sits down second is put on a call with the
 * other side. Who counts as at the desk, and the rules, are desk.ts; the chairs and the guests'
 * monitor are world.ts; the windows are ui.ts.
 */
import type { Ctx } from '../../core/context';
import { isTyping } from '../../player';
import { store } from '../../state';
import { doingNow, h, toast, type Modal } from '../../ui/dom';
import type { Arcade } from '../arcade/ui';
import { across, callKey, callSettled, deskCard, deskPeople, deskRole, deskSeat, hasBossDesk, mirrorWanted, recall, remember, type DeskRole, type ShareKind } from './desk';
import { deskScreens } from './screens';
import { callStrip, openDeskMenu, openDeskViewer, type CallPerson } from './ui';

export interface BossDeskDeps {
  /** The games on the boss's monitor (see features/arcade). */
  arcade: Arcade;
}

/** What a seat at the desk is to features/seating: what its hint says, and what E does once you're in it. */
export interface DeskSeat {
  note: string;
  use?: { label: string; run(): void };
}

/** Registers the desk's ticks ('me', and the monitors' 'world'), and listens for V and M (captured) while one of its windows is open. */
export function installBossDesk(ctx: Ctx, deps: BossDeskDeps): { seat(seatId: string): DeskSeat | null } {
  const { voice, player } = ctx;
  const { arcade } = deps;

  /** Who's at the desk on your floor, you included, as of this frame. */
  let at: { boss: CallPerson | null; guests: CallPerson[] } = { boss: null, guests: [] };
  /** The side of the desk you're sitting on. */
  let role: DeskRole | null = null;
  /** The share of yours the desk started, which getting up stops: your screen from the menu, or the game for your guests. */
  let kind: ShareKind | null = null;
  /** The browser's asking which screen to share. */
  let asking = false;
  /** You joined voice at the desk, with someone across it: getting up leaves it again. */
  let joined = false;
  let inVoice = false;
  let menu: Modal | null = null;
  let viewer: ReturnType<typeof openDeskViewer> | null = null;
  /** Who was across from you a frame ago, and whether the boss's screen had reached you. */
  let faces = new Set<string>();
  let hadScreen = false;
  /** Who's across the desk and on the call (see callKey), and when that last changed. */
  let guests = '';
  let guestsChanged = 0;

  const screens = deskScreens(ctx, () => at);

  /** Everyone on your floor, you first: your own entry among the peers isn't kept up to date, so you're as you are here. */
  function everyone(): CallPerson[] {
    const out: CallPerson[] = [{ id: store.you, name: store.profile.name, seat: player.seat?.key, sharing: voice.sharing, doing: doingNow(), voice: voice.inVoice, muted: voice.muted }];
    for (const p of store.peers.values()) if (p.id !== store.you && store.onMyFloor(p)) out.push(p);
    return out;
  }

  /** The call strip, for a window of the desk's or the game's bar. */
  const strip = () => callStrip(voice, () => [...(at.boss ? [at.boss] : []), ...at.guests], () => void join());

  /** Joins voice from one of the desk's windows, as V does in the office. */
  async function join() {
    const err = await voice.joinVoice(ctx.settings.pushToTalk);
    if (err) toast(err, 'warn');
    else if (ctx.settings.pushToTalk && voice.inVoice) toast('🎙️ In voice, muted: hold V to talk');
  }

  /** Sat down with someone already across the desk: you're on a call with them. */
  async function call(who: string) {
    const err = await voice.joinVoice(ctx.settings.pushToTalk);
    if (err) return void toast(err, 'warn');
    if (!voice.inVoice) return;
    // Up again before the browser had its answer about the mic.
    if (!role) return voice.leaveVoice();
    joined = true;
    toast(ctx.settings.pushToTalk ? `🎙️ On a call with ${who}, muted: hold V to talk` : `🎙️ On a call with ${who} · M mutes`);
  }

  /** From the menu's own click, which is what lets the browser ask which screen. */
  async function share() {
    if (asking) return;
    // The game that was going out to your guests makes way.
    if (kind === 'game') {
      voice.stopShare();
      kind = null;
    }
    if (voice.sharing) return;
    asking = true;
    const asked = voice.startShare();
    menu?.close();
    const err = await asked;
    asking = false;
    if (err) return void toast(err, 'warn');
    // Nothing picked: nothing changes.
    if (!voice.sharing) return;
    // Up again before the browser had its answer.
    if (role !== 'boss') return voice.stopShare();
    kind = 'screen';
    remember('share');
    toast('🖥️ Your screen is up on both monitors. Get up to stop sharing.');
  }

  /**
   * The game on your monitor goes out to whoever's sitting across from you as a share, for as long as
   * they sit there and it's open (see mirrorWanted): that's what puts it on the monitor facing them.
   */
  function mirror() {
    const want = mirrorWanted({ role, playing: !!arcade.playing, guests: at.guests.length, sharing: voice.sharing || asking, kind });
    if (want && kind !== 'game') {
      // Someone has just sat down and is being put on the call: the game goes out once that has connected.
      if (!callSettled(guestsChanged, performance.now())) return;
      // A browser that can't send a canvas on: the game stays yours alone.
      if (typeof arcade.picture.captureStream !== 'function') return;
      void voice.startShare(arcade.picture.captureStream(15));
      if (voice.sharing) kind = 'game';
    } else if (!want && kind === 'game') {
      voice.stopShare();
      kind = null;
    }
  }

  function play(id: string) {
    remember(id);
    menu?.close();
    const games = h('button.btn', { type: 'button', title: 'Back to your desk’s menu' }, '🎮 Games');
    games.addEventListener('click', () => {
      arcade.stop();
      openMenu();
    });
    arcade.play(id, [games, strip()]);
  }

  function openMenu() {
    if (menu || role !== 'boss') return;
    // With the game put down, it stops going out, so the menu says what's really up.
    mirror();
    menu = openDeskMenu({
      games: arcade.games,
      last: recall(),
      sharing: voice.sharing,
      strip: strip(),
      share: () => void share(),
      stopShare: () => {
        voice.stopShare();
        kind = null;
      },
      play,
      onClose: () => (menu = null),
    });
  }

  function openViewer() {
    const boss = at.boss;
    if (viewer || role !== 'guest' || !boss) return;
    viewer = openDeskViewer({ who: boss.name, strip: strip(), onClose: () => (viewer = null) });
    const screen = screens.stream();
    viewer.show(screen, deskCard(boss, !!boss.sharing));
  }

  /** You sat down at the desk. */
  function sat(as: DeskRole) {
    const others = across(as, at, store.you);
    faces = new Set(others.map((p) => p.id));
    const screen = screens.stream();
    hadScreen = !!screen;
    // Whoever sits down second is put on the call; whoever was there first is told, and joins with V.
    if (others.length && !voice.inVoice) void call(others[0].name);
    if (as === 'boss') openMenu();
    // As the couch does with the TV: their screen's up already, so that's what you sat down to.
    else if (screen) openViewer();
  }

  /** You're up from the desk (or it's gone from under you): everything the desk started stops. */
  function left(was: DeskRole) {
    menu?.close();
    viewer?.modal.close();
    if (was === 'boss') arcade.stop();
    if (kind) voice.stopShare();
    kind = null;
    if (joined && voice.inVoice) {
      voice.leaveVoice();
      toast('🎙️ Left the call');
    }
    joined = false;
  }

  ctx.ticks.add('me', () => {
    const there = ctx.inOffice() && !ctx.upTop() && hasBossDesk(ctx.office.room.get());
    at = there ? deskPeople(everyone()) : { boss: null, guests: [] };
    const key = callKey(at.guests);
    if (key !== guests) {
      guests = key;
      guestsChanged = performance.now();
    }
    const now = there ? deskRole(player.seat?.key) : null;
    if (now !== role) {
      const was = role;
      role = now;
      if (was) left(was);
      if (now) sat(now);
    }
    // A share of yours that ended some other way (the browser's own Stop sharing) isn't the desk's any more.
    if (kind && !voice.sharing) kind = null;
    mirror();
    if (!voice.inVoice) joined = false;
    if (!role) return void (inVoice = voice.inVoice);

    const others = across(role, at, store.you);
    // Joined while someone's across from you (V, or the strip's button): that's the desk's call too.
    if (voice.inVoice && !inVoice && others.length) joined = true;
    inVoice = voice.inVoice;
    for (const p of others) {
      if (faces.has(p.id)) continue;
      toast(voice.inVoice ? `👋 ${p.name} joined you at the desk` : `👋 ${p.name} sat down across from you · V to talk`);
      ctx.hint.invalidate();
    }
    faces = new Set(others.map((p) => p.id));

    if (role !== 'guest') return;
    const screen = screens.stream();
    if (screen && !hadScreen && !viewer && at.boss) toast(`🖥️ ${at.boss.name}'s screen is up · E to watch`);
    hadScreen = !!screen;
    if (!viewer) return;
    if (at.boss) return viewer.show(screen, deskCard(at.boss, !!at.boss.sharing));
    // The boss got up: there's nobody to watch, or to be on a call with.
    viewer.modal.close();
    toast('👑 The boss got up from the desk');
  });

  // A window being open keeps the office's own keys from running (see installKeyGuards), and the call
  // goes on with the desk's windows open: V and M do there what they do in the office.
  window.addEventListener(
    'keydown',
    (e) => {
      if (!role || !(menu || viewer || arcade.playing)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      if (e.code !== 'KeyV' && e.code !== 'KeyM') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.code === 'KeyM') voice.toggleMute();
      else if (voice.inVoice) voice.startTalking();
      else void join();
    },
    true,
  );

  return {
    seat(seatId) {
      const side = deskSeat(seatId);
      if (!side) return null;
      if (side === 'boss') return { note: '👑 share your screen or play a game', use: { label: 'Desk menu', run: openMenu } };
      const boss = at.boss;
      if (!boss) return { note: "across from the boss's desk" };
      return { note: `across from ${boss.name}`, use: { label: screens.stream() ? `Watch ${boss.name}'s screen` : `Call with ${boss.name}`, run: openViewer } };
    },
  };
}
