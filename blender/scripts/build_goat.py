"""Marc, the office goat: a friendly white-and-tan toon goat with short curved horns, a little
beard, floppy ears, a stubby tail and a bell on a collar. Modelled by this script and exported to
src/client/models/goat.glb for src/client/features/goat/world.ts, which walks him about and moves
his parts. The shared helpers are in aokit.py and furnkit.py, and the conventions in
blender/README.md.

Headless, from the repo root (`-- --shots` also writes two review sheets: him standing from eight
sides, and grazing, nibbling, lying down and mid-stride):

    blender --background --factory-startup --python blender/scripts/build_goat.py [-- --shots]

He isn't rigged: he's a root, `goat` (his body, standing on the floor at the origin, facing the
office's +z), with every part that moves hung under it as an object of its own, its origin at the
joint the code turns it about (GOAT_PARTS in world.ts lists the names):

    goat_neck                 the neck and the collar round it, at the shoulders
      goat_bell               the bell, at the ring it hangs from
      goat_head               the head, its horns and nose, at the top of the neck
        goat_ear_l, _r        each ear, where it joins the head
        goat_eye_l, _r        each eye, at its middle: squashed flat to blink
        goat_beard            the beard, at the chin
    goat_leg_fl, _fr          a front leg above the knee, at the shoulder
      goat_shin_fl, _fr       the same leg below it and its hoof, at the knee
    goat_leg_bl, _br          a back leg above the hock, at the hip
      goat_shin_bl, _br       the same leg below it and its hoof, at the hock
    goat_tail                 the tail, where it joins the rump

Left is the office's +x. About the dog's size, but taller at the shoulder. The names of the parts
and the materials, and where the joints are, are a contract with world.ts and
tests/goat-model.test.ts, so rename them in all three places.
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Vector

# Run headless, Blender doesn't put this folder on the import path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aokit as ao
import furnkit as fk
from furnkit import at

# Preview colours only: world.ts paints every material by its name, in these same colours.
COLORS = {
    "Coat": "#f7f1e3",
    "Patch": "#c98d52",
    "Beard": "#e2d3b4",
    "Horn": "#b9a58a",
    "Hoof": "#4a3d36",
    "Muzzle": "#f0a59c",
    "Eye": "#f2b441",
    "Ink": "#1d1d1d",
    "Shine": "#ffffff",
    "Collar": "#3a86ff",
    "Bell": "#e9b949",
}

# Where each joint is (office axes: x across, y up, z toward his front), for the left side.
NECK = (0.0, 0.50, 0.20)
HEAD = (0.0, 0.69, 0.305)
SHOULDER = (0.085, 0.40, 0.15)
KNEE = (0.085, 0.215, 0.16)
HIP = (0.09, 0.42, -0.20)
HOCK = (0.09, 0.225, -0.25)
TAIL = (0.0, 0.555, -0.315)
EAR = (0.08, 0.765, 0.30)
EYE = (0.068, 0.745, 0.400)
CHIN = (0.0, 0.652, 0.455)
# The collar sits this far up the neck, which is this thick there.
COLLAR_AT, COLLAR_R = 0.55, 0.083


def material(name):
    return ao.material(name, COLORS[name])


def side(p, sx):
    """A point given for his left, on side `sx` (1 left, -1 right)."""
    return (sx * p[0], p[1], p[2])


# ---- Shapes (office axes) ---------------------------------------------------------------------------

def egg(bm, x, y, z, rx, ry, rz, tilt=0.0, segs=16, rings=10):
    """A squashed ball: `rx` across, `ry` up and `rz` front to back, tipped nose-down by `tilt`."""
    ao.ellipsoid(bm, at(x, y, z), (rx, rz, ry), rot=(tilt, 0, 0), segs=segs, rings=rings)


def cap(bm, a, b, ra, rb, segs=12, rings=8):
    """A capsule from `a` (radius ra) to `b` (radius rb)."""
    return ao.limb(bm, at(*a), at(*b), ra, rb, segs=segs, rings=rings)


def frame(z_axis, y_hint):
    """A turn that stands a shape built along Blender's z along `z_axis`, keeping its y as near
    `y_hint` as it can (both in Blender's axes)."""
    z = Vector(z_axis).normalized()
    y = Vector(y_hint)
    y = (y - z * y.dot(z)).normalized()
    x = y.cross(z)
    return Matrix((x, y, z)).transposed().to_4x4()


def shape(name, mat, build, smooth=True):
    """One material's worth of a part, as an object of its own (joined into its part by part())."""
    bm = bmesh.new()
    build(bm)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return ao.mesh_object(name, bm, [material(mat)], smooth=smooth)


def part(name, shapes, pivot=None, parent=None):
    """Joins `shapes` into the part called `name`, its origin at `pivot` (the joint it turns about),
    hung from `parent` where it stands."""
    ob = ao.join(shapes[0], shapes[1:]) if len(shapes) > 1 else shapes[0]
    ob.name = name
    # The mesh is named apart from its node, so the loader never has to tell them apart.
    ob.data.name = name + "_mesh"
    if pivot is not None:
        ao.set_origin(ob, at(*pivot))
    if parent is not None:
        bpy.context.view_layer.update()
        ob.parent = parent
        ob.matrix_parent_inverse = parent.matrix_world.inverted()
    bpy.context.view_layer.update()
    return ob


def skin(name, build, quads, patches, voxel=0.006):
    """Shapes melted into one smooth skin of Coat, with `patches` [(material, field)] painted on."""
    bm = bmesh.new()
    build(bm)
    ob = ao.mesh_object(name, bm)
    ao.fuse(ob, voxel=voxel, smooth=8, quads=quads)
    ao.paint(ob, material("Coat"), [(material(m), f) for m, f in patches])
    return ob


def blob(x, y, z, rx, ry, rz):
    """A patch's field: inside this squashed ball (office axes)."""
    c, r = at(x, y, z), (rx, rz, ry)
    return lambda p: ao.blob(p, c, r)


def either(*fields):
    return lambda p: min(f(p) for f in fields)


# ---- The goat ---------------------------------------------------------------------------------------

def body():
    """The barrel of him: a deep chest, a round rump, and the shoulders and haunches his legs
    come out of. White, with a tan saddle over his back and a tan spot on his left hip."""
    def build(bm):
        egg(bm, 0, 0.46, -0.02, 0.135, 0.125, 0.25)
        egg(bm, 0, 0.455, 0.15, 0.13, 0.135, 0.13)
        egg(bm, 0, 0.47, -0.20, 0.133, 0.125, 0.135)
        for sx in (-1, 1):
            egg(bm, sx * 0.082, 0.40, 0.15, 0.06, 0.09, 0.075)
            egg(bm, sx * 0.088, 0.42, -0.20, 0.07, 0.10, 0.09)
    saddle = blob(0, 0.615, -0.07, 0.21, 0.125, 0.20)
    spot = blob(0.14, 0.43, -0.215, 0.07, 0.085, 0.085)
    return part("goat", [skin("goat", build, 1500, [("Patch", either(saddle, spot))])])


def leg(root, name, top, joint, foot_z, sx, thick):
    """A leg in two parts: above its middle joint, and below it down to the hoof."""
    top, joint = side(top, sx), side(joint, sx)
    foot = (joint[0], 0.05, foot_z)
    upper = part(f"goat_leg_{name}", [shape("upper", "Coat", lambda bm: cap(bm, top, joint, thick, 0.035))], top, root)
    shin = shape("shin", "Patch", lambda bm: cap(bm, joint, foot, 0.033, 0.027))
    hoof = shape("hoof", "Hoof", lambda bm: egg(bm, foot[0], 0.03, foot[2] + 0.012, 0.035, 0.032, 0.046, segs=10, rings=6))
    part(f"goat_shin_{name}", [shin, hoof], joint, upper)


def neck(root):
    """The neck, leaning forward, with the collar round it."""
    lean = Vector(at(*HEAD)) - Vector(at(*NECK))
    mid = Vector(at(*NECK)) + lean * COLLAR_AT
    tip = math.atan2(-lean.y, lean.z)
    throat = shape("neck", "Coat", lambda bm: cap(bm, NECK, HEAD, 0.098, 0.07, segs=14, rings=8))
    collar = shape("collar", "Collar", lambda bm: ao.torus(bm, mid, COLLAR_R, 0.014, rot=(tip, 0, 0), n=20, m=6))
    return part("goat_neck", [throat, collar], NECK, root), mid, lean.normalized()


def bell(neck_ob, mid, lean):
    """The bell, hanging from the front of the collar: a brass cup with a dark clapper in it."""
    # Out from the neck's middle to the front of the collar, square to the neck.
    out = Vector((0, -1, 0))
    out = (out - lean * out.dot(lean)).normalized()
    ring = mid + out * (COLLAR_R + 0.012)
    cup = [(0.0, -0.05), (0.03, -0.062), (0.033, -0.056), (0.026, -0.038), (0.02, -0.018), (0.011, -0.005), (0.0, 0.0)]
    brass = shape("bell", "Bell", lambda bm: ao.lathe(bm, cup, center=ring, segs=12))
    loop = shape("loop", "Bell", lambda bm: ao.torus(bm, ring, 0.012, 0.004, rot=(math.pi / 2, 0, 0), n=10, m=4))
    clapper = shape("clapper", "Ink", lambda bm: ao.ellipsoid(bm, ring + Vector((0, 0, -0.058)), (0.011, 0.011, 0.011), segs=8, rings=5))
    # at() the other way: the ring, in the office's axes.
    part("goat_bell", [brass, loop, clapper], (ring.x, ring.z, -ring.y), neck_ob)


def horn(bm, sx):
    """A short horn, sweeping up and back from the top of his head and out a little."""
    path = [(0.038, 0.785, 0.325), (0.046, 0.845, 0.318), (0.056, 0.886, 0.288), (0.066, 0.902, 0.243)]
    fk.tube(bm, fk.fillet([side(p, sx) for p in path], 0.035, n=3), 0.026, 0.008, segs=8)


def head(neck_ob):
    """A long, straight-nosed face with soft cheeks: white, with a tan crown and a tan patch round
    his left eye, a pink nose, and the two horns."""
    def build(bm):
        egg(bm, 0, 0.728, 0.335, 0.09, 0.088, 0.10)
        egg(bm, 0, 0.703, 0.43, 0.064, 0.062, 0.10, tilt=0.12)
        egg(bm, 0, 0.678, 0.505, 0.052, 0.047, 0.046)
        for sx in (-1, 1):
            egg(bm, sx * 0.045, 0.70, 0.375, 0.045, 0.052, 0.062)
    crown = blob(0, 0.81, 0.295, 0.13, 0.075, 0.11)
    eye_patch = blob(0.08, 0.745, 0.395, 0.05, 0.05, 0.055)
    nose = blob(0, 0.688, 0.552, 0.032, 0.022, 0.022)
    face = skin("head", build, 1000, [("Muzzle", nose), ("Patch", either(crown, eye_patch))], voxel=0.005)
    horns = shape("horns", "Horn", lambda bm: [horn(bm, sx) for sx in (-1, 1)])
    nostrils = shape("nostrils", "Ink", lambda bm: [egg(bm, sx * 0.015, 0.692, 0.547, 0.006, 0.008, 0.006, segs=8, rings=5) for sx in (-1, 1)])
    # A small smile under the nose, half sunk into the muzzle.
    smile = [(-0.026, 0.672, 0.538), (-0.013, 0.663, 0.545), (0.0, 0.660, 0.547), (0.013, 0.663, 0.545), (0.026, 0.672, 0.538)]
    mouth = shape("mouth", "Ink", lambda bm: fk.tube(bm, smile, 0.004, segs=6))
    return part("goat_head", [face, horns, nostrils, mouth], HEAD, neck_ob)


def eye(head_ob, name, sx):
    """An amber eye with a goat's wide pupil and a glint, looking out and forward."""
    c = Vector(at(*side(EYE, sx)))
    turn = Matrix.Translation(c) @ frame(at(sx * 0.66, 0.1, 0.75), (0, 0, 1))

    def disc(radii, lift):
        def build(bm):
            verts = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=6, radius=1.0)["verts"]
            bmesh.ops.transform(bm, matrix=turn @ Matrix.Translation((0, 0, lift)) @ Matrix.Diagonal((*radii, 1)), verts=verts)
        return build
    iris = shape("iris", "Eye", disc((0.03, 0.03, 0.011), 0.0))
    # Wide rather than tall, with rounded ends: a goat's.
    pupil = shape("pupil", "Ink", disc((0.022, 0.014, 0.006), 0.007))
    glint = shape("glint", "Shine", disc((0.008, 0.008, 0.004), 0.011))
    bpy.context.view_layer.update()
    # Up and toward his front (the disc's own x runs back on his left side, forward on his right).
    glint.data.transform(Matrix.Translation(turn.to_3x3() @ Vector((-sx * 0.01, 0.009, 0))))
    part(f"goat_eye_{name}", [iris, pupil, glint], side(EYE, sx), head_ob)


def ear(head_ob, name, sx):
    """A floppy ear: a flat teardrop hanging out to the side and down, its broad face forward."""
    root = Vector(at(*side(EAR, sx)))
    turn = Matrix.Translation(root) @ frame(at(sx * 0.72, -0.68, -0.12), (0, 1, 0)) @ Matrix.Diagonal((1, 0.34, 1, 1))

    def build(bm):
        verts = ao.limb(bm, (0, 0, 0), (0, 0, 0.13), 0.024, 0.044, segs=12, rings=8)
        bmesh.ops.transform(bm, matrix=turn, verts=verts)
    part(f"goat_ear_{name}", [shape("ear", "Patch", build)], side(EAR, sx), head_ob)


def beard(head_ob):
    """The little beard under his chin: a soft tuft, narrower at its end."""
    part("goat_beard", [shape("beard", "Beard", lambda bm: cap(bm, CHIN, (0, 0.588, 0.449), 0.03, 0.011, segs=10, rings=6))], CHIN, head_ob)


def tail(root):
    """A stubby tail, cocked up."""
    part("goat_tail", [shape("tail", "Coat", lambda bm: cap(bm, TAIL, (0, 0.612, -0.35), 0.037, 0.027, segs=10, rings=6))], TAIL, root)


def main(write=True):
    ao.clear()
    root = body()
    leg(root, "fl", SHOULDER, KNEE, 0.155, 1, 0.052)
    leg(root, "fr", SHOULDER, KNEE, 0.155, -1, 0.052)
    leg(root, "bl", HIP, HOCK, -0.215, 1, 0.064)
    leg(root, "br", HIP, HOCK, -0.215, -1, 0.064)
    neck_ob, mid, lean = neck(root)
    bell(neck_ob, mid, lean)
    head_ob = head(neck_ob)
    for name, sx in (("l", 1), ("r", -1)):
        eye(head_ob, name, sx)
        ear(head_ob, name, sx)
    beard(head_ob)
    tail(root)
    bpy.context.view_layer.update()
    if write:
        ao.export("goat")
    return root


# ---- Review renders ---------------------------------------------------------------------------------

# How each sheet's poses turn his parts (radians about each part's own x: positive tips a part's
# top forward, or swings a hanging leg's foot back) and how far the whole of him sinks.
POSES = {
    "stand": {},
    "graze": {"goat_neck": 0.62, "goat_head": 0.3, "goat_beard": 0.3},
    "nibble": {"goat_neck": 1.3, "goat_head": 0.25, "goat_leg_fl": -0.35, "goat_leg_fr": -0.35, "goat_shin_fl": 0.7, "goat_shin_fr": 0.7},
    "lie": {"sink": 0.27, "goat_neck": -0.15, "goat_leg_fl": -1.2, "goat_leg_fr": -1.2, "goat_shin_fl": 2.3, "goat_shin_fr": 2.3,
            "goat_leg_bl": -1.0, "goat_leg_br": -1.0, "goat_shin_bl": 2.0, "goat_shin_br": 2.0},
    "stride": {"goat_leg_fl": -0.5, "goat_shin_fl": 0.15, "goat_leg_br": -0.45, "goat_shin_br": 0.2, "goat_leg_fr": 0.45,
               "goat_shin_fr": 0.6, "goat_leg_bl": 0.4, "goat_shin_bl": 0.5, "goat_tail": -0.4},
}


def posed(root, name):
    def setup():
        pose = POSES[name]
        for ob in [root, *root.children_recursive]:
            ob.rotation_euler = (pose.get(ob.name, 0.0) if ob is not root else 0.0, 0, 0)
        root.location = (0, 0, -pose.get("sink", 0.0))
    return setup


def review(root):
    # three's toon materials draw front faces only; show the same, so a face turned the wrong way
    # shows here as a hole rather than first in the office.
    bpy.context.scene.display.shading.show_backface_culling = True
    look = dict(cell=(560, 500), target=at(0, 0.45, 0.06), dist=2.0)
    paths = [ao.sheet("goat_standing", [(posed(root, "stand"), v) for v in ("tq", "front", "side", "back", "top", "low", (-0.9, -1.0, 0.45), (0.35, -1.0, 0.25))], **look)]
    tiles = [(posed(root, p), v) for p in ("graze", "nibble", "lie", "stride") for v in ("side", "tq")]
    paths.append(ao.sheet("goat_poses", tiles, **look))
    posed(root, "stand")()
    return paths


if __name__ == "__main__" and bpy.app.background:
    root = main()
    parts = [root, *root.children_recursive]
    lo = Vector((min((ob.matrix_world @ Vector(c))[i] for ob in parts for c in ob.bound_box) for i in range(3)))
    hi = Vector((max((ob.matrix_world @ Vector(c))[i] for ob in parts for c in ob.bound_box) for i in range(3)))
    mats = sorted({m.name for ob in parts for m in ob.data.materials})
    print(f"goat: {sum(ao.tris(ob) for ob in parts)} tris in {len(parts)} objects, x {lo.x:.3f}..{hi.x:.3f}, "
          f"y {lo.z:.3f}..{hi.z:.3f}, z {-hi.y:.3f}..{-lo.y:.3f}, materials {mats}")
    for ob in parts:
        print(f"  {ob.name}: under {ob.parent.name if ob.parent else '-'}, {ao.tris(ob)} tris")
    print("glb:", os.path.getsize(os.path.join(ao.MODELS, "goat.glb")), "bytes")
    if "--shots" in ao.args():
        for path in review(root):
            print("sheet:", path)
