"""The walls a floor is divided into rooms with: a plain painted wall, a black steel and glass
partition, and a panel of upright oak slats, each in a long (2.4 m) and a short (1.2 m) length.
Modelled by this script and exported to src/client/models/rooms.glb for
src/client/world/office/furniture-rooms.ts, which stands a painted copy wherever the office builder
put one (the Rooms group in src/shared/furniture.ts). The shared helpers are in furnkit.py and
aokit.py, and the conventions in blender/README.md.

Headless, from the repo root (`-- --shots` also writes a review sheet per piece and one of a
corner made of them; `-- --shots=<piece>,<piece>` writes only those pieces' sheets):

    blender --background --factory-startup --python blender/scripts/build_rooms.py [-- --shots]

Each piece is a root of its own (`wall`, `wall_short`, `glass_wall`, `glass_short`, `wood_wall`,
`wood_short`), standing on the floor at the origin under its middle, its length along x. They are
all 2.6 tall and as thick as their kind's footprint, and their ends are cut square, so two stood
end to end make one wall and two at a corner meet cleanly. The slats are spaced so that a row of
panels keeps its rhythm across the joins. A glass wall is only its frame here: the office hangs its
own glass in it (glassPane() in world/office/materials.ts), one sheet in each bay between the posts
(BAYS below, which furniture-rooms.ts copies).

The roots' names and the material names are a contract with furniture-rooms.ts and
tests/rooms-model.test.ts, so rename them in all three places. Wall, Frame and Slat are each
piece's own colour (the office builder's paint).
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix

# Run headless, Blender doesn't put this folder on the import path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao
import furnkit as fk
from furnkit import at

# Preview colours only: furniture-rooms.ts paints every material by name. Wall, Frame and Slat are
# the piece's own paint (the catalog's cream, steel and oak here); Trim is a shade of the wall's.
COLORS = {
    "Wall": "#fff6ea",
    "Trim": "#d9cfc0",
    "Frame": "#3d405b",
    "Slat": "#b98554",
    "Backing": "#2b2d42",
    "Steel": "#2b2d42",
}

# The sizes the catalog gives them (src/shared/furniture.ts), which tests/rooms-model.test.ts checks
# the model against: how long, and how thick each kind of wall is.
HEIGHT = 2.6
LONG, SHORT = 2.4, 1.2
THICK = {"wall": 0.14, "glass": 0.1, "wood": 0.12}


# ---- The painted wall -------------------------------------------------------------------------------
#
# A stud wall, painted: a skirting board along its foot and a slim cap along its top, both a shade
# darker than the wall and a little proud of it, which is what makes it read as built rather than
# as a slab.

SKIRT = 0.1
CAP = 0.035


def wall(name, length):
    p = fk.Piece(COLORS)
    d = THICK["wall"]
    p.add("Wall", fk.block, 0, (SKIRT - 0.01 + HEIGHT - CAP + 0.01) / 2, 0, length, HEIGHT - CAP - SKIRT + 0.02, d - 0.04)
    p.add("Trim", fk.block, 0, SKIRT / 2, 0, length, SKIRT, d, bevel=0.01, segs=2, only='x')
    p.add("Trim", fk.block, 0, HEIGHT - CAP / 2, 0, length, CAP, d - 0.02, bevel=0.008, segs=1, only='x')
    return p.finish(name)


# ---- The glass wall ---------------------------------------------------------------------------------
#
# A black steel partition: a rail along the floor and one along the top, a post at each end and one
# between each pair of bays, and two slim transoms across each bay, so every bay is three panes
# high. The office hangs the glass.

RAIL_FOOT = 0.09
RAIL_TOP = 0.06
POST = 0.05
MULLION = 0.04
TRANSOMS = (0.93, 1.77)
# The bays of each length: (middle along x, width), and the glass's bottom and top. furniture-rooms.ts
# has the same numbers.
BAYS = {
    LONG: [(-(LONG / 2 - POST + MULLION / 2) / 2, LONG / 2 - POST - MULLION / 2), ((LONG / 2 - POST + MULLION / 2) / 2, LONG / 2 - POST - MULLION / 2)],
    SHORT: [(0.0, SHORT - 2 * POST)],
}
GLASS = (RAIL_FOOT, HEIGHT - RAIL_TOP)


def glass_wall(name, length):
    p = fk.Piece(COLORS)
    d = THICK["glass"]
    edge = dict(bevel=0.007, segs=1)
    p.add("Frame", fk.block, 0, RAIL_FOOT / 2, 0, length, RAIL_FOOT, d, only='x', **edge)
    p.add("Frame", fk.block, 0, HEIGHT - RAIL_TOP / 2, 0, length, RAIL_TOP, d - 0.02, only='x', **edge)
    y0, y1 = GLASS
    for sx in (-1, 1):
        p.add("Frame", fk.block, sx * (length / 2 - POST / 2), (y0 + y1) / 2, 0, POST, y1 - y0 + 0.02, d - 0.02, only='y', **edge)
    bays = BAYS[length]
    for (xa, wa), (xb, wb) in zip(bays, bays[1:]):
        p.add("Frame", fk.block, (xa + wa / 2 + xb - wb / 2) / 2, (y0 + y1) / 2, 0, MULLION, y1 - y0 + 0.02, d - 0.03, only='y', **edge)
    for x, w in bays:
        for y in TRANSOMS:
            p.add("Frame", fk.block, x, y, 0, w + 0.02, 0.035, d - 0.04, only='x', **edge)
    return p.finish(name)


# ---- The wood slat panel ----------------------------------------------------------------------------
#
# Upright oak slats on a dark felt backing, both faces alike (it stands out in the room as often as
# against a wall), on a black steel foot with a steel cap. Each slat's front edges are eased, so it
# catches the light as a strip rather than a plank.

PITCH = 0.075
SLAT_W = 0.045
SLAT_D = 0.032
BACKING = 0.05
FOOT = 0.07
TOP = 0.03


def slat(bm, x, side, y0, y1, ease=0.009):
    """One slat at `x`, on the backing's face toward `side` (1 the front, -1 the back): its two
    sides, its eased edges and its face. Its ends are open, sunk into the foot and the cap."""
    hw = SLAT_W / 2
    z0 = side * BACKING / 2
    z1 = side * (BACKING / 2 + SLAT_D)
    ze = z1 - side * ease
    section = [(x - hw, z0), (x - hw, ze), (x - hw + ease, z1), (x + hw - ease, z1), (x + hw, ze), (x + hw, z0)]
    lo = [bm.verts.new(at(sx, y0, sz)) for sx, sz in section]
    hi = [bm.verts.new(at(sx, y1, sz)) for sx, sz in section]
    faces = [bm.faces.new((lo[i], lo[i + 1], hi[i + 1], hi[i])) for i in range(len(section) - 1)]
    # Wound to face out on the front; the back's are the same strip seen from behind.
    if side < 0:
        for f in faces:
            f.normal_flip()


def wood_wall(name, length):
    p = fk.Piece(COLORS)
    d = THICK["wood"]
    p.add("Backing", fk.block, 0, HEIGHT / 2, 0, length, HEIGHT - 0.02, BACKING)
    p.add("Steel", fk.block, 0, FOOT / 2, 0, length, FOOT, d, bevel=0.008, segs=1, only='x')
    p.add("Steel", fk.block, 0, HEIGHT - TOP / 2, 0, length, TOP, d, bevel=0.006, segs=1, only='x')
    n = round(length / PITCH)
    for i in range(n):
        x = -length / 2 + PITCH * (i + 0.5)
        for side in (1, -1):
            p.add("Slat", slat, x, side, FOOT - 0.01, HEIGHT - TOP + 0.005)
    return p.finish(name)


# ---- Build, export, review --------------------------------------------------------------------------

PIECES = [
    ("wall", wall, LONG), ("wall_short", wall, SHORT),
    ("glass_wall", glass_wall, LONG), ("glass_short", glass_wall, SHORT),
    ("wood_wall", wood_wall, LONG), ("wood_short", wood_wall, SHORT),
]


def main(write=True):
    ao.clear()
    roots = [make(name, length) for name, make, length in PIECES]
    if write:
        ao.export("rooms")
    return roots


def corner(roots):
    """A corner of a room for the review: a wood panel and a glass wall end to end, a wall
    turned to meet them, and the short ones beyond."""
    def setup():
        spots = {
            "wood_wall": (0.0, 0.0, 0.0), "glass_wall": (2.4, 0.0, 0.0), "wall": (-1.27, 1.2, math.pi / 2),
            "wood_short": (4.2, 0.0, 0.0), "glass_short": (-1.27, 3.0, math.pi / 2), "wall_short": (5.4, 0.0, 0.0),
        }
        for ob in roots:
            ob.hide_render = False
            x, z, turn = spots[ob.name]
            ob.matrix_world = Matrix.Translation(at(x, 0, z)) @ fk.spin(yaw=turn)
    return setup


def review(roots):
    paths = fk.sheets("rooms", roots, {name: (1.3, 6.2 if length == LONG else 5.6) for name, _, length in PIECES}, views=("tq", "front", "low", "back"))
    if not fk.wanted():
        paths.append(ao.sheet("rooms_corner", [(corner(roots), v) for v in ("tq", (-0.5, -1.0, 0.35))], cell=(1000, 620), target=at(1.6, 1.2, 0.8), dist=12.0))
    fk.only(roots, *[ob.name for ob in roots])()
    return paths


if __name__ == "__main__" and bpy.app.background:
    roots = main()
    fk.report(roots)
    print("glb:", os.path.getsize(os.path.join(ao.MODELS, "rooms.glb")), "bytes")
    if fk.wanted() is not None:
        for path in review(roots):
            print("sheet:", path)
