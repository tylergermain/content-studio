"""What a worker wears on the tip of its antenna to say what it runs on: one small emblem per agent
provider, and a plain one for whoever has none. Modelled by this script and exported to
src/client/models/toppers.glb for src/client/world/toppers.ts, which says which emblem each provider
wears and in what colours, and src/client/world/character/worker-antenna.ts, which stands it on the
antenna and turns it. The shared helpers are in furnkit.py and aokit.py, and the conventions in
blender/README.md.

Headless, from the repo root (`-- --shots` also writes one review sheet of them all, from two sides;
`-- --shots=<name>,<name>` writes a four-view sheet of each of those instead):

    blender --background --factory-startup --python blender/scripts/build_toppers.py [-- --shots]

Each emblem is a root of its own, named `topper_<provider id>` (the ids in src/shared/providers.ts)
or `topper_default`, its origin at the point that sits on the antenna's tip: it stands on y = 0, its
middle over the origin, facing the office's +z, 0.12 to 0.16 m across and no more than 0.16 tall, a
few hundred triangles. They are shapes of the office's own, not anyone's logo: the provider's name
is on the worker's card.

    topper_claude     a spark: a ball with six long points and twelve short ones between them
    topper_codex      a ring of six petals, every other one dark
    topper_pi         the letter pi, cut thick
    topper_opencode   a cube's frame stood on a corner, with a small cube inside it
    topper_grok       a lightning bolt
    topper_muse       a crescent with a small star in its mouth
    topper_dsh        a drop with a ring round it
    topper_cursor     a pointer's arrow
    topper_custom     a spanner with a grip
    topper_default    a cut gem with a belt

Every emblem is made of the same two materials, Main and Accent (an emblem may use only Main), so
toppers.ts can paint any of them in any provider's two colours and a provider can swap to another
emblem by its name alone. To add one: write its function here, add it to TOPPERS (and its preview
colours to PREVIEW), run this script, and point a provider at it in toppers.ts. The roots' names,
the two material names and the sizes are a contract with toppers.ts and tests/toppers-model.test.ts.
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Vector

# Run headless, Blender doesn't put this folder on the import path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao
import furnkit as fk
from furnkit import at, spin
from aokit import TAU

# Preview colours only (Main, Accent): toppers.ts paints both by name, in each provider's own two.
PREVIEW = {
    "topper_claude": ("#e8714f", "#ffb38a"),
    "topper_codex": ("#1fa971", "#2b2d42"),
    "topper_pi": ("#8b5cf6", "#d9c8ff"),
    "topper_opencode": ("#8d99ae", "#ff9f1c"),
    "topper_grok": ("#ffc93c", "#2b2d42"),
    "topper_muse": ("#f472b6", "#fff3b0"),
    "topper_dsh": ("#1d7fd1", "#bfe9ff"),
    "topper_cursor": ("#f7f3ea", "#2b2d42"),
    "topper_custom": ("#adb5bd", "#ef8a3c"),
    "topper_default": ("#dfe7ef", "#8d99ae"),
}
COLORS = {"Main": "#e8714f", "Accent": "#ffb38a"}

# How thick a flat emblem is, front to back, and how far its rims are cut back.
THICK = 0.044
RIM = 0.007


def piece():
    return fk.Piece(COLORS)


# ---- Shapes (office axes: x across, y up, z toward the front) ---------------------------------------

def glyph(bm, points, depth=THICK, rim=RIM, z=0.0):
    """A flat outline [(x, y), ...] seen from the front, `depth` thick about `z`, its front and back
    rims cut back over `rim` so it reads as one rounded slab rather than a cut-out."""
    part = bmesh.new()
    front = [part.verts.new(at(x, y, z + depth / 2)) for x, y in points]
    back = [part.verts.new(at(x, y, z - depth / 2)) for x, y in points]
    caps = [part.faces.new(front), part.faces.new(back[::-1])]
    n = len(points)
    for i in range(n):
        part.faces.new((front[i], back[i], back[(i + 1) % n], front[(i + 1) % n]))
    bmesh.ops.recalc_face_normals(part, faces=part.faces[:])
    if rim > 0:
        rims = [e for f in caps for e in f.edges]
        bmesh.ops.bevel(part, geom=rims, offset=rim, segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
    ao._merge(bm, part)


def turned_about(points, degrees, cx=0.0, cy=0.0):
    """An outline turned counter-clockwise (seen from the front) about (cx, cy)."""
    c, s = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    return [(cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c) for x, y in points]


def seated(points, lift=0.002):
    """An outline moved to stand on the antenna's tip: its lowest point just over y = 0 and its
    middle over the origin. Returns it with how far it moved, for what goes with it."""
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    dx, dy = -(min(xs) + max(xs)) / 2, lift - min(ys)
    return [(x + dx, y + dy) for x, y in points], (dx, dy)


def arc(cx, cy, r, a0, a1, n):
    """Points round part of a circle from angle a0 to a1 (degrees, counter-clockwise from +x)."""
    return [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))) for a in (a0 + (a1 - a0) * i / n for i in range(n + 1))]


def spike(bm, center, toward, length, r, inside=0.014, segs=6):
    """A point out of a ball: a cone from `inside` the middle out to `length` along `toward`, open at
    its foot, which the ball hides."""
    d = Vector(toward).normalized()
    c = Vector(center)
    ao.cylinder(bm, at(*(c + d * inside)), at(*(c + d * length)), r, 0.0, segs=segs, cap=False)


# ---- The emblems ------------------------------------------------------------------------------------

def spark():
    """Claude Code: a spark. A small ball with six long points (up, down, across, front and back)
    and twelve short ones halfway between each two of them, so from the front, the side or above it
    is the same eight-pointed twinkle."""
    p = piece()
    c = (0.0, 0.078, 0.0)
    p.add("Accent", fk.ball, *c, 0.029, segs=10, rings=6)
    for axis in ((1, 0, 0), (0, 1, 0), (0, 0, 1)):
        for s in (-1, 1):
            p.add("Main", spike, c, tuple(s * v for v in axis), 0.076, 0.019)
    for a, b in ((0, 1), (1, 2), (0, 2)):
        for sa in (-1, 1):
            for sb in (-1, 1):
                toward = [0, 0, 0]
                toward[a], toward[b] = sa, sb
                p.add("Main", spike, c, toward, 0.054, 0.014)
    return p.finish("topper_claude")


def petals():
    """Codex: a ring of six petals round a hole, every other one dark."""
    p = piece()
    ring, cy = 0.05, 0.077
    for k in range(6):
        a = math.radians(90 + 60 * k)
        p.add("Main" if k % 2 == 0 else "Accent", fk.ball, ring * math.cos(a), cy + ring * math.sin(a), 0.0, 0.031, 0.024, 0.027,
              segs=8, rings=5, turn=spin(roll=a + math.pi / 2))
    return p.finish("topper_codex")


def pi():
    """Pi: the letter, cut thick, with a foot kicked out to the right."""
    p = piece()
    letter = [(-0.052, 0.0), (-0.022, 0.0), (-0.014, 0.098), (0.016, 0.098), (0.016, 0.026), (0.023, 0.008), (0.038, 0.0), (0.058, 0.002),
              (0.074, 0.014), (0.070, 0.034), (0.054, 0.028), (0.046, 0.040), (0.046, 0.098), (0.074, 0.098), (0.074, 0.130), (-0.074, 0.130),
              (-0.074, 0.098), (-0.044, 0.098)]
    p.add("Main", glyph, seated(letter)[0], depth=0.05)
    return p.finish("topper_pi")


def frame():
    """OpenCode: a cube's frame stood on one corner, with a small cube floating inside it."""
    p = piece()
    edge, bar, core = 0.07, 0.02, 0.034
    h = edge / 2
    # Stood on a corner: the cube's long diagonal straight up.
    tip = Matrix.Translation(at(0, 0.002 + (edge + bar) * math.sqrt(3) / 2, 0)) @ Matrix.Rotation(math.atan(math.sqrt(2)), 4, 'X') @ Matrix.Rotation(math.pi / 4, 4, 'Z')

    def cube(bm, bars):
        part = bmesh.new()
        if bars:
            for a, b in ((1, 2), (0, 2), (0, 1)):
                for sa in (-1, 1):
                    for sb in (-1, 1):
                        size, middle = [bar, bar, bar], [0.0, 0.0, 0.0]
                        size[3 - a - b] = edge + bar
                        middle[a], middle[b] = sa * h, sb * h
                        ao.box(part, middle, size)
        else:
            ao.box(part, (0, 0, 0), (core, core, core))
        bmesh.ops.transform(part, matrix=tip, verts=part.verts[:])
        ao._merge(bm, part)

    p.add("Main", cube, True)
    p.add("Accent", cube, False)
    return p.finish("topper_opencode")


def bolt():
    """Grok: a lightning bolt."""
    p = piece()
    zag = [(0.02, 0.154), (-0.068, 0.066), (-0.016, 0.066), (-0.04, 0.0), (0.068, 0.096), (0.016, 0.096), (0.062, 0.154)]
    p.add("Main", glyph, seated(zag)[0], depth=0.05)
    return p.finish("topper_grok")


def crescent():
    """Muse: a crescent moon, leaning back, with a small star in its mouth."""
    p = piece()
    outer, inner, apart = 0.07, 0.056, 0.032
    # Where the two circles cross, and so where each arc starts and ends.
    x = (outer * outer - inner * inner + apart * apart) / (2 * apart)
    a = math.degrees(math.acos(x / outer))
    b = math.degrees(math.atan2(math.sqrt(outer * outer - x * x), x - apart))
    moon = arc(0, 0, outer, a, 360 - a, 14) + arc(apart, 0, inner, 360 - b, b, 10)[1:-1]
    moon, (dx, dy) = seated(turned_about(moon, -24))
    p.add("Main", glyph, moon, rim=0.006)
    sx, sy = turned_about([(0.036, 0.0)], -24)[0]
    p.add("Accent", fk.ball, sx + dx, sy + dy, 0.0, 0.017, segs=4, rings=2, smooth=False)
    return p.finish("topper_muse")


def drop():
    """DeepSeek Harness: a drop, round all the way about, with a ring tipped round its middle."""
    p = piece()
    belly, cy = 0.05, 0.053
    profile = [(belly * math.cos(math.radians(a)), cy + belly * math.sin(math.radians(a))) for a in (-90, -60, -30, 0, 30)]
    profile[0] = (0.0, profile[0][1])
    profile += [(0.029, 0.106), (0.013, 0.132), (0.0, 0.152)]
    p.add("Main", fk.turned, profile, segs=12)
    p.add("Accent", ao.torus, at(0, cy + 0.004, 0), 0.064, 0.0065, rot=(math.radians(22), math.radians(14), 0), n=18, m=5)
    return p.finish("topper_dsh")


def pointer():
    """Cursor: a pointer's arrow, its tip up and to the left."""
    p = piece()
    k = 1.12
    arrow = [(0.0, 0.0), (0.0, -0.115), (0.027, -0.090), (0.047, -0.135), (0.066, -0.127), (0.046, -0.083), (0.083, -0.083)]
    p.add("Main", glyph, seated(turned_about([(x * k, y * k) for x, y in arrow], -8))[0], depth=0.05)
    return p.finish("topper_cursor")


def spanner():
    """A custom agent: an open spanner, leaning, with a grip round its handle."""
    p = piece()
    half, end, head, hy, jaw = 0.016, 0.023, 0.041, 0.112, 0.106
    low = math.degrees(math.acos(half / end))
    high = math.degrees(math.acos(half / head))
    shape = arc(0, end, end, 180 - low, 360 + low, 9)              # round the bottom end, from its left shoulder
    shape += arc(0, hy, head, -high, high, 6)                         # up the handle and round the head's right side
    shape += [(half, jaw), (-half, jaw)]                              # down into the jaw and across it
    shape += arc(0, hy, head, 180 - high, 180 + high, 6)              # round the head's left side, and back down
    lean = 20
    shape, (dx, dy) = seated(turned_about(shape, lean))
    p.add("Main", glyph, shape, depth=0.04, rim=0.006)
    gx, gy = turned_about([(0.0, 0.052)], lean)[0]
    p.add("Accent", fk.block, gx + dx, gy + dy, 0.0, 0.04, 0.026, 0.048, bevel=0.006, segs=1, turn=spin(roll=math.radians(lean)))
    return p.finish("topper_custom")


def gem():
    """No provider (a shared shell, a prisoner, the bartender): a cut gem with a belt."""
    p = piece()
    p.add("Main", fk.turned, [(0.0, 0.002), (0.054, 0.084), (0.054, 0.094), (0.03, 0.134), (0.0, 0.134)], segs=8, smooth=False)
    p.add("Accent", fk.turned, [(0.05, 0.083), (0.059, 0.083), (0.059, 0.095), (0.05, 0.095)], segs=8, smooth=False)
    return p.finish("topper_default")


# ---- Build, export, review --------------------------------------------------------------------------

TOPPERS = [spark, petals, pi, frame, bolt, crescent, drop, pointer, spanner, gem]


def main(write=True):
    ao.clear()
    roots = [make() for make in TOPPERS]
    if write:
        ao.export("toppers")
    return roots


def only(roots, name):
    """Shows just the emblem called `name` in the review renders, in its own two colours."""
    def setup():
        main_color, accent = PREVIEW[name]
        ao.material("Main", main_color)
        ao.material("Accent", accent)
        for ob in roots:
            ob.hide_render = ob.name != name
    return setup


def review(roots):
    # three's toon materials draw front faces only; show the same, so a face turned the wrong way
    # shows here as a hole rather than first in the office.
    bpy.context.scene.display.shading.show_backface_culling = True
    names = fk.wanted()
    look = dict(cell=(380, 380), target=at(0, 0.076, 0), dist=0.5)
    if names:
        paths = [ao.sheet(name, [(only(roots, name), v) for v in ("tq", "front", "side", "top")], **look) for name in PREVIEW if name in names]
    else:
        tiles = [(only(roots, name), view) for view in ("front", "tq") for name in PREVIEW]
        paths = [ao.sheet("toppers_all", tiles, **look)]
    for ob in roots:
        ob.hide_render = False
    return paths


if __name__ == "__main__" and bpy.app.background:
    roots = main()
    fk.report(roots)
    print("glb:", os.path.getsize(os.path.join(ao.MODELS, "toppers.glb")), "bytes")
    if fk.wanted() is not None:
        for path in review(roots):
            print("sheet:", path)
