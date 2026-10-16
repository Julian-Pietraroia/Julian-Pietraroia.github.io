"""
Lamp Tinder - procedural lamp generator for Blender 4.2+ / 5.x

Generate a batch of random lamps (renders + parameters):
    blender -b -P gen_lamps.py -- --count 200

Blend the lamps a user liked into one new lamp and render it:
    blender -b -P gen_lamps.py -- --combine liked.json

liked.json can be either  ["lamp_0003", "lamp_0042", ...]
                      or  {"liked": ["lamp_0003", ...]}

Outputs (in ./out by default):
    out/lamps/lamp_0001.jpg ...   one render per lamp
    out/lamps.json                every lamp's id, image path, params, tags
    out/combined.jpg / .json      result of --combine

Every numeric parameter is stored normalised to 0..1 (colours as sRGB 0..1),
so "combining" lamps is just an average of their parameter vectors, and the
categorical choices (lamp type, shade shape, ...) are decided by majority vote.
"""

import argparse
import json
import math
import os
import random
import subprocess
import sys
import time
from collections import Counter

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
DEBUG = "--debug" in sys.argv

# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------

LAMP_TYPES = ["table", "floor", "arm", "pendant"]
LAMP_TYPE_WEIGHTS = [4, 3, 3, 2]
BASE_SHAPES = ["disc", "dome", "square", "tripod", "stepped", "tall_tripod"]
SHADE_SHAPES = ["cone", "drum", "dome", "globe", "bell", "flare", "mushroom", "saucer", "cylinder"]
# soft studio backdrops; one is picked per card so the deck does not look identical
BACKDROPS = ["#dbd6cf", "#d3d8cc", "#cfd6dc", "#e0d2cc", "#e2d6c3", "#d0ccc6"]
FINISHES = ["matte", "satin", "metal"]

BODY_COLORS = {
    "black": "#1c1c1c", "white": "#f2f0eb", "brass": "#c9a25a",
    "copper": "#b8734a", "chrome": "#c8ccd0", "sage": "#9caf88",
    "terracotta": "#c1694f", "navy": "#24345a", "mustard": "#d4a72c",
    "walnut": "#5a3b26", "oak": "#c49a6c", "red": "#b8322a",
    "forest green": "#2f4a3a", "blush": "#e3b5a8", "graphite": "#4a4d52",
}
SHADE_COLORS = {
    "linen": "#efe8da", "white": "#f7f5f0", "cream": "#f1e3c4",
    "black": "#202020", "sage": "#a9b89a", "terracotta": "#c8775c",
    "mustard": "#dcae3d", "blush": "#e9c0b4", "dusty blue": "#8ea7bf",
    "opal": "#f4f4f2", "smoke": "#6d6a66", "olive": "#6f7442",
    "burnt orange": "#c75b28", "brass": "#c9a25a",
}


def hex_to_rgb(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]


def srgb_to_linear(c):
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def nearest_color_name(rgb, table):
    best, best_d = None, 1e9
    for name, hx in table.items():
        d = sum((a - b) ** 2 for a, b in zip(rgb, hex_to_rgb(hx)))
        if d < best_d:
            best, best_d = name, d
    return best


def lerp(a, b, t):
    return a + (b - a) * t


# ---------------------------------------------------------------------------
# Parameters
# ---------------------------------------------------------------------------

NUMERIC_KEYS = [
    "base_radius", "base_height", "stem_len", "stem_thickness", "stem_bend",
    "arm_reach", "shade_radius", "shade_height", "shade_taper", "shade_tilt",
    "shade_glow", "light_warmth",
]
CATEGORICAL_KEYS = ["type", "base_shape", "shade_shape", "finish", "shade_count"]
COLOR_KEYS = ["body_color", "shade_color"]


def jitter_color(rng, hx, amt=0.04):
    return [min(1.0, max(0.0, c + rng.uniform(-amt, amt))) for c in hex_to_rgb(hx)]


def random_params(rng):
    p = {
        "type": rng.choices(LAMP_TYPES, weights=LAMP_TYPE_WEIGHTS)[0],
        "base_shape": rng.choice(BASE_SHAPES[:5]),
        "shade_shape": rng.choice(SHADE_SHAPES),
        "finish": rng.choice(FINISHES),
    }
    for k in NUMERIC_KEYS:
        p[k] = rng.random()
    # tall tripods are a floor-lamp thing (think Gräshoppa); cluster pendants have three shades
    if p["type"] == "floor" and rng.random() < 0.3:
        p["base_shape"] = "tall_tripod"
    p["shade_count"] = 3 if p["type"] == "pendant" and rng.random() < 0.3 else 1
    # most stems are straight; some bend
    p["stem_bend"] = 0.5 if rng.random() < 0.55 else rng.random()
    p["body_color"] = jitter_color(rng, rng.choice(list(BODY_COLORS.values())))
    p["shade_color"] = jitter_color(rng, rng.choice(list(SHADE_COLORS.values())))
    return p


def tags_for(p):
    return {
        "type": p["type"],
        "shade_shape": p["shade_shape"],
        "base_shape": p["base_shape"] if p["type"] != "pendant" else "canopy",
        "shades": str(p.get("shade_count", 1)),
        "finish": p["finish"],
        "body_color": nearest_color_name(p["body_color"], BODY_COLORS),
        "shade_color": nearest_color_name(p["shade_color"], SHADE_COLORS),
        "size": "large" if p["shade_radius"] > 0.66 else "small" if p["shade_radius"] < 0.33 else "medium",
        "glow": "bright" if p["shade_glow"] > 0.6 else "opaque" if p["shade_glow"] < 0.25 else "soft",
        "light": "warm" if p["light_warmth"] > 0.5 else "neutral",
    }


def combine_params(plist):
    """Average numeric/colour params, majority-vote categorical ones."""
    out = {}
    for k in CATEGORICAL_KEYS:
        out[k] = Counter(p.get(k, 1 if k == "shade_count" else None) for p in plist).most_common(1)[0][0]
    for k in NUMERIC_KEYS:
        out[k] = sum(p[k] for p in plist) / len(plist)
    for k in COLOR_KEYS:
        out[k] = [sum(p[k][i] for p in plist) / len(plist) for i in range(3)]
    return out


# ---------------------------------------------------------------------------
# Blender helpers
# ---------------------------------------------------------------------------

LAMP_COLL = "Lamp"


def lamp_collection():
    coll = bpy.data.collections.get(LAMP_COLL)
    if coll is None:
        coll = bpy.data.collections.new(LAMP_COLL)
        bpy.context.scene.collection.children.link(coll)
    return coll


def link(obj, parent=None):
    lamp_collection().objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def set_input(node, names, value):
    for n in names if isinstance(names, (list, tuple)) else [names]:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return


def principled(name, srgb, metallic=0.0, roughness=0.5, emit_srgb=None, emit_strength=0.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        nt.nodes.clear()
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(bsdf.outputs[0], out.inputs[0])
    lin = srgb_to_linear(srgb)
    set_input(bsdf, "Base Color", (*lin, 1.0))
    set_input(bsdf, "Metallic", metallic)
    set_input(bsdf, "Roughness", roughness)
    if emit_srgb is not None and emit_strength > 0:
        set_input(bsdf, ["Emission Color", "Emission"], (*srgb_to_linear(emit_srgb), 1.0))
        set_input(bsdf, "Emission Strength", emit_strength)
    m.diffuse_color = (*lin, 1.0)
    return m


def mesh_object(name, bm, material, smooth=True, parent=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        try:
            me.shade_smooth()
        except AttributeError:
            for poly in me.polygons:
                poly.use_smooth = True
    me.materials.append(material)
    obj = bpy.data.objects.new(name, me)
    return link(obj, parent)


def lathe(name, profile, material, segments=64, sharp=(), thickness=0.0, parent=None):
    """Revolve a list of (r, z) points around Z. `sharp` = profile indices to keep crisp."""
    bm = bmesh.new()
    verts = [bm.verts.new((max(r, 0.0), 0.0, z)) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1),
                   angle=2 * math.pi, steps=segments, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    if sharp:
        rings = [(profile[i][0], profile[i][1]) for i in sharp]
        split = []
        for e in bm.edges:
            a, b = e.verts
            for r, z in rings:
                if all(abs(v.co.z - z) < 1e-6 and abs(v.co.xy.length - r) < 1e-5 for v in (a, b)):
                    split.append(e)
                    break
        if split:
            bmesh.ops.split_edges(bm, edges=split)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = mesh_object(name, bm, material, parent=parent)
    if thickness > 0:
        mod = obj.modifiers.new("Solidify", "SOLIDIFY")
        mod.thickness = thickness
        mod.offset = 0.0
    return obj


def tube(name, points, radius, material, smooth=True, parent=None):
    """A round tube along points (bezier if smooth, straight segments otherwise)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 4
    cu.use_fill_caps = True
    if smooth:
        sp = cu.splines.new("BEZIER")
        sp.bezier_points.add(len(points) - 1)
        for bp, co in zip(sp.bezier_points, points):
            bp.co = co
            bp.handle_left_type = bp.handle_right_type = "AUTO"
    else:
        sp = cu.splines.new("POLY")
        sp.points.add(len(points) - 1)
        for pt, co in zip(sp.points, points):
            pt.co = (*co, 1.0)
    cu.materials.append(material)
    return link(bpy.data.objects.new(name, cu), parent)


def sphere(name, center, radius, material, parent=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=radius)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return mesh_object(name, bm, material, parent=parent)


def box(name, size, center, material, bevel=0.0, parent=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    obj = mesh_object(name, bm, material, smooth=False, parent=parent)
    if bevel > 0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        try:
            obj.data.shade_smooth()
            obj.modifiers.new("Smooth", "WEIGHTED_NORMAL")
        except Exception:
            pass
    return obj


# ---------------------------------------------------------------------------
# Lamp parts
# ---------------------------------------------------------------------------

def shade_profile(shape, r, h, taper, steps=24):
    """(r, z) points bottom -> top, z in [0, h]. Bottom always open."""
    pts = []
    if shape == "cone":
        top = r * lerp(0.25, 0.7, taper)
        pts = [(r, 0.0), (top, h)]
    elif shape == "drum":
        top = r * lerp(0.85, 1.0, taper)
        pts = [(r, 0.0), (top, h)]
    elif shape == "flare":
        top = r * lerp(0.12, 0.35, taper)
        for i in range(steps + 1):
            t = i / steps
            pts.append((top + (r - top) * (1 - t) ** 2.2, h * t))
    elif shape == "bell":
        top = r * lerp(0.15, 0.3, taper)
        for i in range(steps + 1):
            t = i / steps
            k = 0.5 - 0.5 * math.cos(math.pi * t)  # ease
            flare = 0.12 * r * (1 - t) ** 6        # lip at the bottom
            pts.append((top + (r - top) * (1 - k) + flare, h * t))
    elif shape == "dome":
        for i in range(steps + 1):
            a = (math.pi / 2) * i / steps
            pts.append((r * math.cos(a), h * math.sin(a)))
    elif shape == "globe":
        open_r = r * lerp(0.25, 0.5, taper)
        a0 = math.pi - math.asin(open_r / r)   # polar angle (from +Z) of the bottom opening
        for i in range(steps + 1):
            a = lerp(a0, 0.0, i / steps)        # bottom -> top
            pts.append((r * math.sin(a), r + r * math.cos(a)))
        zmin = min(z for _, z in pts)
        pts = [(x, z - zmin) for x, z in pts]
    elif shape == "mushroom":
        # low, wide cap with a lip that curls back under
        lip = r * lerp(0.82, 0.92, taper)
        pts.append((lip, 0.0))
        pts.append((r, h * 0.1))
        for i in range(1, steps + 1):
            a = (math.pi / 2) * i / steps
            pts.append((r * math.cos(a), h * 0.1 + h * 0.9 * math.sin(a)))
    elif shape == "saucer":
        # shallow disc with a soft shoulder
        for i in range(steps + 1):
            t = i / steps
            pts.append((r * (1 - 0.7 * t ** 1.6), h * math.sin(t * math.pi / 2)))
    elif shape == "cylinder":
        top = r * lerp(0.92, 1.0, taper)
        pts = [(r, 0.0), (top, h)]
    return pts


def shade_dims(p):
    t = p["type"]
    r = lerp(0.07, 0.2, p["shade_radius"]) * {"floor": 1.3, "pendant": 1.35, "arm": 0.75}.get(t, 1.0)
    shape = p["shade_shape"]
    if shape == "globe":
        h = 2 * r
    else:
        ratio = {"dome": 0.75, "flare": 1.0, "bell": 1.15, "mushroom": 0.6, "saucer": 0.3}.get(shape, 1.0)
        if shape == "cylinder":
            r *= 0.6
            ratio = 2.2
        h = r * lerp(0.6, 1.4, p["shade_height"]) * ratio
    return r, h


def build_shade(p, mat, root, close_top):
    r, h = shade_dims(p)
    pts = shade_profile(p["shade_shape"], r, h, p["shade_taper"])
    if close_top and pts[-1][0] > 1e-4:
        pts.append((0.0, h))
    sharp = (len(pts) - 2,) if close_top and p["shade_shape"] in ("cone", "drum") else ()
    obj = lathe("Shade", pts, mat, sharp=sharp, thickness=0.0035, parent=root)
    return obj, r, h


def build_base(p, mat, root):
    """Returns height of the top of the base."""
    shape = p["base_shape"]
    big = 1.55 if p["type"] == "floor" else 1.0
    R = lerp(0.06, 0.13, p["base_radius"]) * big
    H = lerp(0.012, 0.05, p["base_height"]) * big
    b = min(0.004, H * 0.25)
    if shape == "disc":
        pts = [(0, 0), (R - b, 0), (R, b), (R, H - b), (R - b, H), (0, H)]
        lathe("Base", pts, mat, sharp=(1, 2, 3, 4), parent=root)
    elif shape == "stepped":
        H1 = H * 0.55
        r2 = R * 0.62
        pts = [(0, 0), (R, 0), (R, H1), (r2, H1), (r2, H * 1.6), (0, H * 1.6)]
        lathe("Base", pts, mat, sharp=(1, 2, 3, 4), parent=root)
        H = H * 1.6
    elif shape == "dome":
        top_r = lerp(0.015, 0.03, p["stem_thickness"]) * big
        pts = [(0, 0), (R, 0)]
        n = 16
        for i in range(1, n + 1):
            a = (math.pi / 2) * i / n
            pts.append((top_r + (R - top_r) * math.cos(a), H * 1.8 * math.sin(a)))
        pts.append((0, H * 1.8))
        lathe("Base", pts, mat, sharp=(1, len(pts) - 2), parent=root)
        H = H * 1.8
    elif shape == "square":
        s = R * 1.7
        box("Base", (s, s, H), (0, 0, H / 2), mat, bevel=min(0.004, H * 0.3), parent=root)
    elif shape in ("tripod", "tall_tripod"):
        hub = lerp(0.08, 0.16, p["base_height"]) * big
        if shape == "tall_tripod":
            hub = lerp(0.35, 0.65, p["base_height"]) if p["type"] == "floor" else lerp(0.14, 0.22, p["base_height"])
        leg_r = lerp(0.004, 0.009, p["stem_thickness"]) * big
        spread = R * 1.6
        for i in range(3):
            a = 2 * math.pi * i / 3 + math.pi / 6
            foot = (spread * math.cos(a), spread * math.sin(a), 0.0)
            tube(f"Leg{i}", [(0, 0, hub), foot], leg_r, mat, smooth=False, parent=root)
        sphere("Hub", (0, 0, hub), leg_r * 2.2, mat, parent=root)
        H = hub
    return H


def warm_rgb(w):
    # 0 = neutral 4000K-ish, 1 = very warm 2400K-ish
    return [1.0, lerp(0.88, 0.62, w), lerp(0.72, 0.32, w)]


def add_bulb(p, pos, root, shade_r):
    col = warm_rgb(p["light_warmth"])
    bulb_mat = principled("Bulb", [1, 1, 1], emit_srgb=col, emit_strength=25.0)
    sphere("Bulb", pos, min(0.025, shade_r * 0.3), bulb_mat, parent=root)
    ld = bpy.data.lights.new("BulbLight", "POINT")
    ld.color = srgb_to_linear(col)
    ld.shadow_soft_size = 0.02
    lo = link(bpy.data.objects.new("BulbLight", ld), root)
    lo.location = pos
    return lo


def build_lamp(p):
    """Builds lamp at real-world scale (metres). Returns (root, bulb_light)."""
    root = link(bpy.data.objects.new("LampRoot", None))
    finish = p["finish"]
    metallic, rough = {"matte": (0.0, 0.75), "satin": (0.0, 0.35), "metal": (1.0, 0.22)}[finish]
    body = principled("Body", p["body_color"], metallic, rough)
    glow = p["shade_glow"]
    shade_metal = 1.0 if (finish == "metal" and glow < 0.25) else 0.0
    shade = principled("ShadeMat", p["shade_color"], shade_metal, 0.55 if not shade_metal else 0.25,
                       emit_srgb=[c * w for c, w in zip(p["shade_color"], warm_rgb(p["light_warmth"]))],
                       emit_strength=lerp(0.0, 1.6, glow) if glow > 0.2 else 0.0)

    t = p["type"]
    stem_r = lerp(0.004, 0.011, p["stem_thickness"]) * (1.3 if t == "floor" else 1.0)
    bend = (p["stem_bend"] - 0.5) * 2  # -1..1

    if t in ("table", "floor"):
        bh = build_base(p, body, root)
        L = lerp(0.2, 0.42, p["stem_len"]) if t == "table" else lerp(1.05, 1.5, p["stem_len"])
        top = Vector((bend * 0.08 * L, 0, bh + L))
        mid = Vector((bend * 0.16 * L, 0, bh + L * 0.5))
        tube("Stem", [(0, 0, bh), tuple(mid), tuple(top)], stem_r, body, parent=root)
        shade_obj, r, h = build_shade(p, shade, root, close_top=False)
        shade_obj.location = top - Vector((0, 0, h * 0.55))
        if p["shade_shape"] in ("dome", "globe"):
            shade_obj.location = top - Vector((0, 0, h * 0.35))
        bulb_pos = shade_obj.location + Vector((0, 0, h * 0.4))
        # harp / fitter ring
        tube("Fitter", [tuple(top - Vector((0, 0, 0.004))), tuple(top + Vector((0, 0, 0.012)))],
             stem_r * 1.6, body, smooth=False, parent=root)

    elif t == "arm":
        bh = build_base(p, body, root)
        L = lerp(0.28, 0.5, p["stem_len"])
        reach = lerp(0.15, 0.42, p["arm_reach"])
        elbow = Vector((lerp(-0.1, 0.04, p["stem_bend"]), 0, bh + L))
        head = Vector((reach, 0, bh + L + lerp(-0.12, 0.12, p["stem_bend"])))
        tube("Arm", [(0, 0, bh), tuple(elbow), tuple(head)], stem_r, body, smooth=False, parent=root)
        sphere("Elbow", elbow, stem_r * 1.8, body, parent=root)
        shade_obj, r, h = build_shade(p, shade, root, close_top=True)
        # move origin to the shade top so it hangs from the head
        shade_obj.data.transform(Matrix.Translation((0, 0, -h)))
        tilt = math.radians(lerp(10, 60, p["shade_tilt"]))
        shade_obj.rotation_euler = (0, -tilt, 0)
        shade_obj.location = head
        sphere("Head", head, stem_r * 1.8, body, parent=root)
        axis = Vector((-math.sin(-tilt), 0, -math.cos(-tilt)))  # shade pointing direction
        bulb_pos = head + axis * (h * 0.55)

    else:  # pendant (one shade, or a cluster of three hanging at different heights)
        n = int(p.get("shade_count", 1))
        cord = lerp(0.25, 0.8, p["stem_len"])
        r0, _ = shade_dims(p)
        spread = r0 * 1.45                       # centre-to-centre distance keeps shades from colliding
        cap_r = lerp(0.035, 0.065, p["base_radius"]) if n == 1 else spread + 0.03   # canopy wide enough to catch every cord
        cap_h = lerp(0.015, 0.035, p["base_height"])
        bulbs = []
        r = h = 0
        for i in range(n):
            shade_obj, r, h = build_shade(p, shade, root, close_top=True)
            if n == 1:
                off, drop = Vector((0, 0, 0)), 0.0
            else:
                a = math.radians(90 + 120 * i)
                off, drop = Vector((math.cos(a), math.sin(a), 0)) * spread, cord * (0, 0.22, 0.4)[i]
            ceiling = h + cord
            shade_obj.location = off + Vector((0, 0, drop))
            top = h + drop
            tube(f"Cord{i}", [tuple(off + Vector((0, 0, top))), tuple(off + Vector((0, 0, ceiling)))], 0.003, body,
                 smooth=False, parent=root)
            tube(f"Socket{i}", [tuple(off + Vector((0, 0, top - 0.002))), tuple(off + Vector((0, 0, top + 0.03)))],
                 0.012, body, smooth=False, parent=root)
            bulbs.append(off + Vector((0, 0, drop + h * (0.5 if p["shade_shape"] == "globe" else 0.45))))
        z = h + cord
        lathe("Canopy", [(0, z), (cap_r, z), (cap_r, z + cap_h), (0, z + cap_h)], body,
              sharp=(1, 2), parent=root)
        bulb_pos = bulbs[0]
        for extra in bulbs[1:]:
            add_bulb(p, tuple(extra), root, r)["glow"] = glow

    light = add_bulb(p, tuple(bulb_pos), root, r)
    light["glow"] = glow
    return root, light


# ---------------------------------------------------------------------------
# Scene / studio
# ---------------------------------------------------------------------------

def clear_lamp():
    coll = bpy.data.collections.get(LAMP_COLL)
    if coll:
        for o in list(coll.objects):
            bpy.data.objects.remove(o, do_unlink=True)
    try:
        bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    except TypeError:
        bpy.data.orphans_purge()


def setup_scene(size, samples, engine):
    # wipe the default scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    scene = bpy.context.scene

    if engine == "cycles":
        scene.render.engine = "CYCLES"
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            for dev in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
                try:
                    prefs.compute_device_type = dev
                    prefs.get_devices()
                    if any(d.type == dev for d in prefs.devices):
                        for d in prefs.devices:
                            d.use = True
                        scene.cycles.device = "GPU"
                        break
                except TypeError:
                    continue
        except Exception:
            pass
    else:
        for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
            try:
                scene.render.engine = eng
                break
            except TypeError:
                continue
        try:
            scene.eevee.taa_render_samples = samples
        except Exception:
            pass
        try:
            scene.eevee.use_raytracing = False  # raytraced reflections show the studio lights as white blocks
        except Exception:
            pass

    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass

    # world: soft warm studio grey
    world = bpy.data.worlds.new("Studio")
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg is None:
        bg = world.node_tree.nodes.new("ShaderNodeBackground")
        out = world.node_tree.nodes.new("ShaderNodeOutputWorld")
        world.node_tree.links.new(bg.outputs[0], out.inputs[0])
    bg.inputs["Color"].default_value = (*srgb_to_linear([0.86, 0.84, 0.81]), 1.0)
    bg.inputs["Strength"].default_value = 0.35

    # floor
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=20)
    me = bpy.data.meshes.new("Floor")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(principled("FloorMat", [0.86, 0.84, 0.81], 0.0, 0.9))
    floor = bpy.data.objects.new("Floor", me)
    scene.collection.objects.link(floor)

    # lights
    def area(name, loc, energy, size_):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.size = size_
        o = bpy.data.objects.new(name, ld)
        scene.collection.objects.link(o)
        o.location = loc
        o.visible_camera = False
        try:
            o.visible_glossy = False
        except AttributeError:
            pass
        d = Vector((0, 0, 0.5)) - Vector(loc)
        o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        return o

    area("Key", (2.2, -2.6, 3.0), 220, 2.5)
    area("Fill", (-3.0, -1.5, 1.6), 60, 3.0)
    area("Rim", (-1.0, 3.0, 2.5), 120, 2.0)

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return floor, cam


def lamp_bounds(root):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in lamp_collection().objects:
        if o.type not in ("MESH", "CURVE"):
            continue
        ev = o.evaluated_get(dg)
        if o.type == "CURVE":
            # curve bound_box can be a dummy unit cube; use the evaluated geometry instead
            me = ev.to_mesh()
            pts += [ev.matrix_world @ v.co for v in me.vertices]
            ev.to_mesh_clear()
        else:
            pts += [ev.matrix_world @ Vector(c) for c in ev.bound_box]
    return pts


def frame_lamp(root, light, floor, cam, is_pendant, view=None):
    # normalise lamp to ~1 unit so lighting & framing are consistent
    pts = lamp_bounds(root)
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    dims = hi - lo
    s = 1.0 / max(dims.z, dims.x * 0.9, dims.y * 0.9, 1e-6)
    root.scale = (s, s, s)
    root.location = (-(lo.x + hi.x) / 2 * s, -(lo.y + hi.y) / 2 * s, -lo.z * s + (0.12 if is_pendant else 0.0))
    floor.hide_render = False

    # bulb brightness: watts scale with the square of the (shrunk) shade size
    for lo_ in lamp_collection().objects:
        if lo_.type == "LIGHT" and "glow" in lo_:
            lo_.data.energy = lerp(1.5, 6.0, lo_["glow"]) * s * s * 0.25 + 0.5

    # camera: 3/4 view, orthographic, fitted to projected bounds
    view = view or {}
    direction = Vector((1.0, -1.7, view.get("elev", 0.5)))
    direction.rotate(Matrix.Rotation(math.radians(view.get("az", 0.0)), 3, "Z"))
    direction.normalize()
    pts = lamp_bounds(root)
    center = sum(pts, Vector()) / len(pts)
    cam.location = center + direction * 6
    cam.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    proj = [inv @ p for p in pts]
    xs, ys = [q.x for q in proj], [q.y for q in proj]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    scale = max(w, h) * 1.22
    cam.data.ortho_scale = scale
    cam.data.shift_x = ((max(xs) + min(xs)) / 2) / scale
    cam.data.shift_y = ((max(ys) + min(ys)) / 2) / scale
    cam.data.clip_end = 50
    if DEBUG:
        print("DEBUG dims", tuple(round(x, 3) for x in dims), "s", round(s, 3),
              "proj w,h", round(w, 3), round(h, 3), "ortho", round(scale, 3),
              "objs", [(o.name, o.type) for o in lamp_collection().objects],
              "zrange", round(min(p.z for p in pts), 3), round(max(p.z for p in pts), 3), flush=True)


def set_backdrop(floor, hexcol):
    rgb = srgb_to_linear(hex_to_rgb(hexcol))
    bg = next(n for n in bpy.context.scene.world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (*rgb, 1.0)
    bsdf = next(n for n in floor.data.materials[0].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)


def render_lamp(p, path, floor, cam, view=None):
    clear_lamp()
    set_backdrop(floor, (view or {}).get("bg", BACKDROPS[0]))
    root, light = build_lamp(p)
    frame_lamp(root, light, floor, cam, p["type"] == "pendant", view)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="gen_lamps.py")
    ap.add_argument("--count", type=int, default=200)
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--out", default=os.path.join(HERE, "out"))
    ap.add_argument("--size", type=int, default=512, help="render size in px")
    ap.add_argument("--samples", type=int, default=32)
    ap.add_argument("--engine", choices=["eevee", "cycles"], default="eevee")
    ap.add_argument("--combine", help="JSON file with the ids of liked lamps")
    ap.add_argument("--start", type=int, default=1, help="first lamp number (to resume)")
    ap.add_argument("--chunk", type=int, default=10,
                    help="lamps per Blender process (EEVEE goes black after ~18 renders in one session)")
    ap.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--debug", action="store_true")
    ap.add_argument("--redo", help="comma-separated lamp numbers to re-render in place, e.g. 17,45")
    return ap.parse_args(argv)


def image_is_black(path):
    img = bpy.data.images.load(path, check_existing=False)
    try:
        px = img.pixels[:]
        step = max(4, (len(px) // 4 // 2000) * 4)
        vals = [px[i] + px[i + 1] + px[i + 2] for i in range(0, len(px) - 3, step)]
        return sum(vals) / max(1, len(vals)) < 0.06
    finally:
        bpy.data.images.remove(img)


def read_db(db_path):
    if not os.path.exists(db_path):
        return []
    with open(db_path) as f:
        return json.load(f)["lamps"]


def drive(a, out, db_path):
    """Render in fresh Blender processes of `chunk` lamps each, resuming where each one stopped."""
    t0 = time.time()
    nxt, end, stalls = a.start, a.start + a.count, 0
    while nxt < end:
        n = min(a.chunk, end - nxt)
        cmd = [bpy.app.binary_path, "-b", "--factory-startup", "-P", os.path.abspath(__file__), "--",
               "--worker", "--start", str(nxt), "--count", str(n), "--seed", str(a.seed), "--out", out,
               "--size", str(a.size), "--samples", str(a.samples), "--engine", a.engine]
        if a.debug:
            cmd.append("--debug")
        subprocess.run(cmd)
        ids = [int(l["id"].split("_")[1]) for l in read_db(db_path)]
        reached = max(ids) + 1 if ids else a.start
        if reached <= nxt:
            stalls += 1
            if stalls >= 3:
                sys.exit(f"Rendering keeps failing at lamp {nxt}; stopping.")
        else:
            stalls = 0
            done = reached - a.start
            eta = (time.time() - t0) / done * (a.count - done)
            print(f"=== {done}/{a.count} lamps done, ETA {eta/60:.1f} min ===", flush=True)
        nxt = max(nxt, reached)
    print(f"Done: {a.count} lamps in {(time.time() - t0)/60:.1f} min -> {out}")


def main():
    a = parse_args()
    out = os.path.abspath(a.out)
    os.makedirs(os.path.join(out, "lamps"), exist_ok=True)
    db_path = os.path.join(out, "lamps.json")

    if not a.combine and not a.worker and not a.redo and a.count > a.chunk:
        return drive(a, out, db_path)

    floor, cam = setup_scene(a.size, a.samples, a.engine)

    if a.combine:
        with open(a.combine) as f:
            liked = json.load(f)
        if isinstance(liked, dict):
            liked = liked.get("liked", [])
        db = {l["id"]: l for l in read_db(db_path)}
        plist = [db[i]["params"] for i in liked if i in db]
        if not plist:
            sys.exit("None of the liked ids were found in lamps.json")
        p = combine_params(plist)
        render_lamp(p, os.path.join(out, "combined.jpg"), floor, cam)
        with open(os.path.join(out, "combined.json"), "w") as f:
            json.dump({"from": liked, "params": p, "tags": tags_for(p), "image": "combined.jpg"}, f, indent=1)
        print(f"Combined {len(plist)} lamps -> {os.path.join(out, 'combined.jpg')}")
        return

    if a.redo:
        # re-render specific lamps (same seed -> same lamp) and update their entries in place
        lamps = read_db(db_path)
        for n in [int(x) for x in a.redo.split(",") if x.strip()]:
            rng = random.Random(a.seed * 100003 + n)
            p = random_params(rng)
            view = {"az": round(rng.uniform(-30, 30), 1), "elev": round(rng.uniform(0.45, 0.7), 2), "bg": rng.choice(BACKDROPS)}
            lid = f"lamp_{n:04d}"
            render_lamp(p, os.path.join(out, "lamps", lid + ".jpg"), floor, cam, view)
            for l in lamps:
                if l["id"] == lid:
                    l.update({"params": p, "tags": tags_for(p), "view": view})
            print(f"  redid {lid}", flush=True)
        with open(db_path, "w") as f:
            json.dump({"seed": a.seed, "count": len(lamps), "lamps": lamps}, f, indent=1)
        return

    lamps = [l for l in read_db(db_path) if int(l["id"].split("_")[1]) < a.start] if a.start > 1 else []

    def save():
        with open(db_path, "w") as f:
            json.dump({"seed": a.seed, "count": len(lamps), "lamps": lamps}, f, indent=1)

    t0 = time.time()
    for n in range(a.start, a.start + a.count):
        rng = random.Random(a.seed * 100003 + n)
        p = random_params(rng)
        view = {"az": round(rng.uniform(-30, 30), 1), "elev": round(rng.uniform(0.45, 0.7), 2), "bg": rng.choice(BACKDROPS)}
        lid = f"lamp_{n:04d}"
        rel = f"lamps/{lid}.jpg"
        path = os.path.join(out, rel)
        render_lamp(p, path, floor, cam, view)
        if image_is_black(path):
            print(f"{lid} rendered black; restarting Blender to retry", flush=True)
            save()
            sys.exit(3)
        lamps.append({"id": lid, "image": rel, "params": p, "tags": tags_for(p), "view": view})
        save()
        print(f"  {lid}  {p['type']:7s} {p['shade_shape']:6s}", flush=True)
    print(f"Rendered {a.count} lamps in {(time.time() - t0)/60:.1f} min")


if __name__ == "__main__":
    main()
