# VR (Meta Quest)

Back to the [README](../README.md).

The office in a VR headset: open it in a Meta Quest's browser, press **🥽 Enter VR**, and you're standing in it at your real height, with your hands on the controllers and every window floating in front of you as a panel you point at and click. Nobody has to take the headset off to read a terminal, type in the chat or change a setting. It's built for the Quest 2, and works on the Quest 3 and Pro too.

On a computer nothing changes: the button only appears where the browser says a VR headset is there, and none of VR's code loads until someone presses it, save the little that shows someone else in VR: other people see whoever is in VR turn their head and move their hands, with a headset on their character's face, on a screen as well as in a headset.

## Getting the Quest to the office

WebXR only works on a secure page, so the headset has to open the office over HTTPS (or `localhost`). The office on the Mac Studio is already on the tailnet at `https://fridays-mac-studio.taile67280.ts.net:11443`, with a real certificate, so the Quest needs to join the tailnet. There's no Tailscale app in the Quest store, but Tailscale's own Android app runs on it.

### Tailscale on the Quest (recommended)

1. **Developer mode** (once). Join or create a developer organisation at [developers.meta.com](https://developers.meta.com/horizon/documentation/native/android/mobile-device-setup/) and verify the account. In the Meta Horizon phone app: the headset icon → your Quest 2 → Headset Settings → Developer Mode → on.
2. **Connect it to the Mac.** Install [Meta Quest Developer Hub](https://developers.meta.com/horizon/documentation/native/android/ts-mqdh-getting-started/), or `brew install --cask android-platform-tools` for `adb`. Plug the Quest in with a USB-C data cable and, in the headset, allow USB debugging (*Always allow from this computer*).
3. **Get the official APK** from [pkgs.tailscale.com/stable](https://pkgs.tailscale.com/stable/) (Android, `tailscale-android-universal-<version>.apk`), never a mirror. It doesn't update itself: install a newer one the same way.
4. **Install it**: drag it onto MQDH → Device Manager → Apps, or `adb install -r tailscale-android-universal-*.apk`. It's under Library → **Unknown Sources**, not the main grid.
5. **Prepare the tailnet** in the Tailscale admin console. In Access controls, add `"tagOwners": {"tag:quest": ["autogroup:admin"]}` and a grant `{"src": ["tag:quest"], "dst": ["100.89.238.46"], "ip": ["tcp:11443"]}` (the Mac Studio, the office's port). Then Settings → Keys → Generate auth key: not reusable, 1 day, pre-approved, tagged `tag:quest`, not ephemeral (the headset sleeps). A tag-only grant only confines the headset if the policy's default allow-all rule is narrowed too (its `src` to `autogroup:member`, once nothing else relies on it). If voice from the headset then fails, widen the grant for WebRTC.
6. **Sign in on the headset**: Unknown Sources → Tailscale → Get Started, allow the VPN, then the menu (top right) → *Use an auth key*. Typing it on the Quest's keyboard is tedious: with the cable in and the field focused, run `adb shell input text '<key>'` on the Mac yourself (the key is a secret: keep it out of chats and notes). The app should say Connected, and the admin console's Machines page should list the headset with `tag:quest`.
7. **Open the office** in the Quest Browser: `https://fridays-mac-studio.taile67280.ts.net:11443`, sign in, bookmark it. If the name doesn't resolve, turn on *Use Tailscale DNS* in the app (and off the browser's secure DNS). Never use `https://100.89.238.46:11443`: the certificate won't match, the page isn't secure, and WebXR stays off.

### Without Tailscale (tethered, for testing)

With developer mode on and the cable in, `adb reverse tcp:8080 tcp:8080` makes the headset's `localhost:8080` the Mac's, and `localhost` counts as secure. Forward that to the office's plain HTTP port on the Mac Studio (`ssh -L 8080:localhost:<office port> fridays-mac-studio`) and open `http://localhost:8080` on the Quest. The same cable gives remote DevTools at `chrome://inspect/#devices`, which is where frame times are measured.

Don't use Tailscale Funnel for this: it puts the office, and its agents with shell access, on the public internet behind one password.

## Going into VR

1. Open the office in the Quest Browser and sign in. Join voice first if you want it (the microphone prompt can't show inside VR).
2. Point at **🥽 Enter VR** (bottom right) and pull the trigger, or use the browser's own Enter VR by the address bar. The first time, allow *immersive* for the site.
3. Stand where you like: your height comes from the headset's floor. A floor the headset has wrong (or playing seated) is what the height pref is for.
4. To leave: both sticks clicked → **Leave VR**, or the Meta button → quit. The 2D page is just as you left it.

## Controls

| Control | Does |
| --- | --- |
| Left stick | Walk where you look (as far as you push it); click it to run. On the ladder, a pole or in a car it's W A S D |
| Right stick ← / → | Turn 30° (45° in the prefs), once per flick |
| Right stick ↑ / ↓ | Scroll the panel you point at |
| Trigger | On a panel: click there. Anywhere else: exactly what **E** does, at what that hand points at (held as long as the trigger is, so the basketball winds up) |
| Grip | Jump, or get up from a seat. On a panel: take hold of it to move it (the stick pushes and pulls it) |
| B / Y | Back: closes the top window as **Esc** does (one that won't close by Esc stays), else hides the keyboard, else the HUD sheet |
| X | The HUD sheet: the ☰ menu (and from it settings), people, workers, chat and the floor menu |
| A | The keyboard. Held in a field that has a 🎤: push to talk |
| Both sticks clicked | The perf overlay: the numbers, a button for each quality knob, and Leave VR |

### With one controller

If only one controller is there (a flat battery, a broken one, one put down for a while), after a second and a half its jobs move over to the one you have, and the hint strip says so:

| Control | Does |
| --- | --- |
| Stick ↑ / ↓ | Walk forward or back the way you look (no sidestep); click it in to run. On a panel its ray points at, it scrolls the panel instead |
| Stick flicked ← / → | Turn 30° (45° in the prefs), once per flick |
| Trigger, grip | As with two |
| B (Y on a left one), tapped | Back, as **Esc** does |
| B (Y), held half a second | The HUD sheet: the ☰ menu, people, workers, chat and the floor menu |
| A (X) | The keyboard; held in a field with a 🎤, push to talk |
| Stick clicked in and held | The perf overlay and Leave VR |

When the other controller comes back, both work as above again.

Walking about the room for real moves you in the office too; a wall stops you, and if you lean through it the view is pushed back out. The golf tee, the darts, the axe lane and the telescope fly the camera about, so in VR they say *Not in VR yet*.

## Windows

Every window is a panel drawn from the live page: the office paints what the page has laid out (backgrounds, borders, text, pictures, form fields with what's in them) into a texture, a slice of time each frame, and only the parts that changed. Pointing and pulling the trigger sends the page real pointer, mouse and click events at that spot, so everything works the way it does with a mouse.

- **A window** floats about a metre ahead at a little under eye height and stays where it is, coming back in front of you if you look well away for a moment, walk off or ride the elevator, sit down right in front of it, or another window opens on top. Grip it to move it.
- **A full-screen window** (the office builder, a big workspace) is a sheet 1.8 m wide; where the page is see-through the ray goes on into the office, so the builder's floor can still be dragged on.
- **The HUD sheet** (X) is everything that floats over the office on a screen: the ☰ menu, people, workers, chat and pop-ups.
- **The hint strip** hangs low ahead of you with the newest toasts. Its key chips say what to press in VR (*Trigger*, *Grip*, *B*), and each can be tapped, so P, R, X, C, O, L and U at a desk need no keyboard.
- **The keyboard** comes up when a text field takes focus, with a terminal row (Esc, Tab, Ctrl, the arrows) in a terminal. With nothing focused its keys go to the office (T, G, N, 1–6).

A `<select>` opens a list in VR; a file, colour or date picker can't open in VR and says so; a link out of the office is kept until you leave VR.

## Other people

While you're in VR the office sends where your head is turned from your body and where your hands are, ten times a second at most and at least once a second (`vr.pose`, in `shared/protocol/vr.ts`). Everyone on your floor sees your character wear a headset, turn and tilt its head with yours and reach where your hands are; your body turns after your head only when you look well round or walk, as a person's does. Nobody keeps any of it: whoever arrives has the next pose within a second, and a pose that stops coming is let go of.

## How hard it works the headset

three.js's WebGL renderer draws each eye as a pass of its own, so VR doubles the draw calls, and the toon outline would double them again. The Quest 2 has about 13.7 ms a frame at 72 Hz, and Meta's budget for a native app there is about a hundred draw calls and 750k triangles a frame. So each headset gets a profile (`features/vr/quality-profile.ts`), picked from the browser's user agent: one for VR, and one for the headset browser's own page outside VR (its flat page: the office in a window floating in the headset, drawn once rather than for two eyes, but by the same GPU and CPU). A laptop gets neither, and draws the office exactly as it always has.

| Knob | Quest 2 VR | Quest 3 / Pro VR | Other headsets in VR | Quest 2 page | Quest 3 / Pro page |
| --- | --- | --- | --- | --- | --- |
| Toon outline | off | on | off | off | off |
| Resolution | 0.8 framebuffer scale | 1 | 1 | pixel ratio 1 | pixel ratio 1 |
| Foveation | 1 (most) | 0.5 | 0.5 | | |
| Frame rate | 72 Hz | 72 Hz | the headset's | | |
| Sun's shadows | 1024², drawn 4 times a second | 2048², 10 times a second | 2048², 10 times a second | 1024², 4 times a second | 2048², 10 times a second |
| Night halos | off | on | on | off | on |
| Lamps lighting the toon shaders | all 24 | all 24 | all 24 | all 24 | all 24 |
| Video, TV, screens, arcade uploads | 10 a second at most | 15 | 15 | 10 | 15 |
| Scenery drawn out to | 0.6 of the haze | 0.8 | 0.8 | 0.6 | 0.8 |
| The still office batched | yes | yes | yes | yes | yes |
| Pictures on the walls at most | 512 px | 1024 px | 1024 px | 512 px | 1024 px |
| Panel texture | 1.5 px per CSS px | 1.5 | 1.5 | | |

Profiles stack: on a Quest the page's profile is on from the moment it loads, VR's goes over it while you're in VR, and the page's is back as you leave (`quality.ts`). The Quest 2's values are where measuring starts, not where it ends: each stays or changes on numbers measured in the headset. Every knob can be flipped live in the perf overlay (both sticks clicked) for an A/B on the spot, and the resolution, which a session can't change, is kept for next time. Switching shadows off outright recompiles every material once, which is why the profiles throttle them instead. YouTube screens show their poster in VR (an embedded player can't be drawn into the headset's eyes) and keep playing their sound.

### The still office, batched

A floor is two to three thousand meshes, and most never move: walls, floors, desks, chairs, shelves, plants, the street. Drawn one by one they're thousands of draw calls a frame, each of them CPU time three.js and the browser spend before the GPU sees anything, and on a Quest 2 that's most of the frame. With batching on (`world/batch`), the meshes that keep still are drawn as merged meshes instead, a region and a kind at a time: a cell of the building 8 m across and a storey high, so what's out of view is still left out, and one kind per draw (every plain-coloured lit surface in a cell as one mesh, its colours kept in its vertices; anything with a picture with its own material), each keeping whether it casts and takes shadows. What's see-through, a sprite or a line, skinned or instanced, drawn in an order of its own or with a hook of its own is never batched.

Nothing else has to know. Batching starts once a floor's world is built: the batcher watches every mesh for a second and a half and batches those that kept still, a few batches a frame. A batched mesh stays where it was, so whatever picks things with a ray (E, the VR trigger, the builder, a picture being hung) finds it as before: only the cameras that draw the office pass it by. Every frame, just before the office is drawn, the batcher checks each batched mesh is where it was and as it was; one that's moved, been hidden or changed draws itself again from that frame on (a door opening, the ball picked up), and its batch is merged again without it. It starts over on another floor, when the floor's layout, furniture or room change, and up on the roof, and holds off while the office builder is open.

A laptop or a desktop batches too, from the moment it loads (`features/perf`, see Drawing fast in [the code layout](code-layout.md)), since a floor's thousand to three thousand draw calls were most of its frame as well. Merged meshes are drawn in another order and with their positions worked out on the CPU, which moves a pixel here and there where two surfaces meet, and the outline of a mesh stretched unevenly comes out a little different; side by side from the same spots at the same hour, under a tenth of a percent of the pixels outside and a few percent inside (mostly people who'd moved) differ. `?batch=0` in the address leaves it off, to compare. A VR session's profile puts batching back as it found it when it comes off.

### Loading

The office's first load is smaller: the terminal window (xterm), an agent's conversation and workspace, the PR and issue windows (marked and DOMPurify) and the bookshelf each load the first time they open, a third of a megabyte of JavaScript less before the office is up. While the loading screen is up the floor's shaders are compiled (`warmShaders` in `core/scene.ts`), side by side where the browser can, so the first steps don't stall on each one as it comes into view. The pictures on the walls are at most 512 px across on a Quest 2.

The perf overlay shows frames a second and the share of late frames (from the headset's own frame times), the page's CPU time per frame (median and p95), the GPU's time where the browser can measure it, draw calls, triangles, shader programs, textures and how long the panels took to paint. It keeps the last ten minutes, a sample a second, in `window.__vr.perf.samples`.

## Measuring

Two scripts drive the office in headless Chrome with [Meta's WebXR emulator](https://github.com/meta-quest/immersive-web-emulation-runtime) (`iwer`, pinned at 2.5.0 as a devDependency and loaded only by them; `tests/vr-structure.test.ts` fails if anything under `src/` imports it) standing in for a Quest 2. Each builds nothing and starts its own office on a port of its own (14671 by default, never 4600 or 5173) in a throwaway folder:

```bash
npm run build:client
node --import tsx tests/support/vr-browser.mjs                # every scenario; or name some: enter walk stick snap
VR_LAYERS=1 node --import tsx tests/support/vr-browser.mjs    # again, with the WebXR layers polyfill (the Quest has projection layers)
node --import tsx tests/support/vr-perf.mjs                   # the numbers below, as Markdown and JSON
node --import tsx tests/support/vr-perf.mjs --base http://127.0.0.1:14672   # and the desktop against another build (the base branch's)
node --import tsx tests/support/floors-perf.mjs --building <dir>             # every floor's spots, laptop, Quest page and VR, startup, census
node --import tsx tests/support/floors-check.mjs --building <dir>            # seat, elevator, ball, builder, and batched against unbatched
node --import tsx tests/support/floors-compare.mjs --building <dir> --base <dist/public of another build>   # a laptop's office, before and after
```

The three `floors-` scripts take a building to measure in (`--building`: a `floors.json` of `{ id, name, palette }` and a folder per floor holding its `.agent-office`, copied into a throwaway office so nothing writes to it), and `floors-perf.mjs --public <dir>` serves another build, so the same run measures before and after. `floors-perf.mjs` stands at the desks and in the lounge of every floor, on the street and up on the roof; measures a laptop's page, the Quest 2 browser's flat page (by its user agent) and VR, at 1× and 4× CPU throttling; times the office coming up at 4×; and takes a census of the draw calls, by part of the scene and by the module that built them (with a build that has source maps, `npx vite build --sourcemap`). `VR_PUBLIC` runs `vr-browser.mjs`'s scenarios against another build too.

The scenarios: no button on a computer with no headset; Enter VR gives the Quest 2 profile; your eyes 1.7 m over your feet with the headset at 1.7 m, and your view turning with your head; walking the headset half a metre moves your feet as far, and walking it into a wall keeps your head over them; the left stick walks at 4.6 m/s; one snap turn a flick; the grip jumps; the trigger at the elevator opens its window as a panel, a ray click lands on its button and B closes it; X, then ☰, then Settings and a checkbox, all by the ray; *hi* typed on the VR keyboard goes out in the chat; a shell takes typed text and Ctrl+C; the trigger sits you down and the grip gets you up; the arcade cabinet leaves your head where it is; a desktop page sees your head turn and a headset on your character; the lights go down on an elevator ride; and leaving VR gives the browser its frames back, with the scene and the renderer as they were.

`IWER_JS` points them at `iwer/build/iwer.min.js` if it isn't in `node_modules`, `CHROME_PATH` at a browser, and `VR_SHOTS` / `VR_OUT` say where screenshots and results go (`/tmp/vr-shots`, `/tmp/vr-perf`).

iwer 2.5.0 reads `getOffsetReferenceSpace`'s transform as if it were a matrix, so poses through the rig's offset space come out in the room's own space and you never move; the scripts hand it the transform's matrix (a headset's browser reads the transform itself). It also puts the canvas back last in its parent when a session ends, over the HUD; leaving VR puts it back where it was.

Emulated numbers count draw calls, triangles, programs and textures exactly, and CPU time roughly (4× CPU throttling stands in for the Quest 2's CPU); software rendering says nothing about the Quest's GPU. Real frame rates, late frames and GPU time come only from the overlay in the headset.

| Spot (emulated, per frame) | Desktop | VR, every knob up (both eyes) | VR, Quest 2 profile (both eyes) |
| --- | --- | --- | --- |
| Floor 1, lounge by day: draw calls / triangles | 1337 / 255k | 1909 / 399k | 552 / 120k |
| Floor 2, desks at night: draw calls / triangles | 1269 / 254k | 1792 / 410k | 496 / 137k |
| Floor 3, lounge by day: draw calls / triangles | 1301 / 277k | 1896 / 474k | 592 / 165k |
| Outside, the street by day: draw calls / triangles | 1872 / 318k | 2673 / 510k | 958 / 183k |
| CPU ms a frame, 1× / 4× throttled (range over the four spots) | 10–19 / 44–122 | 12–22 / 60–110 | 8–16 / 40–68 |

Measured on 4 October 2026 in headless Chrome on an Apple M5 Max (Metal, iwer's Quest 2, 0.8 resolution), with the machine busy with other work, so the CPU times are rough; the counts are exact. The Quest 2 profile draws fewer calls than a desktop because it has no outline pass and redraws the shadows only every 250 ms. At 4× throttling a VR frame's CPU is about half drawing both eyes and half the rest of the office's frame (the lounge: 17 ms drawing, 22 ms the rest; the street: 26 and 18), so if the Quest 2's CPU is anything like 4× slower than the Mac's, both halves need to come down for 72 fps (13.9 ms a frame). Targets to confirm in the headset: a steady 72 fps in the lounge by day, under 5% late frames with a terminal streaming, and the page's CPU at or under 8 ms.

## Only in the headset

The emulator can't say these; they're for checking on the Quest:

- frame rate and late frames at each spot, and every knob's A/B, from the overlay; the GPU's time;
- whether 0.8 resolution is sharp enough to read the panels;
- whether the Quest Browser keeps the page visible in VR (videos pause on a hidden page), and lets focus and typing reach the page;
- whether it has speech recognition (expected not: the 🎤 doesn't show where the browser can't listen);
- the hands' fit on the controllers, your height standing and sitting, and how the turning feels;
- that links kept for later open once you leave VR;
- that the tailnet's name resolves on the Quest, and voice still works under the restricted grant.

## How it's put together

`features/vr/` is a feature like any other, with one line in `main.ts` (`installVr`, right after the frame loop is made, which a session borrows):

- `index.ts` puts up the button where a headset is (`button.ts`), and loads the rest when you press it; `session.ts` is that rest, in a chunk of its own: it starts each part below in the order their ticks run, and on leaving undoes them in reverse and hands the frame loop back. `types.ts` is what the parts hand each other.
- `rig.ts` (with `rig-math.ts`, pure) reads the headset in an offset of its floor space, so the camera and the controllers come out in the office's own coordinates; `locomotion.ts` the sticks; `fade.ts` the elevator's lights going down.
- `controllers.ts`, `input-map.ts` (pure), `keys.ts`, `keys-table.ts`, `interact.ts` and `hands.ts`: the buttons, what they do and your hands on the controllers.
- `panels/`: the painter, the bridge from a ray to the page's events, the panels and the keyboard.
- `presence.ts` sends your head and hands, and `remote.ts` (loaded with the first pose anyone on your floor sends, on a computer too) shows other people's. The message is `shared/protocol/vr.ts`, cleaned by `shared/vr-pose.ts` and passed on by `server/ws/handlers/vr.ts`.
- `quality-profile.ts` (pure) and `quality.ts`: the profile and its knobs; `perf.ts`: the numbers and the overlay.

The seams it needs elsewhere each default to how things were: the frame loop's `xr` (`core/frame-loop.ts`), a view effect's `takeover` (`core/registry.ts`), the player's `stick` (`player/index.ts`), the pointer's `setAim` (`input/pointer.ts`) and the hands' `mount` (`world/hands.ts`). The unit tests are `tests/vr-*.test.ts`.

## Not yet

- The golf tee, the darts, the axe lane and the telescope (they fly the camera).
- Dictation where the browser has no speech recognition (likely the Quest's): recording on the headset and transcribing on the office would send the audio to OpenAI, which is Tyler's call, so it isn't built.
- Hand tracking (the controllers only), and the smoke and the toast poses are approximate in VR.
