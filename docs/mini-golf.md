# Putt Street

Back to the [README](../README.md). Putt Street is on [Main Street](main-street.md), across the road from Friday Tower.

Putt Street is a nine-hole mini golf course, par 26, on plot P6 across Main Street, west of Friday Park. Groups of up to four go round it together. Everyone in the building sees the same course and every ball on it, from whichever floor they're on, because the street is under every floor.

## The course

A white picket fence, 0.9 m high, runs round the plot. Its gate is on the street side, under a **⛳ PUTT STREET · MINI GOLF** sign. Inside the gate:

- **The kiosk** is to the east of the gate. **PUTT STREET** is on its roof, facing the street. On the course side it has a hatch under a striped awning, and the putter rack with the live scorecard board over it. The board shows every round being played: who's in each group, their strokes hole by hole, the hole each group is on, and whose turn it is.
- **The record board** is to the west of the gate, facing the street. It shows the course record, the best score on each hole, the holes in one, and the last few rounds.

Each hole has its own 10 m cell of lawn, on a 3 × 3 grid with gravel paths between. A lantern stands at each of two path crossings, and lights the course at night. The order snakes back from the kiosk, and each tee is on the side you walk up from the hole before. A sign beside each tee gives the hole's number, name and par.

| # | Hole | Par | What's on it |
| --- | --- | --- | --- |
| 1 | Opening Putt | 2 | A straight 1.6 m lane over a 0.12 m hump. |
| 2 | The Windmill | 3 | A white windmill, front and centre and 10 m from the sidewalk. Its four Friday-green sails turn once every 4 s on the face toward Main Street. The ball goes through a 0.5 m tunnel in its foot when no sail is across the mouth, onto the green behind. A sail across the mouth knocks the ball back. |
| 3 | Bumper Alley | 3 | A Z-shaped dogleg with five rubber bumpers in the way. |
| 4 | The Ramp | 2 | A 1:6 ramp up to a 3 × 3 m green 0.45 m up, with a rail along its back. |
| 5 | The Loop | 3 | A chute into a steel loop-the-loop 0.6 m round. The ball comes out a quarter of a meter to the right, onto the green. Slower than about 5.6 m/s at its foot, the ball rolls back out toward the tee. |
| 6 | Three Tunnels | 3 | A grassy hill 1.2 m high, with three mouths in its near side. The left one comes out a meter from the cup, the middle one on the green 3 m away, and the right one back by the tee. |
| 7 | The Jump | 3 | A ramp whose top edge is a 0.35 m lip (painted yellow), over a 1.2 m water channel, onto a green with a rail at its back. |
| 8 | The Volcano | 3 | A cone 2.2 m round and 0.5 m high, with lava running down it. The cup is at the bottom of the crater in its top. |
| 9 | Friday Finale | 4 | An S of two banked bends under an arch shaped like Friday Tower: two posts, with the tower's three bars in green on top. |

The holes are data: they're defined in `src/shared/minigolf/course.ts`, and the page builds the course from them, so the course on screen is always the one the office rolls on.

## Playing

- **Join or start a group.** Walk up to the putter rack at the kiosk and press **E** to pick up a putter. This joins a group that's still forming, or starts one with you as its starter. A group holds four and forms for 90 s. The starter can tee off sooner: **E** at the rack again says **Tee off now**.
- **The scorecard.** While you're in a round, a compact scorecard is at the top left of the screen. It shows every player's strokes on holes 1 to 9, the total against par, a par row, and the hole being played. Above the card it says whose turn it is and how long that turn has left. It doesn't take the mouse or the keyboard.
- **Your turn.** A toast says **⛳ Your turn on hole 4**. Walk to your ball (it's in your colour, with your name over it) and press **E** within about 2.5 m. You step up to the ball with a putter, side on to it, and the camera stands back along the line behind the ball.
- **Aiming.** The mouse aims (or **A** and **D**). A dotted line shows the first 1.2 m of the line. It doesn't show where the ball will go.
- **Putting.** Hold **Space**. The meter at the top of the screen runs from empty to full and back down, and keeps going for as long as you hold Space. Let go when it's where you want it. The putter swings, and the camera follows the ball until it stops. If it's still your turn, you're over the ball again where it stopped.
- **Stepping away.** **E** or **Esc** steps away from the ball. Walk back and press **E** to step up again. You also step away when you sit down, take the elevator or go up to the roof.
- **Leaving.** **E** at the rack twice (the first press asks) hands your putter back and takes you out of the round. Closing the page does the same.

Players on other floors show up only as their balls. Someone on your floor whose turn it is holds a putter while they're standing at their ball, and you see them swing it.

## The rules

- **Turns.** Each player putts until their ball drops, then the next player goes. When everyone has finished a hole, the group moves on to the next, with every ball on its tee.
- **The cap.** After 6 strokes on a hole you're picked up, and the hole scores 7.
- **The clock.** A turn left for 60 s is picked up at 7 too. A warning comes at 45 s, and the scorecard's clock turns red.
- **Penalties.** A ball in the water, or thrown over the walls and off the felt, costs a stroke. It comes back to where you putted it from.
- **A club length.** A ball can stop where nobody could stand to putt it: in the windmill's tunnel, on the ramp, on the hill, on the volcano's slopes, or under the arch. It's moved a club length (0.9 m) to the nearest spot you can putt from, and it hops there on screen.
- **Waiting.** A group can't start a hole while an earlier group still has balls on it. The scorecard says **waiting for the group ahead**, and the turn's clock doesn't run while it waits.
- **Balls don't hit each other.**

## The office is the referee

The page never rolls a ball. When you let go of Space, it sends the office which way you aimed and how hard. It also sends when the putter will meet the ball: 90 ms after you let go, on the office's clock. The office checks the following:

- It's your turn.
- Your ball has stopped.
- You're standing within about 3 m of the ball.
- You haven't putted in the last 600 ms.

The office holds the strike time to between 20 and 150 ms after it hears the putt, so nobody can choose when the windmill's sails are open. It then rolls the putt with the shared physics (`src/shared/minigolf/physics.ts`), stepping 240 times a second. It sends everyone the ball's path, sampled 30 times a second and timed on the office's clock.

Every page plays that path back on the office's clock, so every page shows the same roll at the same moment. A path that arrives late is played from where it has got to. The windmill's sails turn on the same clock, so a sail on screen is where the office had it when it rolled the ball.

While a putt is rolling, the scorecards show the round as it was when the ball was struck, so the score doesn't give the putt away before the ball gets there.

## The meter

The meter has the same shape as golf's meter on the balcony: from empty to full, then back down in as long again. On Putt Street it takes 1.8 s to fill (`PUTT_METER.up`), slower than golf's 1.3 s. The putt speed rises slowly at the bottom of the meter, so short putts, which need a light touch, get the most of it.

The fairness check, which `tests/minigolf-client.test.ts` holds the page's meter to, is a straight putt on level felt. The table shows how long you can hold Space and still drop it, using the numbers in `src/shared/minigolf/rules.ts`:

| Putt | Hold Space for | Window |
| --- | --- | --- |
| 1 m | 0.34–0.60 s | 257 ms |
| 2 m | 0.53–0.71 s | 177 ms |
| 3 m | 0.65–0.79 s | 138 ms |
| 5 m | 0.83–0.93 s | 100 ms |
| 8 m | 1.01–1.09 s | 72 ms |

The test fails if a 3 m putt has a window under 120 ms.

## Records

When a group finishes hole 9, each player gets a **Round over** window. It has the full card, your total against par, any holes in one and birdies, and **New course record!** if you set one. **✕** or **Esc** closes it and puts you straight back into looking around.

The office keeps Putt Street's records in `minigolf.json`, in its data folder:

- the course record, for a full nine holes (on a tie, the earlier round keeps it);
- the best score on each hole;
- every hole in one;
- the last 20 rounds.

A new course record or a hole in one is toasted to the whole building, and sets off confetti over the record board or the cup. A `minigolf.json` that won't read is logged and set aside as `minigolf.json.corrupt-<time>`, and the office starts the records again from empty. It's never quietly written over. Writes are atomic.

## Sounds

Every sound comes from where the ball is, and everyone on every floor hears it by distance:

- a soft tock as the putter meets the ball, louder the harder you hit it;
- a wooden clack off a kerb or a rail;
- a rubbery boing from a bumper;
- a knock and a creak when a windmill sail turns the ball back;
- a whoosh round the loop;
- a hollow roll inside the hill;
- a splash and a few drops in the water;
- a thud on the gravel off the felt;
- a rattle round the rim for a lip-out;
- the plunk, rattle and plink of the cup;
- a short fanfare for a hole in one.

## For developers

| Where | What |
| --- | --- |
| `src/shared/minigolf/` | The holes, the physics and the rules, all pure: the office runs the physics, and the page reads the holes and the windmill's clock. |
| `src/shared/protocol/minigolf.ts` | The messages: `putt.play`, `putt.start`, `putt.stroke` and `putt.quit`, then `putt`, `putt.rolled` and `putt.board`. |
| `src/server/minigolf/` and `ws/handlers/minigolf.ts` | The rounds, the referee and `minigolf.json`. |
| `src/client/features/minigolf/` | The page: the `puttCourse` street fixture and `buildPuttStreet` (`world.ts`), playing the balls back (`balls.ts`), putting (`controller.ts`), the scorecard and the Round-over window (`ui.ts`), and the sounds (`sound.ts`). |
| `src/client/world/minigolf/` | The course's pieces: the felt, walls and bumpers, the windmill, the loop, the hill and its tunnels, the arch, the grounds, the kiosk and the boards. |

To look at the course in the lab, open `/lab/minigolf.html` on the Vite dev server:

- `?hole=2` shows one hole;
- `&t=1.5` puts the windmill at an office time, in seconds;
- `&roll=0,0.42&at=1.4` rolls a putt from the tee with the office's own physics, so you can check the drawing against it.

`node src/client/lab/shot.mjs <url> <out.png>` takes a screenshot of it.
