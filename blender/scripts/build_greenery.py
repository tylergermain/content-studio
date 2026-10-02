"""More green for the office: a fiddle-leaf fig, a palm, a bird of paradise and a pothos trailing
off a plant stand, each in a planter of its own, and a long planter box full of plants to stand
along a wall or between two desks. Modelled by this script and exported to
src/client/models/greenery.glb for src/client/world/office/furniture-greenery.ts, which stands a
painted copy wherever the office builder put one (the Plants group in src/shared/furniture.ts).
The leaves are made the way build_plants.py makes the first plants' (its helpers are used here);
the shared furniture helpers are in furnkit.py and the conventions in blender/README.md.

Headless, from the repo root (`-- --shots` also writes a review sheet per plant and one of them
all in a row; `-- --shots=<plant>,<plant>` writes only those plants' sheets):

    blender --background --factory-startup --python blender/scripts/build_greenery.py [-- --shots]

Each plant is two objects, as in plants.glb: its planter with its soil (and its stand, if it has
one) is a root named after it (`fiddle_leaf`, `palm`, `bird_of_paradise`, `pothos`, `planter`),
standing on the floor at the origin and facing forward, and everything that grows out of it is one
object hung under it, `<name>_leaves`. The names and the material names are a contract with
furniture-greenery.ts and tests/greenery-model.test.ts, so rename them in all three places. Box is
the planter box's own colour (the office builder's paint).

The planters stay inside their kinds' footprints (0.3 round, and the box's 1.8 by 0.45) and are as
tall as their colliders; the leaves reach out over them, as the first plants' do.
"""
import bpy, bmesh, math, os, random, sys
from mathutils import Matrix, Vector

# Run headless, Blender doesn't put this folder on the import path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao
import furnkit as fk
import build_plants as bp
from aokit import TAU
from furnkit import at

# Preview colours only: furniture-greenery.ts paints every material by name. The greens, the soil
# and the bark are the first plants'; the planters are white ceramic, cast stone and charcoal, on
# the studio's oak and black steel.
COLORS = {
    "Ceramic": "#f7f3ea",
    "Stone": "#b9b4aa",
    "Charcoal": "#3d405b",
    "Oak": "#c9a36b",
    "Steel": "#2b2d42",
    "Box": "#2b2d42",
    "Soil": "#6b4226",
    "Bark": "#8a5a3b",
    "Leaf": "#5fb760",
    "LeafDark": "#3f8f45",
    "LeafLight": "#a8d672",
}

PLANTS = ("fiddle_leaf", "palm", "bird_of_paradise", "pothos", "planter")


def piece():
    return fk.Piece(COLORS)


def soil(p, r, z, segs=20):
    """Earth filling a planter to `z`, `r` round (a little into its wall), heaped a touch."""
    p.add("Soil", ao.lathe, [(r, z - 0.008), (r * 0.6, z), (0.0, z + 0.005)], segs=segs)


def leaf(edge, length, rib, depth=0.012, fold=0.2, bevel=0.0):
    """A leaf from its right edge [(u, v)] as fractions of `length` (see bp.blade), mirrored for
    its left, with points up its midrib at `rib`."""
    right = [(u * length, v * length) for u, v in edge]
    left = [(-u * length, v * length) for u, v in edge]
    return bp.blade(right, left, [length * t for t in rib], depth, fold=fold, bevel=bevel)


# ---- The fiddle-leaf fig ----------------------------------------------------------------------------
#
# A slim bare trunk, a little bent, out of a white pot that sits in an oak stand, with big
# violin-shaped leaves spiralling up it: the low ones big and held out, the high ones smaller and
# standing up.

# A fiddle leaf's right edge, from its stalk to its tip: narrow at the waist, broad past the middle.
FIDDLE_EDGE = [(0.0, 0.0), (0.1, 0.02), (0.17, 0.11), (0.15, 0.27), (0.2, 0.44), (0.31, 0.64), (0.31, 0.82), (0.19, 0.95), (0.0, 1.0)]


def fiddle_leaf():
    p = piece()
    # The pot: a straight-sided ceramic cylinder with a rolled lip, lifted off the floor by its stand.
    lift, top = 0.13, 0.55
    pot = [(0.0, lift), (0.2, lift), (0.215, lift + 0.015), (0.238, top - 0.03), (0.25, top - 0.012), (0.243, top), (0.225, top), (0.218, top - 0.07)]
    p.add("Ceramic", ao.lathe, pot, segs=24)
    soil(p, 0.221, top - 0.05, 24)
    # The stand: four oak legs outside the pot, and a cross under it.
    for k in range(4):
        a = TAU * (k + 0.5) / 4
        x, y = 0.262 * math.cos(a), 0.262 * math.sin(a)
        p.add("Oak", ao.cylinder, (x, y, 0.0), (x * 0.97, y * 0.97, 0.36), 0.016, 0.02, segs=8)
    for turn in (math.pi / 4, 3 * math.pi / 4):
        p.add("Oak", ao.box, (0, 0, lift - 0.02), (0.53, 0.04, 0.04), bevel=0.006, rot=(0, 0, turn), segments=1)
    root = p.finish("fiddle_leaf")

    s = piece()
    trunk = bp.bezier((0.0, 0.0, top - 0.08), (0.09, -0.04, 1.0), (-0.01, 0.01, 1.62), n=9)
    s.add("Bark", bp.stalk, trunk, 0.03, 0.014, segs=8)
    n = 20
    for i in range(n):
        t = i / (n - 1)
        # Up the top two thirds of the trunk, each a golden angle round from the last.
        at_, _ = bp.along(trunk, 0.3 + 0.7 * t)
        a = i * 2.39996 + 0.4
        length = 0.37 - 0.13 * t
        pitch = math.radians(20 + 56 * t ** 1.2)
        out = Vector(at_) + Vector((math.cos(a), math.sin(a), 0.0)) * 0.03
        blade = leaf(FIDDLE_EDGE, length, (0.3, 0.62), depth=0.014, fold=math.tan(math.radians(9)), bevel=0.003)
        s.part(("LeafDark" if i % 3 != 2 and t < 0.85 else "Leaf",), blade, bp.frame(out, a, pitch, math.radians((i * 53) % 24 - 12)))
    s.finish("fiddle_leaf_leaves", parent=root, weighted=False)
    return root


# ---- The palm ---------------------------------------------------------------------------------------
#
# An areca palm in a tall cast-stone planter: arching fronds, each a stalk with a row of narrow
# leaflets down either side, the middle ones standing tall and the outer ones bowing out.

# (azimuth in degrees, how far out its tip comes, how high its tip is, dark?)
FRONDS = [
    (20, 0.16, 1.78, False), (150, 0.24, 1.7, False), (265, 0.28, 1.62, True),
    (75, 0.42, 1.44, True), (200, 0.46, 1.36, False), (318, 0.44, 1.4, True),
    (110, 0.52, 1.08, False), (238, 0.53, 1.0, True), (355, 0.52, 1.12, False), (50, 0.5, 0.84, True),
]


def frond(s, azimuth, reach, height, dark, base_z):
    a = math.radians(azimuth)
    out = Vector((math.cos(a), math.sin(a), 0.0))
    up = Vector((0.0, 0.0, 1.0))
    base = out * 0.035 + up * base_z
    tip = out * reach + up * height
    # Up out of the soil, then over: the further out its tip, the more it bows.
    bend = out * (reach * 0.3) + up * (height + 0.1 + reach * 0.5)
    spine = bp.bezier(base, bend, tip, n=9)
    green = "LeafDark" if dark else "Leaf"
    s.add(green, bp.stalk, spine, 0.012, 0.004, segs=5)
    pts = [Vector(q) for q in spine]
    first = 2
    for i in range(first, len(pts)):
        tangent = (pts[min(i + 1, len(pts) - 1)] - pts[i - 1]).normalized()
        side = tangent.cross(up).normalized()
        tau = (i - first) / (len(pts) - 1 - first)
        length = 0.33 * (0.55 + 0.45 * math.sin(math.pi * min(1.0, tau * 1.15))) * (1.0 - 0.5 * tau ** 3)
        for sgn in (-1, 1):
            # Out to the side, swept toward the tip and drooping a little.
            v = (side * sgn * 0.8 + tangent * 0.5 - up * 0.3).normalized()
            w = (up - v * up.dot(v)).normalized()
            blade = bp.strap_leaf(length, [(0.3, 0.031)], depth=0.007, fold=0.3)
            s.part((green,), blade, bp.axes(pts[i], v.cross(w), v, w))
    # The last leaflet, on along the stalk.
    v = (pts[-1] - pts[-2]).normalized()
    w = (up - v * up.dot(v)).normalized()
    s.part((green,), bp.strap_leaf(0.2, [(0.3, 0.028)], depth=0.007, fold=0.3), bp.axes(pts[-1], v.cross(w), v, w))


def palm():
    p = piece()
    top = 0.6
    pot = [(0.0, 0.0), (0.17, 0.0), (0.185, 0.012), (0.262, top - 0.025), (0.268, top - 0.008), (0.26, top), (0.24, top), (0.232, top - 0.08)]
    p.add("Stone", ao.lathe, pot, segs=24)
    soil(p, 0.236, top - 0.06, 24)
    root = p.finish("palm")
    s = piece()
    for azimuth, reach, height, dark in FRONDS:
        frond(s, azimuth, reach, height, dark, top - 0.09)
    s.finish("palm_leaves", parent=root, weighted=False)
    return root


# ---- The bird of paradise ---------------------------------------------------------------------------
#
# Tall paddle leaves on long stalks out of a charcoal drum, the middle ones upright and the outer
# ones leaning away, a few torn where the wind would have had them.

PADDLE_EDGE = [(0.0, 0.0), (0.09, 0.03), (0.18, 0.15), (0.215, 0.36), (0.2, 0.6), (0.14, 0.82), (0.06, 0.95), (0.0, 1.0)]
# (azimuth in degrees, lean from upright, the stalk's length, the leaf's length, dark?, torn?)
PADDLES = [
    (80, 5, 0.86, 0.58, False, False), (250, 9, 0.74, 0.6, True, True), (165, 16, 0.6, 0.56, False, False),
    (345, 19, 0.56, 0.56, True, False), (35, 30, 0.42, 0.52, True, True), (205, 33, 0.4, 0.5, False, False),
    (120, 41, 0.3, 0.46, True, False), (295, 44, 0.3, 0.46, False, True),
]


def bird_of_paradise():
    p = piece()
    top = 0.5
    pot = [(0.0, 0.0), (0.255, 0.0), (0.27, 0.014), (0.27, top - 0.02), (0.262, top), (0.242, top), (0.236, top - 0.07)]
    p.add("Charcoal", ao.lathe, pot, segs=28)
    soil(p, 0.24, top - 0.05, 28)
    root = p.finish("bird_of_paradise")
    s = piece()
    for azimuth, lean, stem, length, dark, torn in PADDLES:
        a, l = math.radians(azimuth), math.radians(lean)
        out = Vector((math.cos(a), math.sin(a), 0.0))
        up = Vector((0.0, 0.0, 1.0))
        base = out * 0.05 + up * (top - 0.08)
        aim = out * math.sin(l) + up * math.cos(l)
        end = base + aim * stem
        # The stalk leans out as it rises; its leaf carries on along it and bows over a little more.
        mid = base + up * (stem * 0.55) + out * (stem * 0.1 * math.sin(l))
        s.add("Leaf", bp.stalk, bp.bezier(base, mid, end, n=5) + [tuple(end + aim * length * 0.5)], 0.02, 0.008, segs=6)
        edge = bp.split(PADDLE_EDGE, [(0.42, 0.7, 0.05), (0.66, 0.6, 0.045)]) if torn else PADDLE_EDGE
        blade = leaf(edge, length, (0.25, 0.5, 0.75), depth=0.014, fold=math.tan(math.radians(13)), bevel=0.003)
        s.part(("LeafDark" if dark else "Leaf",), blade, bp.frame(end, a, math.pi / 2 - l - 0.14, math.radians((azimuth * 7) % 30 - 15)))
    s.finish("bird_of_paradise_leaves", parent=root, weighted=False)
    return root


# ---- The pothos -------------------------------------------------------------------------------------
#
# A pothos on a tall oak plant stand: a white pot heaped with heart-shaped leaves, and vines of
# them trailing down over its rim, some nearly to the floor. Every third leaf is the pale new green.

HEART_EDGE = [(0.0, 0.0), (0.2, -0.1), (0.42, 0.02), (0.46, 0.3), (0.3, 0.68), (0.0, 1.0)]
STAND = 0.72
# (azimuth in degrees, how far down it hangs)
VINES = [(15, 0.62), (70, 0.3), (118, 0.5), (170, 0.22), (215, 0.66), (262, 0.36), (310, 0.48)]


def heart(length):
    return leaf(HEART_EDGE, length, (0.35, 0.7), depth=0.008, fold=0.22)


def pothos_green(i):
    return ("Leaf", "LeafDark", "LeafLight")[i % 3]


def vine(s, rng, start, azimuth, drop, count0=0, out=0.1):
    """A vine from `start` over the edge toward `azimuth` and `drop` down, hanging `out` clear of
    where it started, a leaf every few centimetres on alternate sides."""
    a = math.radians(azimuth)
    reach = out
    out = Vector((math.cos(a), math.sin(a), 0.0))
    side = Vector((-math.sin(a), math.cos(a), 0.0))
    up = Vector((0.0, 0.0, 1.0))
    over = Vector(start) + out * reach * 0.7 + up * 0.02
    end = Vector(start) + out * (reach + 0.03 * rng.random()) - up * drop + side * (rng.random() - 0.5) * 0.1
    path = bp.bezier(start, over, over - up * drop * 0.35 + out * 0.03, n=4)[:-1] + bp.bezier(over - up * drop * 0.35 + out * 0.03, (over + end) / 2 + out * 0.03, end, n=5)
    s.add("LeafDark", bp.stalk, path, 0.007, 0.004, segs=5)
    n = max(3, round(drop / 0.085))
    for k in range(n + 1):
        t = 0.2 + 0.8 * k / n
        at_, _ = bp.along(path, t)
        sgn = 1 if k % 2 else -1
        # Hanging down and out, turned to one side of the vine and then the other.
        turn = a + sgn * (0.7 + 0.3 * rng.random())
        length = 0.115 - 0.03 * t + 0.015 * rng.random()
        s.part((pothos_green(count0 + k),), heart(length), bp.frame(Vector(at_) + out * 0.004, turn, math.radians(-38 - 30 * rng.random()), sgn * 0.35))


def pothos():
    p = piece()
    top = STAND + 0.21
    # The stand: a round oak top on three splayed legs, with a ring to brace them.
    p.add("Oak", ao.lathe, [(0.0, STAND - 0.035), (0.185, STAND - 0.035), (0.2, STAND - 0.022), (0.2, STAND - 0.008), (0.192, STAND), (0.0, STAND)], segs=24)
    ring = []
    for k in range(3):
        a = TAU * k / 3 + math.pi / 2
        d = Vector((math.cos(a), math.sin(a), 0.0))
        foot, head = d * 0.262 + Vector((0, 0, 0.003)), d * 0.13 + Vector((0, 0, STAND - 0.03))
        p.add("Oak", ao.cylinder, foot, head, 0.014, 0.021, segs=8)
        ring.append(foot.lerp(head, 0.36))
    for a_, b_ in zip(ring, ring[1:] + ring[:1]):
        p.add("Steel", ao.cylinder, a_, b_, 0.007, segs=6)
    pot = [(0.0, STAND), (0.12, STAND), (0.132, STAND + 0.012), (0.168, top - 0.02), (0.174, top - 0.006), (0.166, top), (0.15, top), (0.146, top - 0.05)]
    p.add("Ceramic", ao.lathe, pot, segs=24)
    soil(p, 0.149, top - 0.03, 24)
    root = p.finish("pothos")

    s = piece()
    rng = random.Random(11)
    z = top - 0.035
    # The heap in the pot: leaves standing up and out all round, the middle ones highest.
    for i in range(13):
        a = i * 2.39996
        r = 0.02 + 0.085 * (i / 12) ** 0.7
        foot = Vector((math.cos(a) * r * 0.4, math.sin(a) * r * 0.4, z))
        base = Vector((math.cos(a) * r, math.sin(a) * r, z + 0.16 - 0.1 * (i / 12)))
        s.add("LeafDark", bp.stalk, bp.bezier(foot, Vector((foot.x, foot.y, base.z)), base, n=3), 0.006, 0.004, segs=5)
        s.part((pothos_green(i),), heart(0.12 - 0.02 * (i / 12)), bp.frame(base, a, math.radians(48 - 44 * (i / 12)), math.radians((i * 41) % 40 - 20)))
    for j, (azimuth, drop) in enumerate(VINES):
        a = math.radians(azimuth)
        vine(s, rng, (math.cos(a) * 0.14, math.sin(a) * 0.14, top - 0.005), azimuth, drop, count0=j)
    s.finish("pothos_leaves", parent=root, weighted=False)
    return root


# ---- The planter box --------------------------------------------------------------------------------
#
# A long trough on two black steel skids, planted from end to end: clumps of sword leaves standing
# up, mounds of arching ones between them, and a few vines over its front edge.

PLANTER = {"w": 1.8, "d": 0.45, "foot": 0.14, "rim": 0.64}
SWORD = [(0.08, 0.028), (0.3, 0.05), (0.56, 0.05), (0.8, 0.036), (0.93, 0.018)]


def trough(bm, w, d, y0, y1, corner, wall, sink):
    """The box, open at the top: its rounded bottom edge, its sides, its rim, and the inside of its
    wall down to where the soil is, `sink` under the rim."""
    rings = []
    for inset, y in ((0.02, y0), (0.0, y0 + 0.02), (0.0, y1 - 0.006), (0.006, y1), (wall - 0.006, y1), (wall, y1 - 0.006), (wall, y1 - sink)):
        hx, hz = w / 2 - inset, d / 2 - inset
        rings.append([bm.verts.new(at(px, y, pz)) for px, pz in fk.rounded_rect(hx, hz, max(0.004, corner - inset), 3)])
    n = len(rings[0])
    faces = [bm.faces.new(rings[0][::-1])]
    for lo, hi in zip(rings, rings[1:]):
        for k in range(n):
            faces.append(bm.faces.new((lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def planter():
    w, d, foot, rim = PLANTER["w"], PLANTER["d"], PLANTER["foot"], PLANTER["rim"]
    p = piece()
    bw, bd = w - 0.04, d - 0.03
    p.add("Box", trough, bw, bd, foot, rim, 0.035, 0.03, 0.045)
    p.add("Soil", fk.slab, bw - 0.05, bd - 0.05, rim - 0.1, rim - 0.04, corner=0.02, edge=0.004, csegs=2, esegs=1)
    for sx in (-1, 1):
        x = sx * (w / 2 - 0.3)
        for sz in (-1, 1):
            p.add("Steel", fk.block, x, foot / 2 + 0.01, sz * (d / 2 - 0.08), 0.03, foot + 0.02, 0.03, bevel=0.005, segs=1)
        p.add("Steel", fk.block, x, 0.015, 0, 0.03, 0.03, d - 0.13, bevel=0.005, segs=1)
    root = p.finish("planter")

    s = piece()
    rng = random.Random(5)
    ground = rim - 0.05
    # A low dark mound under each plant, so the box reads as full between the leaves.
    for cx, r in ((-0.7, 0.12), (-0.47, 0.13), (-0.23, 0.12), (0.0, 0.13), (0.23, 0.12), (0.47, 0.13), (0.7, 0.12)):
        s.add("LeafDark", ao.ellipsoid, (cx, 0.0, ground + 0.02), (r, 0.14, 0.075), segs=8, rings=5, smooth=True)
    # Sword leaves: stiff, upright, leaning a little out of each clump.
    for cx, n in ((-0.7, 5), (-0.23, 6), (0.23, 5), (0.7, 6)):
        for i in range(n):
            a = TAU * i / n + rng.random() * 0.6
            # Those toward the back lean less: nothing goes past the box's back edge, into a wall behind it.
            lean = math.radians(4 + 13 * rng.random()) * (1 - 0.6 * max(0.0, math.sin(a)))
            out = 0.02 + 0.05 * rng.random()
            length = 0.44 + 0.3 * rng.random()
            blade = bp.strap_leaf(length, SWORD, bands=(1, 3), chevron=0.02, depth=0.014, fold=0.32)
            # The clump is squeezed front to back, to stay inside the box.
            foot_at = Vector((cx + math.cos(a) * out, math.sin(a) * out * 0.6, ground))
            s.part(("LeafDark", "Leaf"), blade, bp.frame(foot_at, a, math.pi / 2 - lean, math.radians(rng.random() * 60 - 30)))
    # Arching leaves: a mound of them between the clumps, light and mid green by turns.
    for cx, n in ((-0.47, 12), (0.0, 12), (0.47, 12)):
        for i in range(n):
            a = TAU * i / n + rng.random() * 0.4
            # The ones toward the front and the back stand up more, to stay over the box.
            pitch = math.radians(20 + 24 * rng.random() + (44 if math.sin(a) > 0 else 32) * abs(math.sin(a)))
            length = 0.3 + 0.14 * rng.random()
            blade = bp.strap_leaf(length, [(0.25, 0.04), (0.62, 0.045)], depth=0.008, fold=0.3)
            foot_at = Vector((cx + math.cos(a) * 0.04, math.sin(a) * 0.025, ground + 0.04))
            s.part(("Leaf" if i % 2 else "LeafLight",), blade, bp.frame(foot_at, a, pitch, 0.0))
    # Vines over its front edge (its back is left clear, to stand against a wall).
    for j, (x, drop) in enumerate(((-0.8, 0.3), (-0.1, 0.22), (0.5, 0.36))):
        vine(s, rng, (x, -(bd / 2 - 0.05), rim - 0.035), -90, drop, count0=j, out=0.05)
    s.finish("planter_leaves", parent=root, weighted=False)
    return root


# ---- Build, export, review --------------------------------------------------------------------------

MAKERS = {"fiddle_leaf": fiddle_leaf, "palm": palm, "bird_of_paradise": bird_of_paradise, "pothos": pothos, "planter": planter}
SHOTS = {"fiddle_leaf": (0.9, 4.6), "palm": (0.9, 4.8), "bird_of_paradise": (1.0, 5.2), "pothos": (0.6, 3.4), "planter": (0.6, 4.6)}


def main(write=True):
    ao.clear()
    roots = [MAKERS[name]() for name in PLANTS]
    if write:
        ao.export("greenery")
    return roots


def review(roots):
    paths = fk.sheets("greenery", roots, SHOTS, views=("tq", "front", "side", "top"))
    if not fk.wanted():
        paths.append(ao.sheet("greenery_lineup", [(fk.only(roots, *PLANTS, spread=1.5), v) for v in ("front", "tq")], cell=(1100, 560), target=(3.2, 0, 0.85), dist=10.5))
    fk.only(roots, *PLANTS)()
    return paths


if __name__ == "__main__" and bpy.app.background:
    roots = main()
    fk.report(roots)
    print("glb:", os.path.getsize(os.path.join(ao.MODELS, "greenery.glb")), "bytes")
    if fk.wanted() is not None:
        for path in review(roots):
            print("sheet:", path)
