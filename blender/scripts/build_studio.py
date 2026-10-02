"""What a content studio works at and with: a long oak table and a podcast desk with two mic arms,
a video screen on its stand, the stock ticker's bar, a softbox, a camera on a tripod and a paper
backdrop, and the furniture round them (a lounge chair, a stool, a credenza, a neon sign's board).
Modelled by this script and exported to src/client/models/studio.glb for
src/client/world/office/furniture-studio.ts, which stands a painted copy wherever the office builder
put one (src/shared/furniture.ts has each kind's footprint). The shared helpers are in furnkit.py
and aokit.py, and the conventions in blender/README.md.

Headless, from the repo root (`-- --shots` also writes a review sheet per piece and one of a set
made of them; `-- --shots=<piece>,<piece>` writes only those pieces' sheets):

    blender --background --factory-startup --python blender/scripts/build_studio.py [-- --shots]

Each piece is a root of its own, named for its kind with underscores (`long_table`,
`podcast_desk`, `screen`, `ticker`, `softbox`, `camera`, `backdrop`, `lounge_chair`, `stool`,
`credenza`, `neon`), on the floor at the origin under the middle of its kind's footprint, its front
toward the office's +z. The look is oak and black steel, slim legs and rounded edges.

What shows a picture or words is the office's own, laid over the model: the screen's face (FACE
below), the ticker's two faces (TICKER) and the neon's letters (NEON), whose numbers
furniture-studio.ts copies. The roots' names and the material names are a contract with it and
with tests/studio-model.test.ts, so rename them in all three places. Top, Body, Glow, Paper, Cloth,
Cabinet and Neon are each a piece's own colour (the office builder's paint).
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix

# Run headless, Blender doesn't put this folder on the import path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao
import furnkit as fk
from furnkit import at, spin
from aokit import TAU

# Preview colours only: furniture-studio.ts paints every material by name. The ones a piece is
# painted in are its kind's own colour here; Steel is the office's ink, Oak the tables' wood.
COLORS = {
    "Top": "#c9a36b",
    "Steel": "#2b2d42",
    "Chrome": "#c9ced6",
    "Oak": "#c9a36b",
    "Body": "#2b2d42",
    "Shade": "#22242e",
    "Glow": "#f7f3ea",
    "Camera": "#4a4e69",
    "Lens": "#7fb7e6",
    "Tally": "#ef476f",
    "Paper": "#218cff",
    "Cloth": "#e9dfcf",
    "Cabinet": "#b98554",
    "Panel": "#1b1d2e",
    "Neon": "#ff5fa2",
}

# How high the ceiling is (WALL_HEIGHT in src/shared/layout.ts): what hangs, hangs from there.
CEILING = 6.8


def piece():
    return fk.Piece(COLORS)


def foot(bm, x, z, r=0.02):
    """A rubber foot standing on the floor at (x, z), for a leg to end in."""
    fk.turned(bm, [(0.0, 0.0), (r * 0.8, 0.0), (r, 0.006), (r, 0.022), (r * 0.6, 0.03), (0.0, 0.03)], x=x, z=z, segs=10)


def tripod(p, x, z, hub, reach, r, first=90.0, brace=None):
    """Three legs from a hub `hub` up the column at (x, z), out to feet `reach` away, the first
    toward `first` degrees (90 is the front); `brace` is how high up the column their stays join."""
    for k in range(3):
        a = math.radians(first + 120 * k)
        fx, fz = x + reach * math.cos(a), z + reach * math.sin(a)
        p.add("Steel", fk.rod, (fx, 0.02, fz), (x, hub, z), r * 0.8, r, segs=8)
        p.add("Steel", foot, fx, fz, r * 1.5)
        if brace is not None:
            mx, mz = x + reach * 0.5 * math.cos(a), z + reach * 0.5 * math.sin(a)
            p.add("Steel", fk.rod, (mx, 0.02 + (hub - 0.02) * 0.5, mz), (x, brace, z), r * 0.5, segs=6)


def loop_leg(p, x, depth, top, tube=0.045, thick=0.03):
    """A black steel leg frame at `x`: two posts `depth` apart, a runner along the floor and a
    rail under the table's top at `top`."""
    for sz in (-1, 1):
        p.add("Steel", fk.block, x, top / 2, sz * (depth / 2 - tube / 2), thick, top, tube, bevel=0.006, segs=1)
    p.add("Steel", fk.block, x, tube / 2, 0, thick, tube, depth, bevel=0.006, segs=1)
    p.add("Steel", fk.block, x, top - tube / 2, 0, thick, tube, depth, bevel=0.006, segs=1)


# ---- The long table ---------------------------------------------------------------------------------
#
# The table a team sits round: one long oak top, thin at its edge, on two black steel frames with a
# beam between them, and a strip of sockets let into its middle.

LONG_TABLE = {"w": 3.6, "d": 1.2, "top": 0.76}


def long_table():
    w, d, top = LONG_TABLE["w"], LONG_TABLE["d"], LONG_TABLE["top"]
    p = piece()
    under = top - 0.055
    p.add("Top", fk.slab, w - 0.04, d - 0.04, under, top, corner=0.07, edge=0.01, bottom=0.038, csegs=4, esegs=3)
    for sx in (-1, 1):
        loop_leg(p, sx * (w / 2 - 0.42), d - 0.3, under + 0.005)
    p.add("Steel", fk.block, 0, under - 0.035, 0, w - 0.84, 0.06, 0.04, bevel=0.006, segs=1)
    # The sockets: a strip in the middle of the top, a hair proud of it.
    p.add("Steel", fk.block, 0, top + 0.002, 0, 0.56, 0.01, 0.11, bevel=0.004, segs=1)
    return p.finish("long_table")


# ---- The podcast desk -------------------------------------------------------------------------------
#
# A desk for two voices: a soft-cornered oak top on the same steel frames, a boom arm clamped to its
# back edge either side with a microphone hung toward whoever sits at its front, and a little mixer
# between them.

PODCAST = {"w": 2.0, "d": 1.0, "top": 0.76}


def mic(p, x, y, z, yaw):
    """A microphone at (x, y, z), its head toward the front and turned `yaw` inward: a dark body
    and a bright grille."""
    turn = spin(yaw=yaw, tilt=math.radians(78))
    p.add("Steel", fk.turned, [(0.0, -0.075), (0.02, -0.075), (0.027, -0.066), (0.027, 0.02), (0.0, 0.02)], x=x, y=y, z=z, segs=12, turn=turn)
    p.add("Chrome", fk.turned, [(0.0, 0.02), (0.031, 0.02), (0.033, 0.03), (0.033, 0.07), (0.026, 0.092), (0.012, 0.102), (0.0, 0.104)], x=x, y=y, z=z, segs=12, turn=turn)


def podcast_desk():
    w, d, top = PODCAST["w"], PODCAST["d"], PODCAST["top"]
    p = piece()
    under = top - 0.055
    p.add("Top", fk.slab, w - 0.04, d - 0.04, under, top, corner=0.18, edge=0.01, bottom=0.038, csegs=6, esegs=3)
    for sx in (-1, 1):
        loop_leg(p, sx * (w / 2 - 0.3), d - 0.32, under + 0.005)
    p.add("Steel", fk.block, 0, under - 0.035, 0, w - 0.6, 0.06, 0.04, bevel=0.006, segs=1)
    back = -(d / 2 - 0.02)
    for sx in (-1, 1):
        bx = sx * 0.62
        # The clamp on the back edge, and the post the arm turns on.
        p.add("Steel", fk.block, bx, top - 0.02, back + 0.02, 0.07, 0.1, 0.06, bevel=0.01, segs=1)
        base, elbow, tip = (bx, top + 0.14, back + 0.03), (sx * 0.6, 1.36, -0.2), (sx * 0.46, 1.25, 0.06)
        p.add("Steel", fk.rod, (bx, top + 0.02, back + 0.03), base, 0.014, segs=8)
        p.add("Steel", fk.rod, base, elbow, 0.011, segs=8)
        p.add("Steel", fk.rod, elbow, tip, 0.011, segs=8)
        for joint in (base, elbow, tip):
            p.add("Chrome", fk.ball, *joint, 0.021, segs=10, rings=6)
        # The mic hangs from the arm's end, turned in a little toward the middle of the desk.
        hang = (tip[0], tip[1] - 0.1, tip[2] + 0.02)
        p.add("Steel", fk.rod, tip, hang, 0.007, segs=6)
        mic(p, hang[0], hang[1] - 0.012, hang[2] + 0.01, yaw=-sx * 0.22)
    # The mixer, tipped up toward the front, with its knobs.
    tip_up = spin(tilt=math.radians(10))
    p.add("Steel", fk.block, 0, top + 0.035, -0.2, 0.36, 0.05, 0.22, bevel=0.012, segs=2, turn=tip_up)
    for i in range(4):
        for j in range(2):
            p.add("Chrome", fk.turned, [(0.0, 0.0), (0.013, 0.0), (0.011, 0.014), (0.0, 0.014)],
                  x=-0.12 + i * 0.08, y=top + 0.066 + (0.006 if j == 0 else -0.008), z=-0.235 + j * 0.08, segs=8, turn=tip_up)
    return p.finish("podcast_desk")


# ---- The video screen -------------------------------------------------------------------------------
#
# A big flat screen on a studio cart: two black steel posts on skids, an oak shelf across them and
# a soundbar under the screen. The office lays the picture on its face: FACE wide and high, its
# middle FACE["y"] up, a hair in front of the body.

SCREEN = {"w": 2.3, "d": 0.5, "top": 1.85}
FACE = {"w": 1.98, "h": 1.11, "y": 1.22, "z": 0.032}


def screen():
    p = piece()
    y = FACE["y"]
    p.add("Body", fk.block, 0, y, 0, FACE["w"] + 0.08, FACE["h"] + 0.08, 0.06, bevel=0.012, segs=2)
    for sx in (-1, 1):
        p.add("Steel", fk.block, sx * 0.5, 0.67, -0.055, 0.06, 1.26, 0.035, bevel=0.006, segs=1)
        p.add("Steel", fk.block, sx * 0.5, 0.03, 0, 0.07, 0.06, 0.46, bevel=0.014, segs=2)
    p.add("Steel", fk.block, 0, y, -0.045, 1.1, 0.3, 0.03, bevel=0.006, segs=1)
    p.add("Steel", fk.block, 0, 0.2, -0.055, 1.0, 0.045, 0.03, bevel=0.006, segs=1)
    p.add("Oak", fk.slab, 1.24, 0.34, 0.4, 0.435, corner=0.05, edge=0.008, bottom=0.012, z=0.02, csegs=3, esegs=2)
    p.add("Body", fk.block, 0, 0.555, -0.01, 1.1, 0.075, 0.08, bevel=0.03, segs=3)
    return p.finish("screen")


# ---- The stock ticker -------------------------------------------------------------------------------
#
# A long LED bar hung from the ceiling on two rods, a face either side that the office slides the
# market's prices along: each TICKER wide and high, at TICKER["y"], a hair proud of the bar.

TICKER = {"w": 5.84, "h": 0.3, "y": 2.42, "z": 0.072, "length": 6.0}


def ticker():
    p = piece()
    y = TICKER["y"]
    p.add("Steel", fk.block, 0, y, 0, TICKER["length"], 0.4, 0.14, bevel=0.022, segs=2)
    for sx in (-1, 1):
        x = sx * 2.6
        p.add("Steel", fk.turned, [(0.0, 0.0), (0.03, 0.0), (0.03, 0.04), (0.012, 0.07), (0.0, 0.07)], x=x, y=y + 0.2, segs=10)
        p.add("Steel", fk.rod, (x, y + 0.24, 0), (x, CEILING - 0.02, 0), 0.01, segs=6)
        p.add("Steel", fk.turned, [(0.0, 0.0), (0.02, 0.0), (0.06, 0.035), (0.06, 0.05), (0.0, 0.05)], x=x, y=CEILING - 0.05, segs=10)
    return p.finish("ticker")


# ---- The softbox ------------------------------------------------------------------------------------
#
# A studio light: an eight-sided softbox on a light stand, tipped down a little toward whoever it
# lights. Its face is the piece's colour, and glows.

SOFTBOX = {"r": 0.45, "top": 2.0}


def softbox():
    p = piece()
    tripod(p, 0, 0, hub=0.52, reach=0.4, r=0.014, first=-90.0, brace=0.2)
    p.add("Steel", fk.rod, (0, 0.14, 0), (0, 1.3, 0), 0.019, segs=10)
    p.add("Steel", fk.rod, (0, 1.3, 0), (0, 1.6, 0), 0.013, segs=8)
    for y in (0.52, 1.3):
        p.add("Chrome", fk.turned, [(0.0, -0.025), (0.026, -0.025), (0.026, 0.025), (0.0, 0.025)], y=y, segs=10)
    # The yoke the lamp tips on, and the lamp itself: its box opens toward the front.
    p.add("Steel", fk.block, 0, 1.62, -0.03, 0.05, 0.09, 0.09, bevel=0.01, segs=1)
    aim = spin(tilt=math.radians(100))
    back = (0.0, 1.7, -0.19)
    box = [(0.0, 0.0), (0.075, 0.0), (0.085, 0.1), (0.36, 0.37), (0.36, 0.41), (0.335, 0.41), (0.335, 0.39)]
    p.add("Shade", fk.turned, box, x=back[0], y=back[1], z=back[2], segs=8, turn=aim, smooth=False)
    p.add("Glow", fk.turned, [(0.335, 0.39), (0.2, 0.397), (0.0, 0.4)], x=back[0], y=back[1], z=back[2], segs=8, turn=aim, smooth=False)
    return p.finish("softbox")


# ---- The camera -------------------------------------------------------------------------------------
#
# A cinema camera on a tripod, looking toward the front: a boxy body with a carrying handle, a lens
# with a bright front element, a little monitor on top, a pan handle out the back and a red tally
# light.

CAMERA = {"r": 0.4, "top": 1.6}


def camera():
    p = piece()
    tripod(p, 0, 0, hub=1.1, reach=0.36, r=0.016, first=-90.0, brace=0.42)
    p.add("Steel", fk.rod, (0, 0.4, 0), (0, 1.2, 0), 0.02, segs=10)
    p.add("Chrome", fk.turned, [(0.0, -0.03), (0.03, -0.03), (0.03, 0.03), (0.0, 0.03)], y=1.1, segs=10)
    # The head, and the handle you pan it by.
    p.add("Steel", fk.block, 0, 1.235, 0, 0.11, 0.07, 0.12, bevel=0.015, segs=2)
    p.add("Steel", fk.rod, (0.06, 1.23, -0.03), (0.16, 1.125, -0.26), 0.008, segs=6)
    p.add("Chrome", fk.rod, (0.16, 1.125, -0.26), (0.188, 1.096, -0.325), 0.014, segs=8)
    # The body, its handle and its monitor.
    by = 1.36
    p.add("Camera", fk.block, 0, by, -0.03, 0.15, 0.17, 0.27, bevel=0.022, segs=2)
    p.add("Steel", fk.tube, fk.fillet([(0, by + 0.08, -0.13), (0, by + 0.135, -0.13), (0, by + 0.135, 0.07), (0, by + 0.08, 0.07)], 0.03, n=3), 0.011, segs=8)
    p.add("Steel", fk.block, -0.09, by + 0.045, -0.05, 0.014, 0.1, 0.15, bevel=0.005, segs=1)
    p.add("Lens", fk.block, -0.098, by + 0.045, -0.05, 0.003, 0.084, 0.134)
    # The lens: its mount, its barrel and its hood, with the glass set in.
    fwd = spin(tilt=math.radians(90))
    barrel = [(0.0, 0.0), (0.05, 0.0), (0.05, 0.045), (0.058, 0.05), (0.058, 0.105), (0.068, 0.112), (0.068, 0.165), (0.058, 0.165), (0.056, 0.14)]
    p.add("Steel", fk.turned, barrel, y=by, z=0.105, segs=16, turn=fwd)
    p.add("Lens", fk.turned, [(0.056, 0.14), (0.03, 0.15), (0.0, 0.153)], y=by, z=0.105, segs=16, turn=fwd)
    p.add("Chrome", fk.turned, [(0.059, 0.066), (0.0605, 0.066), (0.0605, 0.086), (0.059, 0.086)], y=by, z=0.105, segs=16, turn=fwd)
    p.add("Tally", fk.ball, 0.045, by + 0.093, 0.085, 0.013, segs=8, rings=5)
    return p.finish("camera")


# ---- The backdrop -----------------------------------------------------------------------------------
#
# A roll of coloured paper on a bar between two light stands, pulled down and swept forward along
# the floor.

BACKDROP = {"w": 3.0, "d": 0.5, "top": 2.5}


def ribbon(bm, path, thick, x0, x1):
    """A sheet `thick` thick run across from x0 to x1, following `path` [(z, y), ...] from its top
    to its end on the floor."""
    def offset(i):
        a, b = path[max(i - 1, 0)], path[min(i + 1, len(path) - 1)]
        tz, ty = b[0] - a[0], b[1] - a[1]
        n = math.hypot(tz, ty)
        # The sheet's back is to the left of the way it runs.
        return (path[i][0] + ty / n * thick, path[i][1] - tz / n * thick)

    front = path
    back = [offset(i) for i in range(len(path))]
    section = front + back[::-1]
    fk.sweep(bm, section, x0, x1)


def backdrop():
    p = piece()
    w, top = BACKDROP["w"], BACKDROP["top"]
    bar_y, bar_z = top - 0.06, -0.05
    stand = w / 2 - 0.23
    for sx in (-1, 1):
        tripod(p, sx * stand, bar_z, hub=0.44, reach=0.19, r=0.012, first=0.0 if sx > 0 else 180.0, brace=0.16)
        p.add("Steel", fk.rod, (sx * stand, 0.12, bar_z), (sx * stand, bar_y, bar_z), 0.016, segs=8)
        p.add("Chrome", fk.turned, [(0.0, -0.03), (0.024, -0.03), (0.024, 0.03), (0.0, 0.03)], x=sx * stand, y=bar_y, z=bar_z, segs=10)
        p.add("Chrome", fk.turned, [(0.0, -0.022), (0.022, -0.022), (0.022, 0.022), (0.0, 0.022)], x=sx * stand, y=0.44, z=bar_z, segs=10)
    p.add("Steel", fk.rod, (-stand - 0.04, bar_y, bar_z), (stand + 0.04, bar_y, bar_z), 0.014, segs=8)
    half = stand - 0.1
    roll = 0.055
    p.add("Paper", fk.rod, (-half, bar_y, bar_z), (half, bar_y, bar_z), roll, segs=14)
    # Off the front of the roll, straight down, then round a sweep onto the floor.
    z0 = bar_z + roll - 0.004
    sweep_r = 0.21
    path = [(z0, bar_y), (z0, sweep_r + 0.01)]
    path += [(z0 + sweep_r - sweep_r * math.cos(a), 0.01 + sweep_r - sweep_r * math.sin(a)) for a in (math.pi / 2 * i / 7 for i in range(1, 8))]
    path.append((z0 + sweep_r + 0.035, 0.01))
    p.add("Paper", ribbon, path, 0.008, -half + 0.02, half - 0.02)
    return p.finish("backdrop")


# ---- The lounge chair -------------------------------------------------------------------------------
#
# A tub chair: a low upholstered shell that wraps round from one arm, up over the back and down to
# the other, a deep seat cushion and a back cushion in it, on four slim oak legs. The seat's top is
# where the catalog has its collider's (0.42), and a sitter's hips go a little into it.

CHAIR = {"w": 0.9, "d": 0.9, "seat": 0.42}
SHELL = {"radius": 0.385, "half": 0.055, "wrap": 112.0, "back": 0.74, "arm": 0.57, "foot": 0.17, "z": -0.01}


def shell(bm):
    """The chair's shell, swept round its middle: highest behind the sitter, falling to the arms,
    its top rounded over and its two ends rounded off."""
    rc, half, wrap = SHELL["radius"], SHELL["half"], math.radians(SHELL["wrap"])
    y0, cz = SHELL["foot"], SHELL["z"]
    steps = 18
    stations = []
    # Out past each end by a few shrinking stations, so the arms end round.
    cap = [(math.radians(a), math.cos(math.radians(a))) for a in (85, 60, 30)]
    for a, k in cap:
        stations.append((-wrap - half * math.sin(a) / rc, k))
    stations += [(-wrap + 2 * wrap * i / steps, 1.0) for i in range(steps + 1)]
    for a, k in reversed(cap):
        stations.append((wrap + half * math.sin(a) / rc, k))
    rings = []
    for t, k in stations:
        s = min(1.0, abs(t) / wrap)
        top = SHELL["back"] + (SHELL["arm"] - SHELL["back"]) * ao.ease(s)
        h = half * max(k, 0.12)
        low = 0.03 * max(k, 0.12)
        section = [(-h + low, y0), (-h, y0 + low)]
        section += [(h * math.cos(a), top - half + half * math.sin(a)) for a in (math.pi - math.pi * i / 6 for i in range(7))]
        section += [(h, y0 + low), (h - low, y0)]
        rings.append([bm.verts.new(at((rc + u) * math.sin(t), y, cz - (rc + u) * math.cos(t))) for u, y in section])
    n = len(rings[0])
    faces = [bm.faces.new(rings[0]), bm.faces.new(rings[-1][::-1])]
    for lo, hi in zip(rings, rings[1:]):
        for i in range(n):
            faces.append(bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def lounge_chair():
    p = piece()
    seat = CHAIR["seat"]
    p.add("Cloth", shell)
    p.add("Cloth", fk.slab, 0.64, 0.7, SHELL["foot"], 0.27, corner=0.14, edge=0.02, bottom=0.03, z=0.06, csegs=4, esegs=2)
    p.add("Cloth", fk.slab, 0.66, 0.74, 0.25, seat, corner=0.15, edge=0.065, bottom=0.03, z=0.07, csegs=4, esegs=3)
    p.add("Cloth", fk.slab, 0.5, 0.36, -0.06, 0.06, corner=0.11, edge=0.05, csegs=4, esegs=3,
          turn=((0, 0.575, -0.225), spin(tilt=math.pi / 2 - 0.2)))
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.add("Oak", fk.rod, (sx * 0.33, 0.006, sz * 0.31 + 0.03), (sx * 0.27, SHELL["foot"] + 0.02, sz * 0.25 + 0.03), 0.014, 0.024, segs=10)
    return p.finish("lounge_chair")


# ---- The stool --------------------------------------------------------------------------------------
#
# A bar stool: a round padded seat on an oak disc, four oak legs splayed a little, and a black steel
# ring to rest your feet on.

STOOL = {"r": 0.24, "top": 0.72}


def stool():
    p = piece()
    top = STOOL["top"]
    pad = [(0.0, top - 0.07), (0.16, top - 0.07)] + fk.arc(0.032, 0.19 - 0.032, top - 0.032, -90, 90, 5) + [(0.0, top)]
    p.add("Cloth", fk.turned, pad, segs=24)
    p.add("Oak", fk.turned, [(0.0, top - 0.11), (0.165, top - 0.11), (0.182, top - 0.095), (0.182, top - 0.066), (0.0, top - 0.066)], segs=24)
    rest = 0.27
    ring = []
    for sx, sz in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
        # Its feet stay inside the stool's round footprint.
        a, b = (sx * 0.152, 0.003, sz * 0.152), (sx * 0.095, top - 0.1, sz * 0.095)
        p.add("Oak", fk.rod, a, b, 0.013, 0.02, segs=10)
        k = rest / b[1]
        ring.append((a[0] + (b[0] - a[0]) * k, rest, a[2] + (b[2] - a[2]) * k))
    for a, b in zip(ring, ring[1:] + ring[:1]):
        p.add("Steel", fk.rod, a, b, 0.008, segs=8)
    return p.finish("stool")


# ---- The credenza -----------------------------------------------------------------------------------
#
# A long low cabinet on two black steel skids: an oak case, its doors fluted from end to end, with
# slim steel pulls where they meet.

CREDENZA = {"w": 2.0, "d": 0.48, "top": 0.72}
FLUTES = 60


def flutes(bm, x0, x1, y0, y1, z, depth, n):
    """A fluted front from x0 to x1: `n` upright half-round ribs standing `depth` out of the face
    at `z`. Its ends are open, behind the case's top and foot."""
    cols = []
    per = 3
    for i in range(n * per + 1):
        t = (i % per) / per
        x = x0 + (x1 - x0) * i / (n * per)
        cols.append((x, z + depth * math.sin(math.pi * t) ** 0.8))
    lo = [bm.verts.new(at(x, y0, fz)) for x, fz in cols]
    hi = [bm.verts.new(at(x, y1, fz)) for x, fz in cols]
    for i in range(len(cols) - 1):
        bm.faces.new((lo[i], lo[i + 1], hi[i + 1], hi[i]))


def credenza():
    w, d, top = CREDENZA["w"], CREDENZA["d"], CREDENZA["top"]
    p = piece()
    low = 0.2
    p.add("Cabinet", fk.slab, w - 0.02, d - 0.01, top - 0.035, top, corner=0.02, edge=0.008, csegs=2, esegs=2)
    p.add("Cabinet", fk.slab, w - 0.02, d - 0.01, low, low + 0.035, corner=0.02, edge=0.008, csegs=2, esegs=2)
    for sx in (-1, 1):
        p.add("Cabinet", fk.block, sx * (w / 2 - 0.03), (low + top) / 2, 0, 0.035, top - low - 0.04, d - 0.02, bevel=0.006, segs=1)
    face = d / 2 - 0.035
    p.add("Cabinet", fk.block, 0, (low + top) / 2, face - 0.215, w - 0.08, top - low - 0.04, 0.43)
    p.add("Cabinet", flutes, -(w / 2 - 0.047), w / 2 - 0.047, low + 0.02, top - 0.02, face - 0.001, 0.016, FLUTES)
    for x in (-0.5, 0.5):
        p.add("Steel", fk.block, x, (low + top) / 2 + 0.06, face + 0.022, 0.014, 0.2, 0.014, bevel=0.004, segs=1)
    p.add("Steel", fk.block, 0, (low + top) / 2, face + 0.006, 0.012, top - low - 0.07, 0.024)
    for sx in (-1, 1):
        x = sx * (w / 2 - 0.26)
        for sz in (-1, 1):
            p.add("Steel", fk.block, x, low / 2 + 0.005, sz * (d / 2 - 0.07), 0.03, low + 0.01, 0.03, bevel=0.005, segs=1)
        p.add("Steel", fk.block, x, 0.015, 0, 0.03, 0.03, d - 0.11, bevel=0.005, segs=1)
    return p.finish("credenza")


# ---- The neon sign ----------------------------------------------------------------------------------
#
# A neon sign's board, hung from the ceiling on two wires at head height: a dark panel with a lit
# tube running round it. The office writes the piece's words on it in light (NEON: how wide and
# high the words may be, where their middle is, and how far forward). It hangs at the front of its
# footprint, so stood on the same spot as a wall it lies against the wall's face.

NEON = {"w": 2.1, "h": 0.42, "y": 1.9, "z": 0.083, "board": (2.5, 0.72)}


def neon():
    p = piece()
    bw, bh = NEON["board"]
    y = NEON["y"]
    stand = spin(tilt=math.pi / 2)
    p.add("Panel", fk.slab, bw, bh, -0.01, 0.01, corner=0.12, edge=0.004, csegs=5, esegs=1, turn=((0, y, 0.07), stand))
    # The tube: round the board, a little in from its edge and a little off its face.
    hx, hy, r = bw / 2 - 0.09, bh / 2 - 0.085, 0.085
    loop = [(px, y + py, 0.086) for px, py in fk.rounded_rect(hx, hy, r, 5)]
    p.add("Neon", fk.tube, loop + loop[:2], 0.014, segs=6)
    for sx in (-1, 1):
        x = sx * (bw / 2 - 0.35)
        p.add("Steel", fk.rod, (x, y + bh / 2 - 0.02, 0.066), (x, CEILING - 0.01, 0.066), 0.005, segs=5)
        for sy in (-1, 1):
            p.add("Chrome", fk.turned, [(0.0, 0.0), (0.016, 0.0), (0.016, 0.008), (0.0, 0.008)], x=sx * (bw / 2 - 0.05), y=y + sy * (bh / 2 - 0.05), z=0.08, segs=8, turn=stand)
    return p.finish("neon")


# ---- Build, export, review --------------------------------------------------------------------------

PIECES = [long_table, podcast_desk, screen, ticker, softbox, camera, backdrop, lounge_chair, stool, credenza, neon]

# For the review sheets: how high each piece's middle is, and how far back to stand.
SHOTS = {
    "long_table": (0.45, 7.2), "podcast_desk": (0.7, 5.2), "screen": (0.95, 5.4), "ticker": (2.45, 11.5), "softbox": (1.0, 4.6),
    "camera": (0.8, 3.7), "backdrop": (1.25, 7.2), "lounge_chair": (0.38, 2.5), "stool": (0.36, 1.9), "credenza": (0.36, 4.2),
    "neon": (1.9, 5.2),
}


def main(write=True):
    ao.clear()
    roots = [make() for make in PIECES]
    if write:
        ao.export("studio")
    return roots


def stage(roots):
    """A set for the review: the podcast desk before the backdrop with stools at it, the softbox
    and the camera in front, the screen and the credenza to one side and the chairs to the other."""
    def setup():
        spots = {
            "backdrop": (0.0, -1.6, 0.0), "podcast_desk": (0.0, -0.5, 0.0), "stool": (-0.45, 0.45, 0.0), "softbox": (-1.9, 0.9, 0.5),
            "camera": (0.5, 2.3, 0.0), "screen": (3.4, -0.9, -0.5), "credenza": (-3.6, -1.4, 0.4), "lounge_chair": (-3.2, 0.8, 0.9),
            "long_table": (0.0, 5.0, 0.0), "neon": (0.0, -1.75, 0.0), "ticker": (0.0, 5.0, 0.0),
        }
        for ob in roots:
            ob.hide_render = False
            x, z, turn = spots[ob.name]
            ob.matrix_world = Matrix.Translation(at(x, 0, z)) @ spin(yaw=turn)
    return setup


def review(roots):
    paths = fk.sheets("studio", roots, SHOTS)
    if not fk.wanted():
        paths.append(ao.sheet("studio_set", [(stage(roots), v) for v in ("tq", (-0.6, -1.0, 0.45))], cell=(1100, 700), target=at(0, 1.0, 0.8), dist=14.0))
    fk.only(roots, *[ob.name for ob in roots])()
    return paths


if __name__ == "__main__" and bpy.app.background:
    roots = main()
    fk.report(roots)
    print("glb:", os.path.getsize(os.path.join(ao.MODELS, "studio.glb")), "bytes")
    if fk.wanted() is not None:
        for path in review(roots):
            print("sheet:", path)
