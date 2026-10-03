"""What the studio's furniture packs share (build_rooms.py, build_studio.py, build_greenery.py):
the office's axes, the hard-edged shapes modern furniture is made of (rounded blocks, slabs, rods,
bent tubes, turned feet), a Piece that gathers them into one object with a material slot per
material, and the review sheets. aokit.py is the kit under it and blender/README.md the
conventions.

Every number in those scripts is in the office's axes: (x across, y up, z toward the front),
metres, a piece's origin on the floor under the middle of its footprint. at() turns a point into
Blender's (z up, the front toward -y), and spin() a turn.

A piece is shaded the way hard furniture wants: every face smooth, edges sharper than SHARP kept
crisp, and its normals weighted by face area, so a big flat face stays flat right up to its rounded
edge and the rounding blends from one face to the next. The office's outline is drawn along the
normals, so it runs unbroken round such an edge instead of cracking at it.
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Vector

# Run headless, Blender doesn't put this folder on the import path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao
from aokit import TAU

# Smooth shading keeps edges sharper than this crisp (a rod's end, a box left unrounded).
SHARP = math.radians(50)


def at(x, y, z):
    """A point in the office's axes, in Blender's."""
    return (x, -z, y)


def spin(yaw=0.0, tilt=0.0, roll=0.0):
    """A turn in the office's axes, as a Blender matrix: `yaw` about up (counter-clockwise seen
    from above, as the office turns its furniture), `tilt` about x (positive tips the top toward the
    front) and `roll` about the front-to-back axis."""
    return Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(tilt, 4, 'X') @ Matrix.Rotation(-roll, 4, 'Y')


# ---- Shapes (added to a bmesh, in the office's axes) ------------------------------------------------

def block(bm, x, y, z, w, h, d, bevel=0.0, segs=2, turn=None, only=None):
    """A box `w` across, `h` tall and `d` deep, its middle at (x, y, z), its edges rounded over
    `bevel`: all of them, or with `only` just those running along 'x', 'y' (the upright ones) or 'z'.
    `turn` (see spin()) turns it about its own middle."""
    part = bmesh.new()
    bmesh.ops.create_cube(part, size=1.0)
    bmesh.ops.scale(part, vec=(w, d, h), verts=part.verts[:])
    if bevel > 0:
        axis = {None: None, 'x': 0, 'z': 1, 'y': 2}[only]
        edges = [e for e in part.edges if axis is None or abs((e.verts[0].co - e.verts[1].co)[axis]) > 1e-6]
        bmesh.ops.bevel(part, geom=edges, offset=min(bevel, min(w, h, d) / 2 - 1e-4), segments=segs, profile=0.5,
                        affect='EDGES', clamp_overlap=True)
    m = Matrix.Translation(at(x, y, z)) @ (turn or Matrix.Identity(4))
    bmesh.ops.transform(part, matrix=m, verts=part.verts[:])
    ao._merge(bm, part)


def rounded_rect(hx, hz, r, segs):
    """A rectangle's outline [(x, z), ...] seen from above, 2hx by 2hz, its corners rounded over `r`."""
    pts = []
    for cx, cz, a0 in ((hx - r, hz - r, 0), (-(hx - r), hz - r, 90), (-(hx - r), -(hz - r), 180), (hx - r, -(hz - r), 270)):
        for i in range(segs + 1):
            a = math.radians(a0 + 90 * i / segs)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def slab(bm, w, d, y0, y1, corner, edge, x=0.0, z=0.0, bottom=None, csegs=4, esegs=3, turn=None):
    """A table top, or a cushion: `w` across and `d` deep from y0 up to y1, its corners rounded over
    `corner` seen from above and its top edge rounded over `edge` (its bottom edge over `bottom`, the
    same unless given). Its top and bottom are single flat faces. `turn` (a middle and a spin())
    stands it up somewhere else, built round the origin."""
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
    if turn:
        center, rot = turn
        bmesh.ops.transform(bm, matrix=Matrix.Translation(at(*center)) @ rot, verts=[v for ring in rings for v in ring])


def rod(bm, a, b, r, rb=None, segs=10):
    """A round rod from `a` to `b`, `r` thick (tapering to `rb` at `b`, if given)."""
    ao.cylinder(bm, at(*a), at(*b), r, rb, segs=segs)


def tube(bm, points, r, r1=None, segs=8):
    """A round tube along `points`, `r` thick (tapering to `r1` at its end), capped at both ends.
    Its rings are carried round the bends without twisting; fillet() rounds a path's corners first."""
    pts = [Vector(at(*p)) for p in points]
    n = len(pts)
    tangents = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    normal = tangents[0].orthogonal().normalized()
    rings = []
    for i, (p, t) in enumerate(zip(pts, tangents)):
        if i:
            normal = tangents[i - 1].rotation_difference(t) @ normal
        side = t.cross(normal)
        rr = r if r1 is None else r + (r1 - r) * i / (n - 1)
        rings.append([bm.verts.new(p + rr * (math.cos(a) * normal + math.sin(a) * side)) for a in (TAU * k / segs for k in range(segs))])
    faces = [bm.faces.new(rings[0][::-1]), bm.faces.new(rings[-1])]
    for lo, hi in zip(rings, rings[1:]):
        for k in range(segs):
            faces.append(bm.faces.new((lo[k], lo[(k + 1) % segs], hi[(k + 1) % segs], hi[k])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def fillet(points, radius, n=4):
    """A path with its corners rounded over `radius`: each inner point becomes an arc of `n` spans."""
    pts = [Vector(p) for p in points]
    out = [tuple(pts[0])]
    for a, b, c in zip(pts, pts[1:], pts[2:]):
        r = min(radius, (a - b).length / 2, (c - b).length / 2)
        p0, p1 = b + (a - b).normalized() * r, b + (c - b).normalized() * r
        for i in range(n + 1):
            t = i / n
            out.append(tuple((1 - t) ** 2 * p0 + 2 * (1 - t) * t * b + t * t * p1))
    out.append(tuple(pts[-1]))
    return out


def turned(bm, profile, x=0.0, y=0.0, z=0.0, segs=24, turn=None):
    """A lathe about the up axis, [(radius, height), ...] from the bottom, standing at (x, y, z);
    `turn` (see spin()) tips it over about that point."""
    verts = ao.lathe(bm, profile, segs=segs)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(at(x, y, z)) @ (turn or Matrix.Identity(4)), verts=verts)


def arc(r, cr, cy, a0, a1, n):
    """Points [(radius, height)] round part of a circle centred (cr, cy), `r` round, from angle a0
    to a1 (degrees, 0 pointing out, 90 up): a lathe profile's rounded rim."""
    return [(cr + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))) for a in
            (a0 + (a1 - a0) * i / n for i in range(n + 1))]


def ball(bm, x, y, z, rx, ry=None, rz=None, segs=14, rings=9, turn=None):
    """A ball, or squashed one: `rx` across, `ry` up and `rz` front to back (all `rx` unless given)."""
    ry, rz = rx if ry is None else ry, rx if rz is None else rz
    verts = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)["verts"]
    m = Matrix.Translation(at(x, y, z)) @ (turn or Matrix.Identity(4)) @ Matrix.Diagonal((rx, rz, ry, 1))
    bmesh.ops.transform(bm, matrix=m, verts=verts)


def sweep(bm, section, x0, x1, close=True):
    """A flat section [(z, y), ...] (clockwise seen from +x) run across from x0 to x1: a sheet of
    paper's curve, a moulding. `close` caps its two ends."""
    lo = [bm.verts.new(at(x0, y, z)) for z, y in section]
    hi = [bm.verts.new(at(x1, y, z)) for z, y in section]
    n = len(section)
    faces = [bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i])) for i in range(n)]
    if close:
        faces += [bm.faces.new(lo[::-1]), bm.faces.new(hi)]
    bmesh.ops.recalc_face_normals(bm, faces=faces)


# ---- A piece ----------------------------------------------------------------------------------------

class Piece:
    """One object's shapes in one bmesh, a material slot per material. `colors` are the pack's
    preview colours by material name (the office paints every material by its name, see
    blender/README.md)."""

    def __init__(self, colors):
        self.bm = bmesh.new()
        self.colors = colors
        self.mats = []

    def slot(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def add(self, mat, build, *args, smooth=True, **kw):
        """Adds a shape in `mat`: `build(bm, *args, **kw)` is one of the shapes above (or a script's
        own). `smooth` is True, False, a test on each of its faces, or None to keep what it set."""
        bm = self.bm
        # Not the faces past the old count: a shape that deletes as it builds (a cone's doubled
        # verts) leaves gaps the next faces fill, so new ones aren't always last.
        before = set(bm.faces)
        build(bm, *args, **kw)
        bm.normal_update()
        slot = self.slot(mat)
        for f in bm.faces:
            if f in before:
                continue
            if smooth is not None:
                f.smooth = smooth(f) if callable(smooth) else smooth
            f.material_index = slot

    def part(self, mats, part, where=Matrix.Identity(4)):
        """Adds a finished bmesh `part` (a leaf, and frees it), placed by the matrix `where`. Its
        faces keep their own shading; their material_index picks from `mats`."""
        bmesh.ops.transform(part, matrix=where, verts=part.verts[:])
        slots = [self.slot(m) for m in mats]
        for f in part.faces:
            f.material_index = slots[min(f.material_index, len(slots) - 1)]
        ao._merge(self.bm, part)

    def finish(self, name, parent=None, weighted=True):
        """The object, its origin at the scene's origin, hung from `parent` if given. `weighted`
        shades it as hard furniture (see the top of this file); without, its faces stay as its
        shapes shaded them (leaves, which are flat with rounded rims)."""
        me = bpy.data.meshes.new(name + "_mesh")
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(ao.material(m, self.colors[m]))
        if weighted:
            me.set_sharp_from_angle(angle=SHARP)
        me.validate()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        if weighted:
            wn = ob.modifiers.new("Weighted", 'WEIGHTED_NORMAL')
            wn.mode = 'FACE_AREA'
            wn.weight = 100
            wn.keep_sharp = True
            ao.apply_modifier(ob, "Weighted")
        if parent is not None:
            ob.parent = parent
            ob.matrix_parent_inverse = Matrix.Identity(4)
        return ob


def report(roots):
    """Prints each piece's triangles, size and materials (its leaves', hung under it, with it)."""
    for ob in roots:
        obs = [ob, *ob.children]
        lo = Vector((min(c[i] for o in obs for c in o.bound_box) for i in range(3)))
        hi = Vector((max(c[i] for o in obs for c in o.bound_box) for i in range(3)))
        size = hi - lo
        mats = sorted({m.name for o in obs for m in o.data.materials})
        print(f"piece: {ob.name} {sum(ao.tris(o) for o in obs)} tris, {size.x:.3f} x {size.z:.3f} x {size.y:.3f} (w x h x d), "
              f"y {lo.z:.3f}..{hi.z:.3f}, materials {mats}")


# ---- Review renders ---------------------------------------------------------------------------------

def only(roots, *names, spread=None):
    """Shows just the pieces called `names` in the review renders (with whatever hangs under
    them), each at the origin, or `spread` metres apart along x in the order given."""
    def setup():
        for ob in roots:
            show = ob.name in names
            for o in (ob, *ob.children):
                o.hide_render = not show
            x = names.index(ob.name) * spread if show and spread else 0.0
            ob.matrix_world = Matrix.Translation((x, 0, 0))
    return setup


def wanted():
    """What `-- --shots` asks to see: None for no review renders, an empty set for all of them, or
    the pieces named after it (`--shots=palm,planter`)."""
    for a in ao.args():
        if a == "--shots":
            return set()
        if a.startswith("--shots="):
            return set(a.split("=", 1)[1].split(","))
    return None


def sheets(pack, roots, shots, views=("tq", "front", "side", "back")):
    """A review sheet per piece: `shots` is {name: (height of the middle, distance)}, less the ones
    `--shots=` leaves out. Returns the PNGs' paths, and leaves every piece shown at the origin, as
    exported."""
    names = wanted()
    if names:
        shots = {name: shot for name, shot in shots.items() if name in names}
    # three's toon materials draw front faces only; show the same, so a face turned the wrong way
    # shows here as a hole rather than first in the office.
    bpy.context.scene.display.shading.show_backface_culling = True
    paths = []
    for name, (mid, dist) in shots.items():
        paths.append(ao.sheet(f"{pack}_{name}", [(only(roots, name), v) for v in views], cell=(520, 460), target=at(0, mid, 0), dist=dist))
    only(roots, *[ob.name for ob in roots])()
    return paths
