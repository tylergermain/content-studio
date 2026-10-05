# Main Street

Back to the [README](../README.md).

Main Street is the street Friday Tower stands on: the road out front, with plots either side of it where other businesses can build their offices. It's always there, on every floor (each floor draws it as many storeys down as that floor is up) and from the roof bar, and everyone sees the same street.

## The six plots

The plots are the roof city's 44 m blocks either side of the road, so the street looks the same from the floors and from the roof bar. North of the road, west to east:

| Plot | What it is |
| --- | --- |
| **Plot 2** (west of the tower) | For lease |
| **Plot 1** | Friday Tower, Friday Labs' home |
| **Plot 3** (east of the tower) | For lease |

And across the road, south of it, west to east:

| Plot | What it is |
| --- | --- |
| **Putt Street** (P6, south-west) | The nine-hole mini golf course: see [Putt Street](mini-golf.md) |
| **Friday Park** (P5, across from the tower) | Golf's first hole, and Friday One's heliport |
| **Plot 7** (south-east) | For lease. A building on it is turned round to face the street |

Every building stands on the same plate as Friday Tower (36.6 × 26.6 m), 27 m back from the middle of the road, so its front is on Main Street.

## What stands on a plot

A plot a business can have (Plot 2, Plot 3 or Plot 7) shows one of three things, the same for everyone:

- **For lease.** Mown lawn inside a low kerb, with orange-flagged survey stakes at the corners of the plate and a string line between them, and a *FOR LEASE · PLOT 3 · MAIN STREET · OFFICES 1 TO 8 STOREYS* board on two posts by the sidewalk, facing the street.
- **A building site.** A 2.4 m hoarding a meter outside the plate: white panels with a band of the business's color along the top, printed along the street with its name, *Coming soon to Main Street* and how many storeys are planned, either side of a steel-mesh gate (*SITE ENTRANCE · HARD HATS ON*). Behind it the slab is poured over the back two thirds of the plate, with its first columns and their rebar, two site cabins stacked by the gate (the lower one lit at night), pallets and steel, and cones out front. A flat-top tower crane stands on a fenced footing at the back corner of the plot, outside the hoarding: its 34 m lattice mast stays put, and its 26 m jib, 32 m up, slews round once every 90 seconds, a quarter turn at a time with a pause after each, its trolley running out and back and its hook (with a bundle of steel) going up and down. It all runs on the office's clock, so every page sees the jib in the same place. Red warning lights mark the jib's tip and the counter-jib's end.
- **A shell.** The business's tower before it has any floors: a 3.6 m garage level with a roller shutter and a glazed lobby, glass doors marked *Opening soon* and a canopy over them in the business's color with its name on the front; then 1 to 8 storeys in its colors (a 0.3 m accent band, then glass and spandrel in Friday Tower's rhythm, the glass set back behind its frame as the tower's bars have theirs), its skin (glass, brick, graphite or timber) as the frame paint, windows lit at night, and a 1.2 m parapet with planters along its street and back edges, its name in big letters across the top storey's street face. At most 61.6 m tall, so Friday Tower (the roof bar's deck at 110 m, the mast at 131 m) stays the landmark.

Sites and shells are solid: you walk round them, golf balls from the balconies bounce off them, and Friday One can't fly through them or the crane's jib. A claimed plot keeps a sign by its gate or door, and **E** there opens the Main Street window on it.

## Friday Park

Across the road from the tower, round golf's first hole (the green, the bunkers and the trees are as they always were):

- **Friday One's heliport**: a concrete deck 25 cm high (a step up) that you can walk onto, with a green ring, a white H, *FRIDAY ONE* and eight green edge lights, and a floodlight off its south-east edge that lights it at night. The helicopter lives here: see [Friday One](helicopter.md).
- A 5 m windsock, a gravel path in from the sidewalk, two benches and a small heliport sign.
- **The Main Street map board**, 3 × 2 m, facing the street at the park's corner: the plan of the street with who's where on it, drawn as you see it standing at the board looking into the park (the park side up, west on the right) with *YOU ARE HERE*, and painted again whenever the street changes. **E** opens the Main Street window.

## The Main Street window

**E** at a plot's sign (its FOR LEASE board, or a claimed plot's gate or lobby doors), or at the map board in Friday Park, opens it. At a plot that's for lease a street admin's hint says **E Claim it**; everyone else's, and at a claimed plot, **E Main Street**. On the left is Main Street from above: the tower, the park, Putt Street and the three plots as they stand, with Friday One, you, and anyone else out on the street on your floor. Click a plot to pick it; opened from a plot's board, it starts on that plot.

Street admins claim plots. For now that's the office's admins (Tyler and Gavin), and anyone signed in on the shared office password, as for everything office-wide. Everyone else sees what stands where, and the line *Street admins (the office's admins) claim plots*.

For a street admin, the picked plot has a form:

- **Name**: 1 to 32 characters.
- **Color**: one of the suggestions, or any color.
- **Clad in**: glass, brick, graphite or timber.
- **Stands as**: a building site or a shell.
- **Storeys**: 1 to 8 (for a site, how many are planned).

While you fill it in, the plan shows what it would be, ringed with a dashed line. **Claim Plot 3** puts it up for everyone, on every floor, at once, and the whole office hears that *Acme is coming to Plot 3 on Main Street*. On a claimed plot the same form changes it (**Save**), and **Release…** gives the plot back: type the business's name to confirm, and the site or shell comes down and the plot is for lease again.

The office checks every claim and change itself, whatever the page says:

- Only a street admin, asked at that moment (someone who stops being an admin can't claim with a window they opened before).
- Only a plot that's for lease can be claimed.
- **Not over Friday One.** While it's parked or landed with any part of it (its rotor's disc, or its tail) on the plot, a claim is refused: *Friday One is parked on Plot 3: it has to fly off first*. In the air, walls can't go up round it either (a shell growing up past it, a crane's jib).
- **Not over anyone.** While anyone is standing on the plot, or within half a meter of where its walls would go, on any floor's street, it's refused: *Someone's standing on Plot 3: they have to step off first*. Walls go up solid to the sky, so whoever was inside would be walled in.
- Changing a site into a shell (or back), or a shell's height, looks for Friday One and people the same way. Renaming it or repainting it doesn't move any walls, so it doesn't.
- A window showing a business that has since gone from the plot can't change or release the one that came after: *Plot 3 changed while you were looking*.
- Each admin changes the street at most once every 300 ms.

Why a claim was refused is said in the window, under the form, as well as on screen.

## street.json

The businesses on Main Street are kept in the office's data folder, in `street.json` (`~/agent-office/.agent-office/street.json`, or the `.agent-office` of the project the office was started in). With no file, there are no businesses and every plot is for lease.

```json
{
  "version": 1,
  "businesses": [
    {
      "id": "acme",
      "name": "Acme",
      "plot": "P3",
      "accent": "#ff8800",
      "skin": "brick",
      "stage": "site",
      "planned": 4,
      "home": "hosted",
      "maxFloors": 4,
      "maxWorkers": 3,
      "by": "Tyler",
      "at": 1791160918655
    }
  ]
}
```

- **id** is made from the name when the plot is claimed (lower-case letters, digits and dashes, up to 20; `-2`, `-3` for a name that's taken) and never changes. It's never `friday-labs`, which is Friday Labs', the host's.
- **home**, **maxFloors**, **maxWorkers** and the optional **url**, **card**, **trusted** and **budget** are for the businesses that move in later (see below). A claim now makes a hosted business with 4 floors and 3 workers, untrusted.
- Everyone is sent each business's public card only: its name, plot, colors, skin, stage and storeys. Never its quotas, its trust or its address.

The office reads the file when it's first needed, and again whenever it changes on disk, so it can be edited while the office runs. It writes it whole and renames it into place, so nobody ever reads half of it, and only the office's own user can read it.

A `street.json` that won't read (not JSON, another version, no list of businesses) is logged, with where it is and why, and Main Street has no businesses until it's fixed. A business in it that won't do (an id or a plot that's taken, a color or a skin it can't have) is logged and left out, and the rest stand. Either way, the file is moved aside to `street.json.corrupt-<time>` before the office first writes a new one, so nothing in it is lost.

## What moved for it

The plots took the ground some of the old outside had:

- Six of the eight neighbours' buildings stood on the plots and are gone; the two behind the tower stay.
- Meadowbrook Farm's fields start further east (from x 82), and the cows' pasture moved east of the barn, its gate still facing it.
- The *SCENIC LOOP* billboard moved out of Friday Park's corner to x 28, between the park and Plot 7.
- The scenic loop's trees keep 4 m off every plot.
- From the roof bar, the roof city leaves Main Street's six blocks to it, and draws the same street, sites, shells, park and Putt Street the floors do, a few centimeters over its own ground so the two never flicker through each other.

## What comes later

A claim today is a record and what it shows: a building site or a shell. Nobody from outside Friday Labs gets in yet. In the rounds to come:

- **Other businesses move in.** A street admin grants a plot to a business: hosted on this office's machine (its own floors, people, chat and worker quota, its workers off until a street admin trusts them) or linked to an office of its own elsewhere, whose public card the plot shows. Its tower rises a storey per floor.
- **Privacy walls.** Nobody sees inside another business, street admins included: its floors, workers, terminals, chat, boards, files and the people indoors.
- **Main Street together.** People from every floor (and every business) meet out on the one street, and Friday One lands on a painted H on the roof bar.
