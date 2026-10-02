# Office builder

Back to the [README](../README.md).

Open **Menu → Office builder**, or press **U**, on an office floor. Building is for admins: the menu item and the key are only there for them, and the office refuses a layout saved by anyone else (see [Who can build](#who-can-build)). The castle and other custom maps keep their own layouts.

The camera goes up over the room with the ceiling off and the walls cut away, and you arrange the floor itself: pick something up, drag it across the floor, and let go. What you do is a draft that only you see until you **Save layout**; closing the builder (✕ or Esc) puts the room back as it's saved, after asking if there are changes to lose.

## What you can arrange

- **The workers' desks.** The room's 16 desks go anywhere there's floor for the desk and its chair. Each one stays on the floor (workers keep their desk ids), and a desk with a worker at it stays put until that worker is sent home.
- **Furniture.** Everything else that stands on the floor: the lounge's couch, table and poufs, the rugs, the plants, and whatever you add from [the catalog](#the-catalog) on the left.
- **What the office comes with.** The whiteboard, the jukebox, the arcade cabinet, the docs bookshelf and the gong move and turn like furniture, and the basketball hoop stays on its wall. There's one of each, so they can't be duplicated. A floor can go without one (*Remove from this floor*), and the catalog puts it back.
- **The room's paint.** Pick one of the floor palettes under *The room*, or *Own* for the floor's own color.
- **The room's fittings.** Under *The room → Fittings*: whether the floor has the mezzanine, and how many driving tees are out on its balcony (see [Room options](#room-options)).
- **The back office.** *Add 2 desks* and *Wall it up* knock the back office out or close it again. Unlike everything else these apply straight away.
- **Boards and agents.** *🪧 Set up the floor…* opens what the floor's wall boards are for, who stands at its kiosks, and the prices on its stock ticker (see [A floor's boards and agents](#a-floors-boards-and-agents)). It saves by itself, apart from the layout.

With a piece picked, the panel on the right sets its position, turns it, paints it (a swatch, or any color), sizes a plant, changes what a sign says, or names the one video a screen plays.

The room's walls, the meeting room, the kitchen, the wall boards, the TV, the board agents' kiosks, the elevator, the ladder and the fire pole stay where they are, and so do the loft and its stairs on a floor that has them. The builder keeps furniture off them and out of the doorways, and says why when something can't stand where you dropped it: it goes back where it was. Rugs lie under anything.

## The catalog

Down the left, in groups. Click a card to drop one in the middle of the view, or drag it out onto the floor. A floor holds up to 150 pieces.

| Group | What's in it |
| --- | --- |
| **Work** | Team desk, long table, podcast desk (two boom arms with mics, and a mixer), video screen and wall screen, stock ticker and market board, softbox light, camera on a tripod, backdrop |
| **Rooms** | Wall, glass wall and wood slat panel, each full length or short |
| **Seating** | Sofa, armchair, pouf, lounge chair, stool, floor cushion |
| **Tables** | Table, standing table, coffee table, credenza, side table |
| **Plants** | Monstera, snake plant, ficus, fiddle-leaf fig, palm, bird of paradise, pothos on a stand, planter box |
| **Play** | Trampoline, punching bag, vending machine, ping-pong table, foosball table, dance mat, prize wheel, high striker, and the office's jukebox, arcade cabinet and basketball hoop |
| **Decor** | Rugs in four shapes, divider, bookcase, floor lamp, sign, neon sign, and the office's whiteboard, docs bookshelf and gong |

A few notes on particular pieces:

- **Rooms.** The walls are all 2.6 m tall with square-cut ends, so a row of them tiles end to end: that's how a floor gets a studio, a booth or an office of its own. A wall takes paint (its skirting and cap come out a shade of it). A glass wall is a steel frame three panes high, in the piece's color. A wood slat panel has slats on both faces, at a pitch that carries across the joins.
- **Plants.** Every plant but the planter box comes in sizes. You bump into the planter, not the leaves. The planter box is planted end to end, with vines over its front only: its back is clear, so it can stand against a wall.
- **Neon sign.** It hangs at head height at the front of its footprint, so on the same spot as a wall or a wood panel it lies on that wall's face. Its words and its color are the piece's.
- **Softbox.** Its face glows in the piece's color.
- **Stool.** It's bar height, so it suits the standing table rather than the long table or the podcast desk.
- **Stock ticker, neon sign.** They hang from the ceiling on wires, so under the loft they poke through its floor. The high striker is 2.7 m tall and does the same.

## Room options

Each floor has two fittings of its own, under *The room → Fittings*. They're part of the draft, and saved with the layout (`room` in the floor's `floorplan.json`; only what differs from the office as it comes is written).

### Mezzanine, or one level

A floor is either **Mezzanine** (the boss's loft on its posts in the south-east corner, with the stairs along the south wall) or **One level**. The office comes with the mezzanine.

On a one-level floor:

- The loft, its posts, its stairs, its glass and roof, and everything upstairs (the boss's desk, chair and monitor, the couch, the telescope, the plants, the lamp, the signs) are gone. Nothing is drawn, nothing is in the way, and there's nothing to use or sit on up there. Minesweeper on the boss's monitor isn't reachable on that floor.
- The floor where the stairs stood is floor like any other: you walk across it, furniture and desks can stand on it, and workers and the dog route over it.
- The meeting room stays, since meetings need it. With no loft over it, it's a glass room open to the ceiling: a slim rail caps the glass along both walls and over the door, and two slim beams cross it carrying the lights over the table.
- Nobody can sit on the loft's couch or the boss's chair: the office refuses those two seats on that floor.
- Anyone up in the loft, on its stairs, or sitting up there when the floor is saved one-level is put down on the floor below. The same happens if you switch from the floor list onto a one-level floor while standing at loft height.

Switching back to **Mezzanine** is refused while anything stands where the stairs go, in the builder and again by the office when it saves: *Clear the floor for the mezzanine first: Sofa is in the way of the stairs*. Move or remove the piece, then switch. If you're standing where the stairs go when the mezzanine comes back, you step out of them.

### One tee, or two

**1 tee** is the balcony as it comes: the tee next to the ashtray, and the bistro table with its two stools. **2 tees** adds a second bay east of the balcony doors, with its own bag of clubs, and puts the bistro table and its stools away to make room (anyone sitting on a stool is stood up). With two, one person is on each and both can swing at once; see [Features](features.md).

## Team desks

A **team desk** is a desk for a person rather than a worker: a desk with a monitor and a chair. Walk up and press **E** to sit down. Sitting down shares your screen (the browser asks which window or screen, as it always does), and it goes up on the desk's monitor for everyone on the floor, as well as on the lounge TV and the shares strip. Getting up stops sharing. If you were already sharing when you sat down, that share carries on and is yours to stop.

Sofas, armchairs, poufs, lounge chairs, stools and floor cushions you add are seats too.

## Video screens

A floor's screens play that floor's own videos on a loop. There are two kinds in the **Work** group: **Video screen** (on a studio cart) and **Wall screen** (hung at eye level; push it up against a wall, holding **Alt** while dragging to get it flush).

### Putting videos up

Drop files into the floor's media folder on the office's machine:

```
<floor folder>/.agent-office/media
```

Nothing needs reloading. The office looks in the folder when you arrive on the floor, when a screen is put up, and about once a minute after that. A screen with nothing to play shows a card with the folder's path.

- **Formats.** MP4 (H.264) and WebM play in every browser. MOV plays when it has H.264 inside; ProRes and HEVC exports don't play in Chrome, so export those as MP4. A file that won't play is skipped; if none will, the screen says which.
- **Names.** Plain file names only (letters, numbers, spaces, dots, dashes, underscores, brackets). Files play in alphabetical order, so `01-…`, `02-…` sets the order.
- **Size.** 1080p is plenty. Anything over 1920 px on its long side is drawn down before it reaches the graphics card, but the browser still has to decode it at full size.

### What each screen plays

- By default a screen plays every video in the folder in turn. Each screen starts on a different one, so two side by side don't mirror each other; with more screens than videos, the ones sharing a file start at different points in it.
- To loop a single file, pick the screen in the builder and type the file's name under **Plays**. If that file isn't in the folder, the screen falls back to the whole folder.
- With no videos in the folder, screens show its pictures instead (PNG, JPG, WebP, GIF, SVG), ten seconds each. A screen whose **Plays** names a picture shows just that one.

### How it looks

- Video close to 16:9 fills the screen, with any overhang cropped evenly.
- Portrait reels, square video, and anything that would lose more than about 30% to cropping are shown whole in the middle, with a blurred, dimmed copy filling the rest. Nothing is stretched.
- Screens are silent on the floor. Look at one (or stand in front of it in third person): the hint shows the file's name, and **E** opens it in a window with sound and the browser's controls, starting from where the screen was. ✕ or Esc closes it and puts you back in mouse-look.

Each browser plays its own copy; playback isn't synchronised between people. A screen is paused while it's out of view, while you're on the roof or another map, and while the tab is hidden. Its video is released when the screen is taken away or you leave the floor.

## Stock ticker and market board

A floor's live prices show only where the floor has a piece for them. Both are in the **Work** group:

- **Stock ticker**: a 6 m LED bar hung from the ceiling at head height. The floor's prices slide along both of its faces, each reading left to right: symbol, price, then a green up arrow or a red down arrow with the percentage moved since the last close. Nothing collides with it, so it can hang over desks or a walkway.
- **Market board**: a screen on a stand (1.6 m by 0.3 m of floor, about 1.5 m high) showing the same prices as a table: symbol, last price, change and % change, green or red, with the time they were read. It shows up to 8 rows at once and turns to the next page every 6 seconds when there are more. Its frame can be painted.

Which symbols they show is set per floor: **🪧 Set up the floor… → Ticker**. Enter symbols in order, separated by commas or spaces: stocks by their symbol, indexes like `^GSPC`, crypto like `BTC-USD` (up to 30). The office reads prices every minute.

- The big indexes show by name (`^GSPC` as S&P 500, `^DJI` as DOW, `^IXIC` as NASDAQ), and crypto without the `-USD`.
- With no symbols set, a ticker piece shows a dim *Add ticker symbols in the floor's setup*.
- With symbols set but neither piece on the floor, nothing is drawn (the office still reads the prices).
- While prices are being read, or if they can't be read, the pieces say so in the same dim line.

## Things to play with

The **Play** group (and the floor cushion under **Seating**) is furniture that does something. An admin stands the pieces wherever a floor wants them, so each floor can have its own; anyone on the floor can use them. What they do happens in your own browser only: nobody else sees your bag swing or hears your wheel, and nothing is saved to the office apart from your best rally, which your browser remembers.

In first person, look at a piece to see its hint; in third person, walk up to its front.

| Piece | What it does |
| --- | --- |
| 🤸 Trampoline | Step or land on the mat and it throws you back up. Hold **Space** and each bounce is higher, up to about a third more than its own; let go and you come back down to it. |
| 🥊 Punching bag | **E** punches it. It swings away from you and settles, and punches in a row count up in the hint (🥊 x7) until you leave it alone for a couple of seconds. |
| 🥤 Vending machine | **E** drops a can into the tray: the same minute of quicker feet and higher jumps a coffee gives you. It takes four seconds to restock. |
| 🏓 Ping-pong table | **E** at the table's end starts a rally. The ball comes down the table and back, a little quicker each time; **Space** hits it back as it reaches you. Miss it, press **E** or walk away and the rally is over. |
| ⚽ Foosball table | **E** kicks off a point: the rods spin, the ball is knocked about and it ends in a goal for you or for them. First to five wins. |
| 🕺 Dance mat | Its nine tiles light up and play a note under your feet. Light all nine before the first fades and it throws a party. |
| 🎡 Prize wheel | **E** spins it. It clicks round under its flapper and says what it stopped on (a coffee run, a dance break, pizza…). |
| 🔔 High striker | Its meter runs up and down in the hint; **E** swings the mallet with whatever is on it. A full meter sends the puck all the way up to ring the bell. |
| 🧘 Floor cushion | **E** sits you down on it. |

Each piece can be painted: the trampoline's pad, the bag, the machine's cabinet, the table tops, the cushion, the mat's base, the wheel's rim and the striker's board take the color.

## A floor's boards and agents

*🪧 Set up the floor…* (under *The room → Boards and agents*) makes a floor a team's own place rather than a repository's. It suits a floor that's a folder (see *A floor per project* in [Features](features.md)), which has no GitHub issues or pull requests to show.

- **Wall boards.** Either of the two boards (where Issues and Pull Requests hang) can be a bulletin of the floor's own: an icon, a name (*Newsroom*, *Pipeline*) and a line about what goes on it. Its posts come from people and agents posting to it, from the latest in some Slack channels, or from how the socials are doing on Metricool.
- **Kiosk agents.** The agent at each of the three kiosks can be the floor's own: its name, the line on its card, and its brief (what it's told when it's hired, ahead of the first request). An agent on a floor with bulletin boards is told how to post to them with the `office-board` command.
- **Ticker.** The symbols the floor's stock ticker and market board show.
- **Connections.** Signing the office in to Slack (a Slack app's bot token) and Metricool (its API token, your userId and the brand's blogId), for the boards the office fills by itself, on every floor. The tokens stay on the office's machine and are never shown back.

**Save for this floor** applies it to everyone there. It's kept per floor in `.agent-office/studio.json`.

## Controls

| | |
| --- | --- |
| Drag a desk or a piece | Move it, a quarter meter at a time (hold **Alt** for 5 cm) |
| Drag the floor | Slide the view |
| Right-drag, or **Shift** + drag | Turn and tilt the view |
| Scroll | Zoom |
| **W A S D**, **Q E**, **+ −** | Slide, turn and zoom the view from the keyboard |
| **R** / **Shift R** | Turn what's picked a quarter turn (round things an eighth) |
| Arrow keys | Nudge what's picked a step |
| **Delete** | Remove the picked piece |
| **Ctrl/⌘ D** | Another one like it |
| **Ctrl/⌘ Z**, **Ctrl/⌘ Shift Z** | Undo, redo |
| **Ctrl/⌘ S** | Save |
| **Esc** | Let go of what's picked, then close |

*Walls* in the top bar stands the walls back up to see the room whole. A rug takes two presses: the first picks it (so dragging across one still slides the view), the next drags it.

## Saving

**Save layout** applies the draft to everyone on the floor: what's in the way, where there is to sit, and how the dog and the workers get round the room all follow. Layouts are kept per floor in that floor's `.agent-office/floorplan.json`, with its desk signs and its back office, across restarts. **Reload saved** throws the draft away. **Original office** puts the office back as it comes (as a draft, to save). If another admin saves while you're building, your draft is kept and you're asked to reload before saving over theirs.

Anyone sitting on something that was moved moves with it; on something that was removed, they're stood up. Anyone standing where something now stands steps out of it.

A layout saved by an older version that no longer fits (a piece where something built-in now is) is dropped when the floor loads: the office as it comes, with the floor's signs and back office kept.

## Who can build

Only admins. The builder opens for nobody else, and everything it changes travels on messages the office refuses from anyone else: the layout and its room options (`floor.layout`), the back office (`floor.expand`, `floor.shrink`), and a floor's boards, agents, ticker and connections (`studio.setup`, `integrations.signIn`). Using what's on the floor (the seats, the screens, the things to play with, the tees) is for everyone.

Someone who comes in on the shared office password counts as an admin, so none of this holds anyone back until the admins have accounts of their own and the shared password is switched off: see [Add users](../README.md#add-users).

## Where it lives

The catalog and each kind's footprint are in [`src/shared/furniture.ts`](../src/shared/furniture.ts), the rules for where things may stand in [`src/shared/office-builder.ts`](../src/shared/office-builder.ts) and [`src/shared/office-fixed.ts`](../src/shared/office-fixed.ts), a floor's room options in [`src/shared/floorplan.ts`](../src/shared/floorplan.ts), and build mode in [`src/client/features/office-builder/`](../src/client/features/office-builder).

How each piece looks is a builder in `BUILDERS` in [`src/client/world/office/furniture.ts`](../src/client/world/office/furniture.ts), which takes in the ones kept beside it: `furniture-rooms.ts` (the walls), `furniture-studio.ts` and `furniture-greenery.ts` (the studio's pieces and the newer plants), `furniture-screens.ts` (the wall screen), `furniture-ticker.ts` (the market board) and `furniture-play.ts` (the things to play with). Most are modelled in Blender (see [`blender/README.md`](../blender/README.md)). A kind with no builder shows as a plain box. A new kind of furniture is an entry in `FURNITURE` and a builder.

What the pieces do is in the features: team desks' screen sharing in [`src/client/features/workstation/`](../src/client/features/workstation), the video screens in [`src/client/features/screens/`](../src/client/features/screens) (served by `GET /api/media?floor=<id>&list` and `&name=<file>`, in `src/server/media.ts`), the ticker's prices in [`src/client/features/studio/`](../src/client/features/studio) (`ticker.ts`, with the pure parts in `ticker-format.ts`), the things to play with in [`src/client/features/playthings/`](../src/client/features/playthings), and the tees in [`src/client/features/golf/`](../src/client/features/golf). A new plaything is a kind in `shared/furniture.ts`, a piece in `blender/scripts/build_play.py`, a builder in `furniture-play.ts` and a `Toy` in the feature's table.
