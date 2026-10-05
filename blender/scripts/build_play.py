"""Things to play with: a trampoline, a punching bag on its frame, a vending machine, a ping-pong
table, a foosball table, a floor cushion, a dance mat, a prize wheel and a high striker. Modelled by
this script and exported to src/client/models/play.glb for src/client/world/office/furniture-play.ts,
which stands each piece wherever the office builder put it, and src/client/features/playthings, which
makes them do something. The shared helpers are in aokit.py and the conventions in blender/README.md.

Headless, from the repo root (`-- --shots` also writes a review sheet per piece):

    blender --background --factory-startup --python blender/scripts/build_play.py [-- --shots]

Through the Blender MCP bridge (module globals don't survive between calls, so import it every
time):

    import sys, importlib
    sys.path.insert(0, r"<repo>/blender/scripts")
    import aokit, build_play; importlib.reload(aokit); importlib.reload(build_play)
    build_play.main()

Each piece is a root of its own, named for its kind in snake_case (`trampoline`, `punching_bag`...),
standing on the floor at the origin under the middle of its footprint and facing forward. A part the
code moves hangs under its piece as an object of its own, its origin at the pivot it moves about:

    trampoline_mat            the mat, at its middle: the code dips it under whoever lands
    punching_bag_bag          the bag on its chains, at the hook it hangs from
    vending_machine_can       the can that drops into the tray, at its middle
    ping_pong_paddle, _ball   your paddle (at its grip) and the ball (at its middle)
    foosball_rod_0 .. _7      each rod with its men and its handle, on its own axis; foosball_ball
    prize_wheel_wheel         the wheel, at its hub; prize_wheel_flapper, at the pin it flicks about
    high_striker_puck         the puck on its rail, at its middle; high_striker_bell, at its top

Every piece is inside the footprint shared/furniture.ts gives its kind, and no taller than its `top`
where that's somewhere to stand (the trampoline's mat, the tables' tops, the cushion, the dance mat).
Paint is the material the office paints each piece's own color; the names of the roots, the parts and
the materials are a contract with furniture-play.ts and tests/play-model.test.ts, so rename them in
all three places.
"""
import bpy, bmesh, math, os, sys
from mathutils import Euler, Matrix, Vector

# Run headless, Blender doesn't put this folder on the import path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao
from aokit import TAU

# Preview colours only: furniture-play.ts paints every material by name. Paint is each piece's own
# colour (its kind's in shared/furniture.ts, until someone paints it another), so the one here is
# only for the renders, where review() sets it for each piece in turn.
COLORS = {
    "Paint": "#5bc0eb",
    "Frame": "#3d405b",
    "Chrome": "#adb5bd",
    "Dark": "#2b2d42",
    "White": "#f7f3ea",
    "Wood": "#c98b5a",
    "Red": "#ef476f",
    "Blue": "#118ab2",
    "Yellow": "#ffd166",
    "Green": "#06d6a0",
    "Felt": "#2a9d5f",
    "Net": "#cfd8e3",
    "Ball": "#ff9f1c",
    "Brass": "#e9b949",
    "Glow": "#fff3b0",
}
# The dance mat's nine tiles, each a material of its own (Tile0 at the back left, row by row to Tile8
# at the front right), so the code can light each one under your feet.
TILES = ["#ef476f", "#ffd166", "#06d6a0", "#118ab2", "#b388eb", "#ff9f1c", "#06d6a0", "#ef476f", "#ffd166"]
for _i, _c in enumerate(TILES):
    COLORS[f"Tile{_i}"] = _c

# Each kind's own colour in shared/furniture.ts, for the renders.
PAINT = {
    "trampoline": "#5bc0eb", "punching_bag": "#ef476f", "vending_machine": "#118ab2", "ping_pong": "#1a7f5a",
    "foosball": "#8a5a3b", "cushion": "#b388eb", "dance_mat": "#2b2d42", "prize_wheel": "#ef476f", "high_striker": "#ef476f",
}


def material(name):
    return ao.material(name, COLORS[name])


# ---- Laying things out the office's way -----------------------------------------------------------
#
# Every number below is in the office's axes: (x across, y up, z forward), metres, the piece's origin
# on the floor under its middle. at() turns them into Blender's (z up, forward is -y). These helpers
# are build_lounge.py's, so the pieces shade like the rest of the furniture.

def at(x, y, z):
    return (x, -z, y)


def rounded_rect(hx, hz, r, segs):
    """A rectangle's outline [(x, z), ...] seen from above, 2hx by 2hz, its corners rounded over `r`."""
    pts = []
    for cx, cz, a0 in ((hx - r, hz - r, 0), (-(hx - r), hz - r, 90), (-(hx - r), -(hz - r), 180), (hx - r, -(hz - r), 270)):
        for i in range(segs + 1):
            a = math.radians(a0 + 90 * i / segs)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def slab(bm, w, d, y0, y1, corner, edge, x=0.0, z=0.0, bottom=None, csegs=3, esegs=2):
    """A table top, a pad, a tile: `w` across and `d` deep from y0 up to y1, its corners rounded over
    `corner` seen from above and its top edge over `edge` (its bottom edge over `bottom`, the same
    unless given). Its top and bottom are single flat faces."""
    eb = edge if bottom is None else bottom
    profile = [(eb * (1 - math.sin(a)), y0 + eb * (1 - math.cos(a))) for a in (math.pi / 2 * i / esegs for i in range(esegs + 1))]
    profile += [(edge * (1 - math.cos(a)), y1 - edge + edge * math.sin(a)) for a in (math.pi / 2 * i / esegs for i in range(esegs + 1))]
    rings = []
    for inset, y in profile:
        hx, hz = w / 2 - inset, d / 2 - inset
        r = max(1e-3, min(corner - inset, hx, hz))
        rings.append([bm.verts.new(at(x + px, y, z + pz)) for px, pz in rounded_rect(hx, hz, r, csegs)])
    n = len(rings[0])
    faces = [bm.faces.new(rings[0][::-1]), bm.faces.new(rings[-1])]
    for lo, hi in zip(rings, rings[1:]):
        for k in range(n):
            faces.append(bm.faces.new((lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def block(bm, x, y, z, w, h, d, bevel=0.0, segments=2):
    """A box `w` across, `h` high and `d` deep, its middle at (x, y, z)."""
    ao.box(bm, at(x, y, z), (w, d, h), bevel=bevel, segments=segments)


def span(bm, x0, x1, y0, y1, z0, z1, bevel=0.0):
    """A box from one corner to the other."""
    block(bm, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, abs(x1 - x0), abs(y1 - y0), abs(z1 - z0), bevel)


def rod(bm, a, b, r, rb=None, segs=10):
    """A round bar from `a` to `b` (office axes)."""
    ao.cylinder(bm, at(*a), at(*b), r, rb=rb, segs=segs)


def turned(bm, profile, x=0.0, y=0.0, z=0.0, segs=24):
    """A lathe about the up axis, [(radius, height), ...] counter-clockwise round its section (from
    the bottom middle out and up and back in), standing at (x, y, z)."""
    ao.lathe(bm, profile, center=at(x, y, z), segs=segs)


def facing(bm, profile, x, y, z, segs=24):
    """A lathe about the forward axis, [(radius, forward), ...]: a wheel, a hub, a peg's head."""
    ao.lathe(bm, profile, center=at(x, y, z), rot=(math.pi / 2, 0, 0), segs=segs)


def plate(bm, points, x, y, z, depth, flat=False):
    """A flat outline extruded `depth`: standing up and facing forward, its points (across, up) from
    (x, y) and its middle at `z`; or `flat`, lying down, its points (across, forward) from (x, z) and
    its middle at height `y`."""
    ao.outline(bm, points, depth, center=at(x, y, z), rot=(math.pi / 2, 0, 0) if flat else (0, 0, 0))


def ball(bm, x, y, z, r, segs=10, rings=6):
    ao.ellipsoid(bm, at(x, y, z), (r, r, r), segs=segs, rings=rings)


def arc(r, cr, cy, a0, a1, n):
    """Points [(radius, height)] round part of a circle centred (cr, cy), `r` round, from angle a0 to
    a1 (degrees, 0 pointing out, 90 up): a lathe profile's rounded rim."""
    return [(cr + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))) for a in
            (a0 + (a1 - a0) * i / n for i in range(n + 1))]


# Smooth shading keeps edges sharper than this crisp (a box's corners, a disc's rim).
SHARP = math.radians(44)


class Piece:
    """One object's shapes, a bmesh per material, joined into one object at the end."""

    def __init__(self):
        self.parts = {}

    def add(self, mat, build, *args, **kw):
        """Adds a shape: `build(bm, *args, **kw)`."""
        bm = self.parts.setdefault(mat, bmesh.new())
        build(bm, *args, **kw)

    def finish(self, name, parent=None, origin=None):
        """The object, its origin at `origin` (office axes; the floor under its middle unless given),
        hung from `parent` if it's a part of that piece."""
        obs = []
        for mat, bm in self.parts.items():
            bm.faces.ensure_lookup_table()
            for f in bm.faces:
                f.smooth = True
            me = bpy.data.meshes.new(f"{name}_{mat}")
            bm.to_mesh(me)
            bm.free()
            me.materials.append(material(mat))
            ob = bpy.data.objects.new(f"{name}_{mat}", me)
            bpy.context.scene.collection.objects.link(ob)
            obs.append(ob)
        ob = ao.join(obs[0], obs[1:]) if len(obs) > 1 else obs[0]
        ob.data.set_sharp_from_angle(angle=SHARP)
        ob.name = name
        # The mesh is named apart from its node, so the loader never has to tell them apart.
        ob.data.name = name + "_mesh"
        if origin is not None:
            ao.set_origin(ob, at(*origin))
        if parent is not None:
            ob.parent = parent
            ob.matrix_parent_inverse = Matrix.Identity(4)
        return ob


# ---- The trampoline -------------------------------------------------------------------------------
#
# Round, 2.5 across: a dark mat stretched inside a padded ring in the piece's colour, on a tube frame
# with six splayed legs. The mat's top is where you stand (shared/furniture.ts's top), and it's an
# object of its own with rings of vertices the code pushes down under whoever lands on it.

TRAMPOLINE = {"r": 1.25, "top": 0.3, "mat": 0.96}


def trampoline():
    top, mat_r = TRAMPOLINE["top"], TRAMPOLINE["mat"]
    s = Piece()
    ring = 1.14
    s.add("Frame", ao.torus, at(0, top - 0.055, 0), ring, 0.03, n=36, m=6)
    for i in range(6):
        a = TAU * (i + 0.5) / 6
        x, z = math.cos(a), math.sin(a)
        s.add("Frame", rod, (x * ring, top - 0.055, z * ring), (x * (ring + 0.05), 0.02, z * (ring + 0.05)), 0.028, segs=8)
        s.add("Dark", rod, (x * (ring + 0.05), 0.0, z * (ring + 0.05)), (x * (ring + 0.05), 0.03, z * (ring + 0.05)), 0.042, segs=8)
    # The pad over the springs: a flat ring with rolled edges, a touch proud of the mat.
    pad = [(mat_r - 0.01, top - 0.06), (1.225, top - 0.06)] + arc(0.035, 1.215, top - 0.022, -70, 90, 4)
    pad += [(mat_r + 0.02, top + 0.013), (mat_r - 0.012, top - 0.004), (mat_r - 0.01, top - 0.06)]
    s.add("Paint", turned, pad, segs=40)
    # What you'd see of the mat from underneath, which the mat itself (drawn from above only) isn't.
    s.add("Dark", turned, [(0.0, top - 0.03), (mat_r, top - 0.03)], segs=24)
    root = s.finish("trampoline")

    m = Piece()
    rings = [(mat_r * k / 5, top) for k in range(5, -1, -1)]
    m.add("Dark", turned, rings, segs=24)
    m.finish("trampoline_mat", parent=root, origin=(0, top, 0))
    return root


# ---- The punching bag -----------------------------------------------------------------------------
#
# A heavy bag hung from a frame like a doorway: two uprights on feet and a bar across their tops, the
# bag on four chains from a hook under the middle of the bar. It swings front to back between the
# uprights, so the frame stays out of its way. The bag, its bands and its chains are one object, its
# origin at the hook.

BAG = {"hook": 1.98, "top": 1.72, "bottom": 0.74, "r": 0.18}


def punching_bag():
    s = Piece()
    X, H = 0.4, 2.04
    for sx in (-1, 1):
        s.add("Frame", rod, (sx * X, 0.03, 0), (sx * X, H, 0), 0.03, segs=10)
        s.add("Frame", block, sx * X, 0.03, 0, 0.07, 0.06, 0.48, bevel=0.02)
        s.add("Frame", rod, (sx * X, 1.74, 0), (sx * (X - 0.24), H, 0), 0.018, segs=8)
        for sz in (-1, 1):
            s.add("Dark", block, sx * X, 0.012, sz * 0.205, 0.07, 0.024, 0.07, bevel=0.008)
    s.add("Frame", rod, (-X - 0.03, H, 0), (X + 0.03, H, 0), 0.03, segs=10)
    s.add("Chrome", rod, (0, BAG["hook"] - 0.01, 0), (0, H - 0.02, 0), 0.014, segs=8)
    root = s.finish("punching_bag")

    b = Piece()
    r, y0, y1 = BAG["r"], BAG["bottom"], BAG["top"]
    body = [(0.0, y0), (0.11, y0)] + arc(0.07, r - 0.07, y0 + 0.07, -90, 0, 4)[1:]
    body += arc(0.07, r - 0.07, y1 - 0.07, 0, 90, 4) + [(0.0, y1)]
    b.add("Paint", turned, body, segs=20)
    for y in (y0 + 0.2, y1 - 0.2):
        b.add("Dark", turned, [(r - 0.004, y - 0.035), (r + 0.007, y - 0.03), (r + 0.007, y + 0.03), (r - 0.004, y + 0.035)], segs=20)
    b.add("Chrome", turned, [(0.1, y1 - 0.004), (0.116, y1 - 0.004), (0.116, y1 + 0.012), (0.1, y1 + 0.012), (0.1, y1 - 0.004)], segs=16)
    for sx in (-1, 1):
        for sz in (-1, 1):
            b.add("Chrome", rod, (sx * 0.076, y1 + 0.006, sz * 0.076), (0, BAG["hook"], 0), 0.008, segs=5)
    b.add("Chrome", ball, 0, BAG["hook"], 0, 0.022, segs=8, rings=5)
    b.finish("punching_bag_bag", parent=root, origin=(0, BAG["hook"], 0))
    return root


# ---- The vending machine --------------------------------------------------------------------------
#
# A tall cabinet in the piece's colour: a display window on the left with four shelves of cans, a lit
# sign over it, a keypad and a coin slot down the right, and a tray under the window that a can drops
# into (an object of its own, lying on its side in the tray, which the code shows when you buy one).

VENDING = {"w": 0.96, "h": 1.93, "front": 0.34, "back": -0.38}


def vending_machine():
    s = Piece()
    hw, h, f, back = VENDING["w"] / 2, VENDING["h"], VENDING["front"], VENDING["back"]
    inner = 0.2
    wx0, wx1, wy0, wy1 = -hw + 0.05, 0.14, 0.6, 1.72
    s.add("Paint", span, -hw, hw, 0.03, h, back, inner, bevel=0.02)
    # The front, round the window: a stile, the control panel, the header and the base the tray is in.
    s.add("Paint", span, -hw, wx0, 0.03, h, inner - 0.02, f, bevel=0.015)
    s.add("Paint", span, wx1, hw, 0.03, h, inner - 0.02, f, bevel=0.015)
    s.add("Paint", span, wx0 - 0.02, wx1 + 0.02, wy1, h, inner - 0.02, f, bevel=0.015)
    s.add("Paint", span, wx0 - 0.02, wx1 + 0.02, 0.03, wy0, inner - 0.02, f, bevel=0.015)
    for sx in (-1, 1):
        for sz in (back + 0.07, f - 0.07):
            s.add("Dark", block, sx * (hw - 0.08), 0.015, sz, 0.1, 0.03, 0.1)
    # Inside the window: a dark back, and the shelves the cans stand on.
    s.add("Dark", span, wx0, wx1, wy0, wy1, inner, inner + 0.006)
    cans = ["Red", "Yellow", "Green", "White"]
    for row in range(4):
        y = wy0 + 0.02 + row * 0.28
        s.add("Chrome", span, wx0, wx1, y - 0.012, y, inner, f - 0.02)
        for j in range(5):
            x = wx0 + 0.06 + j * 0.105
            s.add(cans[(row + j) % 4] if row % 2 else cans[row % 4], rod, (x, y, inner + 0.065), (x, y + 0.15, inner + 0.065), 0.04, segs=10)
            s.add("Chrome", rod, (x, y + 0.15, inner + 0.065), (x, y + 0.158, inner + 0.065), 0.034, segs=10)
    # The lit sign over the window.
    s.add("Glow", span, wx0, wx1, wy1 + 0.05, h - 0.05, f, f + 0.008, bevel=0.003)
    # The controls: a plate with a little display, a keypad and a coin slot.
    px0, px1 = wx1 + 0.05, hw - 0.05
    s.add("Dark", span, px0, px1, 1.0, 1.52, f, f + 0.008, bevel=0.003)
    s.add("Glow", span, px0 + 0.03, px1 - 0.03, 1.4, 1.48, f + 0.008, f + 0.013)
    for row in range(4):
        for col in range(3):
            s.add("White", block, px0 + 0.045 + col * 0.055, 1.33 - row * 0.055, f + 0.011, 0.038, 0.034, 0.006)
    s.add("Chrome", span, px0 + 0.07, px1 - 0.07, 1.06, 1.1, f + 0.008, f + 0.014)
    s.add("White", span, px0, px1, 0.52, 0.9, f, f + 0.006, bevel=0.003)
    # The tray: a dark mouth in the base, and a lip the can lands behind.
    tx0, tx1 = wx0 + 0.04, wx1 - 0.04
    s.add("Dark", span, tx0, tx1, 0.2, 0.44, f, f + 0.006)
    s.add("Chrome", span, tx0 - 0.02, tx1 + 0.02, 0.17, 0.2, f, f + 0.06, bevel=0.006)
    s.add("Chrome", span, tx0 - 0.02, tx1 + 0.02, 0.2, 0.235, f + 0.046, f + 0.06, bevel=0.004)
    root = s.finish("vending_machine")

    c = Piece()
    cx, cy, cz = (tx0 + tx1) / 2, 0.2 + 0.034, f + 0.024
    c.add("Red", rod, (cx - 0.07, cy, cz), (cx + 0.07, cy, cz), 0.034, segs=10)
    for sx in (-1, 1):
        c.add("Chrome", rod, (cx + sx * 0.07, cy, cz), (cx + sx * 0.076, cy, cz), 0.029, segs=10)
    c.finish("vending_machine_can", parent=root, origin=(cx, cy, cz))
    return root


# ---- The ping-pong table --------------------------------------------------------------------------
#
# A full-size table, 1.525 across and 2.74 long with its ends toward the front and the back (so the
# front of the piece is an end, where you stand to play): the top in the piece's colour with its white
# lines, a net across the middle, a frame and four legs. A paddle lies on the far half; yours and the
# ball, objects of their own, lie on the near one until a rally starts.

PING_PONG = {"w": 1.525, "d": 2.74, "top": 0.76, "net": 0.1525}


def paddle(p, x, y, z, face, toward):
    """A paddle lying flat with its blade's middle at (x, z) and its handle toward `toward` (+1 the
    front, -1 the back)."""
    p.add(face, turned, [(0.0, 0.0), (0.078, 0.0), (0.082, 0.004), (0.082, 0.01), (0.078, 0.014), (0.0, 0.014)], x=x, y=y, z=z, segs=16)
    p.add("Wood", block, x, y + 0.007, z + toward * 0.125, 0.028, 0.02, 0.11, bevel=0.006)


def ping_pong():
    w, d, top = PING_PONG["w"], PING_PONG["d"], PING_PONG["top"]
    s = Piece()
    s.add("Paint", slab, w, d, top - 0.028, top, corner=0.02, edge=0.004)
    line = 0.02
    for sx in (-1, 1):
        s.add("White", block, sx * (w / 2 - line / 2 - 0.002), top + 0.0012, 0, line, 0.0024, d - 0.004)
    for sz in (-1, 1):
        s.add("White", block, 0, top + 0.0012, sz * (d / 2 - line / 2 - 0.002), w - 0.004, 0.0024, line)
    s.add("White", block, 0, top + 0.0012, 0, 0.006, 0.0024, d - 0.004)
    # The net, its tape along the top, and a post clamped on at either side.
    net = PING_PONG["net"]
    s.add("Net", block, 0, top + net / 2 - 0.005, 0, w - 0.06, net - 0.02, 0.005)
    s.add("White", block, 0, top + net - 0.009, 0, w - 0.05, 0.018, 0.012)
    for sx in (-1, 1):
        s.add("Dark", block, sx * (w / 2 - 0.012), top + net / 2 - 0.02, 0, 0.022, net + 0.06, 0.034, bevel=0.005)
    # The frame under the top, and its legs.
    s.add("Frame", span, -0.62, 0.62, top - 0.09, top - 0.028, -1.2, 1.2, bevel=0.01)
    for sz in (-1, 1):
        for sx in (-1, 1):
            s.add("Frame", rod, (sx * 0.55, 0.03, sz * 0.95), (sx * 0.55, top - 0.08, sz * 0.95), 0.028, segs=8)
            s.add("Dark", rod, (sx * 0.55, 0.0, sz * 0.95), (sx * 0.55, 0.035, sz * 0.95), 0.042, segs=8)
        s.add("Frame", rod, (-0.55, 0.22, sz * 0.95), (0.55, 0.22, sz * 0.95), 0.02, segs=8)
    s.add("Frame", rod, (0, 0.22, -0.95), (0, 0.22, 0.95), 0.02, segs=8)
    paddle(s, -0.3, top, -0.82, "Blue", -1)
    root = s.finish("ping_pong")

    p = Piece()
    paddle(p, 0.3, top, 0.82, "Red", 1)
    # At the middle of its grip: the code stands it on end there.
    p.finish("ping_pong_paddle", parent=root, origin=(0.3, top + 0.007, 0.82 + 0.125))
    b = Piece()
    b.add("Ball", ball, 0.12, top + 0.024, 0.9, 0.024, segs=10, rings=6)
    b.finish("ping_pong_ball", parent=root, origin=(0.12, top + 0.024, 0.9))
    return root


# ---- The foosball table ---------------------------------------------------------------------------
#
# A cabinet on four legs with a green field sunk into it, a goal at either end, and eight rods across
# it: the red team's handles toward the front, the blue team's toward the back. Each rod is an object
# of its own with its men and its handle, its origin on its axis, so the code can spin it; the ball's
# one too.

FOOSBALL = {"l": 1.4, "w": 0.6, "top": 0.9, "field": 0.805, "rod": 0.86}
# From the left end: whose rod it is and how many men are on it.
RODS = [("Red", 1), ("Red", 2), ("Blue", 3), ("Red", 5), ("Blue", 5), ("Red", 3), ("Blue", 2), ("Blue", 1)]
ROD_GAP = 0.15
MEN = {1: [0.0], 2: [-0.12, 0.12], 3: [-0.155, 0.0, 0.155], 5: [-0.19, -0.095, 0.0, 0.095, 0.19]}


def foosball():
    L, W, field, ry = FOOSBALL["l"], FOOSBALL["w"], FOOSBALL["field"], FOOSBALL["rod"]
    s = Piece()
    wall_top = FOOSBALL["top"] - 0.012
    for sz in (-1, 1):
        s.add("Paint", span, -L / 2, L / 2, 0.58, wall_top, sz * (W / 2 - 0.045), sz * W / 2, bevel=0.012)
        s.add("Dark", span, -L / 2, L / 2, wall_top, FOOSBALL["top"], sz * (W / 2 - 0.05), sz * (W / 2 + 0.004), bevel=0.004)
    for sx in (-1, 1):
        s.add("Paint", span, sx * (L / 2 - 0.045), sx * L / 2, 0.58, wall_top, -W / 2 + 0.03, W / 2 - 0.03, bevel=0.012)
        s.add("Dark", span, sx * (L / 2 - 0.05), sx * (L / 2 + 0.004), wall_top, FOOSBALL["top"], -W / 2 + 0.03, W / 2 - 0.03, bevel=0.004)
        # The goal: a dark mouth in the end wall.
        s.add("Dark", span, sx * (L / 2 - 0.05), sx * (L / 2 - 0.044), field, field + 0.065, -0.1, 0.1)
    s.add("Paint", span, -L / 2 + 0.02, L / 2 - 0.02, 0.58, 0.64, -W / 2 + 0.02, W / 2 - 0.02)
    s.add("Felt", span, -L / 2 + 0.04, L / 2 - 0.04, 0.64, field, -W / 2 + 0.04, W / 2 - 0.04)
    s.add("White", block, 0, field + 0.0012, 0, 0.012, 0.0024, W - 0.1)
    s.add("White", turned, [(0.085, field), (0.1, field), (0.1, field + 0.0024), (0.085, field + 0.0024), (0.085, field)], segs=20)
    for sx in (-1, 1):
        for sz in (-1, 1):
            s.add("Dark", block, sx * (L / 2 - 0.07), 0.3, sz * (W / 2 - 0.07), 0.09, 0.6, 0.09, bevel=0.015)
        s.add("Dark", block, sx * (L / 2 - 0.07), 0.2, 0, 0.05, 0.05, W - 0.2, bevel=0.01)
    root = s.finish("foosball")

    for i, (team, n) in enumerate(RODS):
        x = (i - (len(RODS) - 1) / 2) * ROD_GAP
        side = 1 if team == "Red" else -1
        r = Piece()
        r.add("Chrome", rod, (x, ry, -0.355), (x, ry, 0.355), 0.008, segs=8)
        r.add("Chrome", rod, (x, ry, -side * 0.355), (x, ry, -side * 0.37), 0.014, segs=8)
        r.add(team, rod, (x, ry, side * 0.305), (x, ry, side * 0.395), 0.02, segs=10)
        for z in MEN[n]:
            r.add(team, block, x, ry - 0.005, z, 0.034, 0.075, 0.03)
            r.add(team, block, x, ry - 0.036, z, 0.028, 0.02, 0.042)
            r.add(team, ball, x, ry + 0.045, z, 0.019, segs=6, rings=4)
        r.finish(f"foosball_rod_{i}", parent=root, origin=(x, ry, 0))
    b = Piece()
    b.add("White", ball, 0.07, field + 0.017, 0.06, 0.017, segs=10, rings=6)
    b.finish("foosball_ball", parent=root, origin=(0.07, field + 0.017, 0.06))
    return root


# ---- The floor cushion ----------------------------------------------------------------------------
#
# A plump round cushion to sit cross-legged on, in the piece's colour: bulging round its middle with
# piping where it's sewn, and a pale button pulled into the middle of its top, which is where a sitter sits.

CUSHION = {"r": 0.4, "top": 0.14}


def cushion():
    R, H = CUSHION["r"], CUSHION["top"]
    s = Piece()
    half = H / 2
    profile = [(0.0, 0.0), (R - half - 0.02, 0.0)] + arc(half, R - half, half, -90, 90, 8)[1:]
    profile += [(0.1, H), (0.05, H - 0.012), (0.0, H - 0.016)]
    s.add("Paint", turned, profile, segs=32)
    s.add("Paint", ao.torus, at(0, half, 0), R + 0.002, 0.012, n=32, m=6)
    s.add("White", turned, [(0.0, H - 0.018), (0.036, H - 0.016), (0.044, H - 0.006), (0.034, H + 0.004), (0.0, H + 0.008)], segs=12)
    return s.finish("cushion")


# ---- The dance mat --------------------------------------------------------------------------------
#
# A square pad, 1.78 across, with nine tiles in three rows, each a material of its own that the code
# lights under your feet. The four in the middle of each side carry an arrow pointing out. Its top is
# the tiles' tops, where you stand.

DANCE_MAT = {"w": 1.78, "top": 0.05, "tile": 0.52, "pitch": 0.56}
ARROW = [(-0.15, -0.045), (0.02, -0.045), (0.02, -0.12), (0.16, 0.0), (0.02, 0.12), (0.02, 0.045), (-0.15, 0.045)]


def dance_mat():
    W, top, tile, pitch = DANCE_MAT["w"], DANCE_MAT["top"], DANCE_MAT["tile"], DANCE_MAT["pitch"]
    s = Piece()
    s.add("Paint", slab, W, W, 0.0, top - 0.008, corner=0.08, edge=0.012, bottom=0.004)
    for row in range(3):
        for col in range(3):
            s.add(f"Tile{row * 3 + col}", slab, tile, tile, top - 0.02, top, corner=0.045, edge=0.005, x=(col - 1) * pitch, z=(row - 1) * pitch)
    # An arrow on each side's tile, pointing away from the middle: turned from pointing +x.
    for (col, row), turn in (((1, 0), -90), ((0, 1), 180), ((2, 1), 0), ((1, 2), 90)):
        c, sn = math.cos(math.radians(turn)), math.sin(math.radians(turn))
        pts = [(px * c - pz * sn, px * sn + pz * c) for px, pz in ARROW]
        s.add("White", plate, pts, (col - 1) * pitch, top + 0.001, (row - 1) * pitch, 0.004, flat=True)
    return s.finish("dance_mat")


# ---- The prize wheel ------------------------------------------------------------------------------
#
# A wheel of fortune on a stand: a base, a post up the back, and a wheel on an axle facing forward,
# eight wedges in four colours with a peg between each pair and a rim in the piece's colour. A red
# flapper hangs from an arm over the top and clicks over the pegs. The wheel turns about its hub and
# the flapper flicks about its pin: each is an object of its own.
#
# Wedge i runs from i/8 to (i+1)/8 of a turn, counter-clockwise from the top as you face the wheel
# (features/playthings counts them the same way to tell which one stopped under the flapper).

WHEEL = {"hub": 1.2, "r": 0.5, "wedges": 8, "pin": 1.775}
WEDGES = ["Red", "Yellow", "Green", "Blue"]


def prize_wheel():
    hub, R, n = WHEEL["hub"], WHEEL["r"], WHEEL["wedges"]
    s = Piece()
    s.add("Frame", slab, 0.9, 0.5, 0.0, 0.05, corner=0.08, edge=0.015, bottom=0.004)
    s.add("Frame", span, -0.045, 0.045, 0.04, 1.85, -0.17, -0.11, bevel=0.012)
    s.add("Frame", rod, (0, 0.05, -0.22), (0, 0.8, -0.15), 0.02, segs=8)
    s.add("Chrome", rod, (0, hub, -0.12), (0, hub, -0.03), 0.03, segs=10)
    # The arm over the top that the flapper hangs from.
    s.add("Frame", span, -0.03, 0.03, 1.81, 1.85, -0.17, 0.03, bevel=0.008)
    s.add("Chrome", rod, (0, WHEEL["pin"], 0.0), (0, WHEEL["pin"], 0.045), 0.012, segs=8)
    s.add("Frame", span, -0.02, 0.02, WHEEL["pin"] - 0.01, 1.82, -0.005, 0.012)
    root = s.finish("prize_wheel")

    w = Piece()
    w.add("White", facing, [(0.0, -0.03), (R, -0.03), (R, 0.0), (0.0, 0.0)], 0, hub, 0, segs=40)
    seg = TAU / n
    for i in range(n):
        pts = [(-r * math.sin(a), r * math.cos(a)) for r, a in [(0.075, i * seg + seg * k / 4) for k in range(5)]]
        pts += [(-r * math.sin(a), r * math.cos(a)) for r, a in [(R - 0.03, (i + 1) * seg - seg * k / 6) for k in range(7)]]
        w.add(WEDGES[i % len(WEDGES)], plate, pts, 0, hub, 0.003, 0.006)
        a = i * seg
        px, py = -(R - 0.06) * math.sin(a), hub + (R - 0.06) * math.cos(a)
        w.add("Chrome", rod, (px, py, 0.0), (px, py, 0.04), 0.013, segs=8)
    w.add("Paint", ao.torus, at(0, hub, -0.012), R, 0.028, rot=(math.pi / 2, 0, 0), n=40, m=6)
    w.add("Chrome", facing, [(0.0, 0.0), (0.08, 0.0), (0.08, 0.02), (0.045, 0.034), (0.0, 0.038)], 0, hub, 0.004, segs=16)
    w.finish("prize_wheel_wheel", parent=root, origin=(0, hub, 0))

    f = Piece()
    pin = WHEEL["pin"]
    f.add("Red", plate, [(-0.032, 0.012), (0.032, 0.012), (0.0, -0.128)], 0, pin, 0.026, 0.012)
    f.finish("prize_wheel_flapper", parent=root, origin=(0, pin, 0.026))
    return root


# ---- The high striker -----------------------------------------------------------------------------
#
# The fairground test of strength: a tall board in the piece's colour on a base, a scale up its face
# with a green stretch at the top, a rail the puck rides and a brass bell over it. You hit the pad on
# the base, and a mallet leans on the board to do it with. The puck (it slides up the rail) and the
# bell (it wobbles when it's rung) are objects of their own.

STRIKER = {"rail": -0.262, "rest": 0.3, "bell": 2.26, "hang": 2.42, "head": 2.38}


def high_striker():
    rz = STRIKER["rail"]
    s = Piece()
    s.add("Frame", slab, 0.8, 1.0, 0.0, 0.07, corner=0.06, edge=0.015, bottom=0.004)
    s.add("Paint", span, -0.2, 0.2, 0.06, 2.3, -0.38, -0.3, bevel=0.02)
    # A round head on the board, behind the bell, with a yellow ring round it.
    s.add("Paint", facing, [(0.0, -0.04), (0.3, -0.04), (0.3, 0.04), (0.0, 0.04)], 0, STRIKER["head"], -0.34, segs=28)
    s.add("Yellow", ao.torus, at(0, STRIKER["head"], -0.3), 0.27, 0.016, rot=(math.pi / 2, 0, 0), n=28, m=6)
    # The scale: white, with a yellow stretch and then a green one at the top, and a tick every tenth.
    y0, y1 = 0.24, 2.16
    s.add("White", span, -0.1, 0.1, y0, y1, -0.3, -0.294)
    s.add("Yellow", span, -0.1, 0.1, y0 + (y1 - y0) * 0.6, y0 + (y1 - y0) * 0.85, -0.294, -0.291)
    s.add("Green", span, -0.1, 0.1, y0 + (y1 - y0) * 0.85, y1, -0.294, -0.291)
    for k in range(11):
        y = y0 + (y1 - y0) * k / 10
        for sx in (-1, 1):
            s.add("Dark", block, sx * 0.072, y, -0.29, 0.05 if k % 5 == 0 else 0.032, 0.012, 0.004)
    # A row of bulbs up either edge.
    for k in range(6):
        for sx in (-1, 1):
            s.add("Glow", ball, sx * 0.155, 0.42 + k * 0.34, -0.296, 0.026, segs=8, rings=5)
    s.add("Chrome", rod, (0, 0.16, rz), (0, STRIKER["bell"] + 0.02, rz), 0.011, segs=8)
    s.add("Frame", block, 0, 0.14, rz, 0.14, 0.08, 0.09, bevel=0.012)
    # The peg the bell hangs from, out of the head.
    s.add("Frame", span, -0.025, 0.025, STRIKER["hang"] - 0.02, STRIKER["hang"] + 0.02, -0.3, rz + 0.025, bevel=0.006)
    # The pad you hit, and the lever from it to the foot of the rail.
    s.add("Dark", turned, [(0.0, 0.07), (0.16, 0.07), (0.16, 0.12), (0.14, 0.14), (0.0, 0.14)], z=0.24, segs=20)
    s.add("Red", turned, [(0.0, 0.14), (0.075, 0.14), (0.075, 0.146), (0.0, 0.146)], z=0.24, segs=16)
    s.add("Chrome", span, -0.025, 0.025, 0.07, 0.1, rz + 0.03, 0.1)
    # The mallet, leaning on the board.
    s.add("Wood", rod, (0.33, 0.07, 0.12), (0.29, 0.98, -0.2), 0.019, segs=8)
    s.add("Dark", rod, (0.29, 0.98, -0.29), (0.29, 0.98, -0.11), 0.07, segs=12)
    root = s.finish("high_striker")

    p = Piece()
    p.add("Yellow", block, 0, STRIKER["rest"], rz, 0.11, 0.07, 0.07, bevel=0.012)
    p.finish("high_striker_puck", parent=root, origin=(0, STRIKER["rest"], rz))

    b = Piece()
    y = STRIKER["bell"]
    dome = [(0.0, y + 0.012), (0.1, y + 0.012), (0.118, y), (0.122, y + 0.012), (0.106, y + 0.06), (0.07, y + 0.094), (0.03, y + 0.106), (0.0, y + 0.108)]
    b.add("Brass", turned, dome, z=rz, segs=20)
    b.add("Chrome", rod, (0, y + 0.1, rz), (0, STRIKER["hang"] - 0.02, rz), 0.012, segs=8)
    b.finish("high_striker_bell", parent=root, origin=(0, STRIKER["hang"] - 0.02, rz))
    return root


# ---- Build, export, review --------------------------------------------------------------------------

PIECES = [trampoline, punching_bag, vending_machine, ping_pong, foosball, cushion, dance_mat, prize_wheel, high_striker]


def main(write=True):
    ao.clear()
    roots = [make() for make in PIECES]
    if write:
        ao.export("play")
    return roots


def family(root):
    return [root] + [c for c in root.children_recursive]


def only(name):
    """Shows just the piece called `name` (and its parts) in the review renders, in its own colour."""
    def setup():
        ao.material("Paint", PAINT[name])
        shown = {ob.name for ob in family(bpy.data.objects[name])}
        for ob in bpy.context.scene.objects:
            if ob.type == 'MESH':
                ob.hide_render = ob.name not in shown
    return setup


# How to look at each: what to aim at (office axes) and from how far.
LOOKS = {
    "trampoline": ((0, 0.15, 0), 4.3), "punching_bag": ((0, 1.05, 0), 3.9), "vending_machine": ((0, 1.0, 0), 3.5),
    "ping_pong": ((0, 0.45, 0), 4.8), "foosball": ((0, 0.5, 0), 2.7), "cushion": ((0, 0.07, 0), 1.5),
    "dance_mat": ((0, 0.0, 0), 3.9), "prize_wheel": ((0, 0.95, 0), 3.4), "high_striker": ((0, 1.35, 0), 4.7),
}


def review():
    # three's toon materials draw front faces only; show the same, so a face turned the wrong way
    # shows here as a hole rather than first in the office.
    bpy.context.scene.display.shading.show_backface_culling = True
    paths = []
    for make in PIECES:
        name = make.__name__
        target, dist = LOOKS[name]
        paths.append(ao.sheet(f"play_{name}", [(only(name), v) for v in ("tq", "front", "side", "top")], cell=(520, 460), target=at(*target), dist=dist))
    for ob in bpy.context.scene.objects:
        ob.hide_render = False
    return paths


if __name__ == "__main__" and bpy.app.background:
    roots = main()
    for root in roots:
        parts = family(root)
        lo = Vector((min((ob.matrix_world @ Vector(c)).x for ob in parts for c in ob.bound_box),
                     min((ob.matrix_world @ Vector(c)).y for ob in parts for c in ob.bound_box),
                     min((ob.matrix_world @ Vector(c)).z for ob in parts for c in ob.bound_box)))
        hi = Vector((max((ob.matrix_world @ Vector(c)).x for ob in parts for c in ob.bound_box),
                     max((ob.matrix_world @ Vector(c)).y for ob in parts for c in ob.bound_box),
                     max((ob.matrix_world @ Vector(c)).z for ob in parts for c in ob.bound_box)))
        mats = sorted({m.name for ob in parts for m in ob.data.materials})
        print(f"piece: {root.name} {sum(ao.tris(ob) for ob in parts)} tris in {len(parts)} objects, "
              f"x {lo.x:.3f}..{hi.x:.3f}, y {lo.z:.3f}..{hi.z:.3f}, z {-hi.y:.3f}..{-lo.y:.3f}, materials {mats}")
    print("glb:", os.path.getsize(os.path.join(ao.MODELS, "play.glb")), "bytes")
    if "--shots" in ao.args():
        for p in review():
            print("sheet:", p)
