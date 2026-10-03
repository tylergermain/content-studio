"""The whisky cabinet: a low walnut sideboard on tapered legs, with brass pulls and brass-shod feet,
and on its top a silver tray with a bottle of The Macallan Litha, a cut-crystal decanter of it with a
faceted stopper, and four crystal rocks glasses, and the bottle's box standing at the far end with its
artwork round it. Modelled by this script and exported to src/client/models/whisky.glb for
src/client/world/office/furniture-whisky.ts, which stands a painted copy wherever the office builder
put one, and src/client/features/whisky, which pours from it. The shared helpers are in furnkit.py and
aokit.py, and the conventions in blender/README.md.

Headless, from the repo root (`-- --shots` also writes a review sheet):

    blender --background --factory-startup --python blender/scripts/build_whisky.py [-- --shots]

The root is `whisky_cabinet`, standing on the floor at the origin under the middle of its kind's
footprint (1.2 by 0.45), its doors toward the office's +z. Hung under it, each its own object:

    whisky_label              the bottle's wrap, a band all the way round the glass, UV mapped 0 to 1
                              round it (from the back, left to right as you face it, its middle at
                              the front) and up it: the office paints the Litha's artwork on a canvas
                              with the cream label inset at the front, and lays it on (whisky-art.ts)
    whisky_crest              the 1824 crest on the bottle's shoulder, round its front, mapped the
                              same way
    whisky_box_art            the box's left side, front and right side, one wrap mapped 0 to 1 round
                              them from the back of the left side to the back of the right side
    whisky_decanter           the decanter, its origin under the middle of its base: the office lifts
                              and tips it to pour
      whisky_stopper          its stopper, its origin under it, lifted off while it pours
      whisky_decanter_whisky  the whisky in it, its origin under the decanter's foot: the office
                              hides it while the decanter is tipped, and a stream pours instead
    whisky_glass_0 .. _3      the glasses, each with its origin under the middle of its base
      whisky_glass_N_dram     the whisky in it, its origin on the glass's inner floor, so scaling it
                              up from nothing fills the glass

Body is the piece's own colour (the office builder's paint, walnut until someone picks another).
Crystal is the thin glass, Cut the solid crystal (the bases, the stopper), Glint the faint, tapered
streaks of light on the bottle and the decanter (none on the glasses), Brass the cabinet's pulls and the
bands on the bottle's capsule, and Label, Crest and Art are the surfaces the office paints its canvases on. The names of the
root, the parts and the materials are a contract with furniture-whisky.ts and
tests/whisky-model.test.ts, so rename them in all three places. The numbers in TRAY, BOTTLE, DECANTER
and GLASSES are copied there too.
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Vector

# Run headless, Blender doesn't put this folder on the import path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao
import furnkit as fk
from furnkit import at, spin
from aokit import TAU

# Preview colours only: furniture-whisky.ts paints every material by name.
COLORS = {
    "Body": "#7a5034",
    "Dark": "#3b2a20",
    "Brass": "#d4a84a",
    "Silver": "#cfd4da",
    "Crystal": "#e4f2fb",
    "Cut": "#cfe6f5",
    "Glint": "#ffffff",
    "Whisky": "#c8741e",
    "Stopper": "#a8322a",
    "Label": "#f6f1e6",
    "Crest": "#2b3a78",
    "Art": "#b85a63",
    "Box": "#2a2752",
}

# The kind's footprint (shared/furniture.ts) and how high the sideboard's top is.
W, D = 1.2, 0.45
TOP = 0.8
LEGS = 0.2

# The tray on the top: where its middle is, how big it is, and how high what stands on it stands.
TRAY = {"x": 0.17, "z": -0.01, "w": 0.66, "d": 0.3, "y": TOP + 0.008}
# The bottle: where it stands, how tall and round it is, and where its wrap and crest are (heights
# above its foot, and how far round the glass they go, in degrees: the wrap all the way), and how high
# the whisky comes (up to its shoulder, where the glass starts to round over: clear glass above).
BOTTLE = {"x": -0.07, "z": 0.0, "h": 0.37, "r": 0.054, "label": (0.016, 0.21, 360), "crest": (0.218, 0.271, 104), "fill": 0.272}
# The decanter: where it stands, how high its lip is (where it pours from), and how high the whisky in it comes.
DECANTER = {"x": 0.1, "z": -0.035, "lip": 0.226, "fill": 0.088}
# The glasses: where each stands, their radius at the rim and height, and the inner floor the whisky sits on.
GLASSES = {"at": [(0.27, -0.075), (0.39, -0.075), (0.27, 0.055), (0.39, 0.055)], "r": 0.041, "h": 0.085, "floor": 0.014, "dram": 0.032}
# The box: where it stands, how it's turned (toward the tray), and its size.
BOX = {"x": -0.43, "z": -0.05, "yaw": 0.28, "w": 0.13, "d": 0.11, "h": 0.34}


def piece():
    return fk.Piece(COLORS)


def hang(ob, parent, origin):
    """Moves `ob`'s origin to `origin` (office axes) and hangs it from `parent` where it stands."""
    ao.set_origin(ob, at(*origin))
    w = ob.matrix_world.copy()
    ob.parent = parent
    ob.matrix_parent_inverse = Matrix.Identity(4)
    ob.matrix_world = w
    return ob


# ---- Surfaces the office paints a canvas on ---------------------------------------------------------

def outward(bm, faces, center):
    """Turns each face of a patch to face away from `center` (Blender axes)."""
    bm.normal_update()
    for f in faces:
        if f.normal.dot(f.calc_center_median() - Vector(center)) < 0:
            f.normal_flip()


def band(bm, cx, cz, y0, y1, r, arc, cols=18, rows=1):
    """A band round a round thing at (cx, cz): `r` out, from y0 up to y1, `arc` degrees round,
    centred on its front (+z). UV mapped 0 to 1 left to right as you face it, and bottom to top."""
    uv = bm.loops.layers.uv.verify()
    grid = []
    for j in range(rows + 1):
        y = y0 + (y1 - y0) * j / rows
        row = []
        for i in range(cols + 1):
            a = math.radians(-arc / 2 + arc * i / cols)
            row.append((bm.verts.new(at(cx + r * math.sin(a), y, cz + r * math.cos(a))), i / cols, j / rows))
        grid.append(row)
    faces = []
    for j in range(rows):
        for i in range(cols):
            corners = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
            f = bm.faces.new([c[0] for c in corners])
            faces.append(f)
            for loop in f.loops:
                c = next(c for c in corners if c[0] is loop.vert)
                loop[uv].uv = (c[1], c[2])
    outward(bm, faces, at(cx, (y0 + y1) / 2, cz))


def wrap(bm, x, z, y0, y1, w, d, yaw, lift=0.0008):
    """The box's three painted sides, a hair off its faces: left, front and right, mapped as one strip
    round them (u from the back of the left side, round the front, to the back of the right side)."""
    uv = bm.loops.layers.uv.verify()
    hw, hd = w / 2 + lift, d / 2 + lift
    # The corners in order round the strip, in the box's own frame (x across, z forward).
    path = [(-hw, -hd), (-hw, hd), (hw, hd), (hw, -hd)]
    total = 2 * d + w
    us = [0.0, d / total, (d + w) / total, 1.0]
    c, s = math.cos(yaw), math.sin(yaw)
    turn = lambda px, pz: (x + px * c + pz * s, z - px * s + pz * c)
    faces = []
    for k in range(3):
        (ax, az), (bx, bz) = path[k], path[k + 1]
        (wax, waz), (wbx, wbz) = turn(ax, az), turn(bx, bz)
        quad = [(wax, y0, waz, us[k], 0.0), (wbx, y0, wbz, us[k + 1], 0.0), (wbx, y1, wbz, us[k + 1], 1.0), (wax, y1, waz, us[k], 1.0)]
        verts = [bm.verts.new(at(px, py, pz)) for px, py, pz, _, _ in quad]
        f = bm.faces.new(verts)
        for loop in f.loops:
            q = quad[verts.index(loop.vert)]
            loop[uv].uv = (q[3], q[4])
        faces.append(f)
    outward(bm, faces, at(x, (y0 + y1) / 2, z))


def glint(bm, cx, cz, r, y0, y1, a=-38.0, wide=4.0, base=0.0, rows=4):
    """A streak of light down a round glass at (cx, cz), standing on `base`: a sliver just outside it,
    `a` degrees round from its front (toward the window side), `wide` degrees at its widest in the
    middle and tapering to a point at either end, so it reads as light on the glass, not a stick."""
    ring = []
    for j in range(rows + 1):
        y = base + y0 + (y1 - y0) * j / rows
        half = math.radians(wide / 2 * math.sin(math.pi * j / rows))
        ts = [math.radians(a)] if half < 1e-6 else [math.radians(a) - half, math.radians(a) + half]
        ring.append([bm.verts.new(at(cx + r * math.sin(t), y, cz + r * math.cos(t))) for t in ts])
    faces = []
    for lo, hi in zip(ring, ring[1:]):
        faces.append(bm.faces.new(lo + hi[::-1]))
    outward(bm, faces, at(cx, base + (y0 + y1) / 2, cz))


# ---- The sideboard ----------------------------------------------------------------------------------

def sideboard(p):
    # The case sits back under its top, so the pulls stay inside the footprint.
    body_w, body_d = W - 0.04, D - 0.09
    face = body_d / 2
    # The case, its top a slab over it, a little proud all round.
    p.add("Body", fk.slab, body_w, body_d, LEGS, TOP - 0.024, corner=0.02, edge=0.01, csegs=2, esegs=2)
    p.add("Body", fk.slab, W, D, TOP - 0.026, TOP, corner=0.025, edge=0.008, csegs=3, esegs=2)
    # Two doors, a dark reveal between and round them, each with a raised panel and a long brass pull.
    y0, y1 = LEGS + 0.03, TOP - 0.05
    p.add("Dark", fk.block, 0, (y0 + y1) / 2, face + 0.001, body_w - 0.03, y1 - y0 + 0.012, 0.004)
    for sx in (-1, 1):
        cx = sx * (body_w / 4 + 0.002)
        dw = body_w / 2 - 0.022
        p.add("Body", fk.block, cx, (y0 + y1) / 2, face + 0.008, dw, y1 - y0, 0.014, bevel=0.004, segs=1)
        p.add("Body", fk.block, cx, (y0 + y1) / 2, face + 0.017, dw - 0.07, y1 - y0 - 0.07, 0.008, bevel=0.006, segs=2)
        px = sx * 0.045
        for py in (0.43, 0.6):
            p.add("Brass", fk.rod, (px, py, face + 0.018), (px, py, face + 0.034), 0.006, segs=8)
        p.add("Brass", fk.rod, (px, 0.405, face + 0.036), (px, 0.625, face + 0.036), 0.008, segs=10)
    # A slim brass line along the foot of the case.
    p.add("Brass", fk.block, 0, LEGS + 0.006, face + 0.002, body_w - 0.02, 0.012, 0.006)
    # Tapered legs, splayed a little, in brass shoes.
    for sx in (-1, 1):
        for sz in (-1, 1):
            top = (sx * (body_w / 2 - 0.07), LEGS + 0.005, sz * (body_d / 2 - 0.06))
            # A hair up, so the tilted rod's end doesn't dip under the floor.
            foot = (sx * (body_w / 2 - 0.045), 0.0025, sz * (body_d / 2 - 0.04))
            shoe = (top[0] + (foot[0] - top[0]) * 0.8, LEGS * 0.2, top[2] + (foot[2] - top[2]) * 0.8)
            p.add("Dark", fk.rod, top, shoe, 0.024, 0.016, segs=12)
            p.add("Brass", fk.rod, shoe, foot, 0.016, 0.014, segs=12)


def tray(p):
    x, z, w, d = TRAY["x"], TRAY["z"], TRAY["w"], TRAY["d"]
    p.add("Silver", fk.slab, w, d, TOP, TRAY["y"], corner=0.05, edge=0.003, x=x, z=z, csegs=5, esegs=1)
    # Its gallery rim, and a handle at either end.
    loop = [(x + px, TRAY["y"] + 0.006, z + pz) for px, pz in fk.rounded_rect(w / 2 - 0.006, d / 2 - 0.006, 0.045, 5)]
    p.add("Silver", fk.tube, loop + loop[:2], 0.006, segs=5)
    for sx in (-1, 1):
        hx = x + sx * (w / 2 + 0.012)
        path = fk.fillet([(hx - sx * 0.02, TRAY["y"] + 0.006, z - 0.06), (hx + sx * 0.012, TRAY["y"] + 0.022, z - 0.05),
                          (hx + sx * 0.012, TRAY["y"] + 0.022, z + 0.05), (hx - sx * 0.02, TRAY["y"] + 0.006, z + 0.06)], 0.02)
        p.add("Silver", fk.tube, path, 0.005, segs=5)


# ---- The bottle -------------------------------------------------------------------------------------
#
# The Macallan's own bottle, as the Litha comes in: clear glass, a tall straight body with short
# broad shoulders, a slim neck and a red capsule over the cork with a gold band at its foot. The
# whisky comes up to the shoulders, and the glass above it is clear. The wrap (the Litha's artwork
# all the way round, with the cream label inset at the front) and the crest are the office's canvases
# on bands laid just over the glass.

def bottle(p):
    x, z, h, r = BOTTLE["x"], BOTTLE["z"], BOTTLE["h"], BOTTLE["r"]
    y = TRAY["y"]
    # Heights as parts of the bottle's: the body runs straight to three quarters up, rounds over its
    # shoulders into the neck by 0.84, and the capsule covers the top tenth.
    H = lambda f: f * h
    neck = 0.0195
    glass = [(0.0, 0.0), (r - 0.005, 0.0), (r - 0.001, 0.003), (r, 0.01), (r, H(0.741)), (r - 0.001, H(0.768)), (r - 0.005, H(0.794)),
             (r - 0.013, H(0.815)), (r - 0.024, H(0.831)), (neck + 0.003, H(0.843)), (neck + 0.0005, H(0.853)), (neck - 0.001, H(0.87)),
             (neck - 0.0015, H(0.9)), (0.0, H(0.9))]
    p.add("Crystal", fk.turned, glass, x=x, y=y, z=z, segs=28)
    p.add("Cut", fk.turned, [(0.0, 0.0015), (r - 0.004, 0.0015), (r - 0.004, 0.009), (0.0, 0.009)], x=x, y=y, z=z, segs=28)
    # The whisky, a little in from the glass so its wall shows, up to where the shoulders start.
    i = 0.004
    fill = BOTTLE["fill"]
    whisky = [(0.0, 0.009), (r - i, 0.009), (r - i, fill - 0.002), (r - i - 0.002, fill), (0.0, fill)]
    p.add("Whisky", fk.turned, whisky, x=x, y=y, z=z, segs=20)
    # The capsule over the cork: red, ribbed at the top, with a gold band round its foot and a fine one higher up.
    cap = neck + 0.0015
    capsule = [(0.0, H(0.891)), (cap, H(0.891)), (cap, H(0.982)), (cap - 0.001, H(0.995)), (cap - 0.008, H(1.0) - 0.0005), (0.0, H(1.0))]
    p.add("Stopper", fk.turned, capsule, x=x, y=y, z=z, segs=20)
    p.add("Brass", fk.turned, [(0.0, H(0.888)), (cap + 0.0005, H(0.888)), (cap + 0.0005, H(0.904)), (0.0, H(0.904))], x=x, y=y, z=z, segs=20)
    p.add("Brass", fk.turned, [(0.0, H(0.966)), (cap + 0.0003, H(0.966)), (cap + 0.0003, H(0.971)), (0.0, H(0.971))], x=x, y=y, z=z, segs=20)
    # Faint slivers of light on the glass where the wrap and the crest don't cover it: out past the
    # crest's edge up to the shoulder, and down the neck.
    lo, hi, _ = BOTTLE["label"]
    p.add("Glint", glint, x, z, r + 0.0012, hi + 0.008, H(0.735), a=-64.0, wide=3.5, base=y, smooth=False)
    p.add("Glint", glint, x, z, neck + 0.0016, H(0.846), H(0.884), a=-40.0, wide=7.0, base=y, smooth=False)

    lo, hi, arc = BOTTLE["label"]
    lab = piece()
    lab.add("Label", band, x, z, y + lo, y + hi, r + 0.0008, arc, cols=40, smooth=True)
    label = lab.finish("whisky_label", weighted=False)
    lo, hi, arc = BOTTLE["crest"]
    crest = piece()
    crest.add("Crest", band, x, z, y + lo, y + hi, r + 0.0008, arc, cols=14, smooth=True)
    return label, crest.finish("whisky_crest", weighted=False)


# ---- The box ----------------------------------------------------------------------------------------

def box(p):
    x, z, w, d, h, yaw = BOX["x"], BOX["z"], BOX["w"], BOX["d"], BOX["h"], BOX["yaw"]
    p.add("Box", fk.block, x, TOP + h / 2, z, w, h, d, bevel=0.002, segs=1, turn=spin(yaw=yaw))
    art = piece()
    art.add("Art", wrap, x, z, TOP + 0.002, TOP + h - 0.002, w, d, yaw, smooth=False)
    return art.finish("whisky_box_art", weighted=False)


# ---- The decanter -----------------------------------------------------------------------------------
#
# Cut crystal: an eight-sided body, its facets catching the light, a short neck, and a faceted ball
# of a stopper. The whisky in it is its own object (the office hides it while it's tipped), about
# half full, so the glass above it shows.

def decanter(root):
    x, z, y = DECANTER["x"], DECANTER["z"], TRAY["y"]
    lip = DECANTER["lip"]
    p = piece()
    body = [(0.0, 0.0), (0.05, 0.0), (0.057, 0.008), (0.06, 0.13), (0.052, 0.158), (0.032, 0.18), (0.018, 0.19),
            (0.016, lip - 0.008), (0.021, lip - 0.004), (0.021, lip), (0.0, lip)]
    p.add("Crystal", fk.turned, body, x=x, y=y, z=z, segs=8, smooth=False)
    p.add("Cut", fk.turned, [(0.0, 0.001), (0.052, 0.001), (0.052, 0.014), (0.0, 0.014)], x=x, y=y, z=z, segs=8, smooth=False)
    p.add("Glint", glint, x, z, 0.0615, 0.03, 0.12, a=-22.5, wide=4.5, base=y, smooth=False)
    ob = p.finish("whisky_decanter", weighted=False)
    hang(ob, root, (x, y, z))

    w = piece()
    w.add("Whisky", fk.turned, [(0.0, 0.0145), (0.054, 0.0145), (0.0555, DECANTER["fill"]), (0.0, DECANTER["fill"])], x=x, y=y, z=z, segs=8, smooth=False)
    hang(w.finish("whisky_decanter_whisky", weighted=False), ob, (x, y, z))

    s = piece()
    sy = y + lip
    s.add("Cut", fk.turned, [(0.0, 0.0), (0.013, 0.0), (0.012, 0.016), (0.0, 0.016)], x=x, y=sy - 0.006, z=z, segs=8, smooth=False)
    s.add("Cut", fk.ball, x, sy + 0.036, z, 0.029, 0.033, 0.029, segs=8, rings=5, smooth=False)
    stopper = s.finish("whisky_stopper", weighted=False)
    hang(stopper, ob, (x, sy, z))
    return ob


# ---- The glasses ------------------------------------------------------------------------------------

def glasses(root):
    r, h, floor, dram = GLASSES["r"], GLASSES["h"], GLASSES["floor"], GLASSES["dram"]
    y = TRAY["y"]
    out = []
    for i, (x, z) in enumerate(GLASSES["at"]):
        p = piece()
        wall = [(0.0, 0.0), (r - 0.004, 0.0), (r - 0.002, 0.003), (r, h), (r - 0.003, h), (r - 0.004, floor + 0.002), (0.0, floor + 0.002)]
        p.add("Crystal", fk.turned, wall, x=x, y=y, z=z, segs=12, smooth=False)
        p.add("Cut", fk.turned, [(0.0, 0.001), (r - 0.005, 0.001), (r - 0.005, floor), (0.0, floor)], x=x, y=y, z=z, segs=12, smooth=False)
        g = p.finish(f"whisky_glass_{i}", weighted=False)
        hang(g, root, (x, y, z))
        w = piece()
        w.add("Whisky", fk.turned, [(0.0, floor + 0.002), (r - 0.0045, floor + 0.002), (r - 0.0042, floor + 0.002 + dram), (0.0, floor + 0.002 + dram)],
              x=x, y=y, z=z, segs=12, smooth=False)
        liquid = w.finish(f"whisky_glass_{i}_dram", weighted=False)
        hang(liquid, g, (x, y + floor + 0.002, z))
        out.append(g)
    return out


def cabinet():
    p = piece()
    sideboard(p)
    tray(p)
    # The label, the crest and the box's art are objects of their own, hung under the root once it's made.
    painted = [*bottle(p), box(p)]
    root = p.finish("whisky_cabinet")
    for ob in painted:
        hang(ob, root, (0, 0, 0))
    decanter(root)
    glasses(root)
    return root


# ---- Build, export, review --------------------------------------------------------------------------

def main(write=True):
    ao.clear()
    root = cabinet()
    if write:
        ao.export("whisky", uvs=True)
    return [root]


def review(roots):
    bpy.context.scene.display.shading.show_backface_culling = True
    paths = [ao.sheet("whisky_cabinet", [(None, v) for v in ("tq", "front", "side", "top")], cell=(620, 520), target=at(0, 0.62, 0), dist=2.6)]
    paths.append(ao.sheet("whisky_top", [(None, v) for v in ("tq", "front", "low", "back")], cell=(620, 520), target=at(0.0, 0.93, 0), dist=1.25))
    return paths


if __name__ == "__main__" and bpy.app.background:
    roots = main()
    fk.report(roots)
    for ob in roots[0].children_recursive:
        print(f"part: {ob.name} under {ob.parent.name}, {ao.tris(ob)} tris, origin {tuple(round(c, 3) for c in ob.matrix_world.translation)}")
    print("glb:", os.path.getsize(os.path.join(ao.MODELS, "whisky.glb")), "bytes")
    if fk.wanted() is not None:
        for path in review(roots):
            print("sheet:", path)
