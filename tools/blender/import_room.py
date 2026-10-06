"""Build a Blender file from a room exported by the ChimpHouse preview.

    blender --background --factory-startup --python tools/blender/import_room.py -- \
        art/test/theatre.glb art/test/ChimpHouse-theatre-test.blend [--render out.png]

Export the room first with `node tools/export-room.mjs theatre`. The script
imports the .glb, rebuilds editable topology (see rebuild_quads), turns its Level and Room nodes into collections
(Upper > Theatre), saves every texture as a PNG in a `textures` folder next
to the .blend, rebuilds the room's lights, the sun and the viewpoint camera
from the preview data the export carries, and saves the file. With
--render it also renders the viewpoint.

glTF stores only triangles, with a separate vertex wherever a face is flat-shaded, so
every item would arrive as loose triangles. The import welds coincident vertices and
rebuilds the quads the preview generated, so items can be reshaped in Blender.

The preview data uses Babylon's axes (left-handed, y up). glTF negates x,
and Blender's importer turns glTF's y-up into z-up, so a preview point
(x, y, z) is (-x, -z, y) in Blender.
"""

import json
import math
import os
import re
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
glb_path = os.path.abspath(argv[0])
blend_path = os.path.abspath(argv[1])
render_path = os.path.abspath(argv[argv.index("--render") + 1]) if "--render" in argv else None

# Interior lights in the preview are brightened by these in the day and at night.
DAY_BOOST = 1.6
# Watts per unit of preview light intensity, chosen by comparing renders with the preview.
WATTS_PER_UNIT = 40.0
SUN_STRENGTH = 4.0
RESOLUTION = (1672, 941)


def to_blender(p):
    x, y, z = p
    return Vector((-x, -z, y))


def srgb_to_linear(hex_color):
    h = hex_color.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i : i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return out


def file_name(name):
    base = os.path.splitext(os.path.basename(name))[0] or "image"
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", base)


# ---------------------------------------------------------------- import
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
bpy.ops.import_scene.gltf(filepath=glb_path, merge_vertices=True)

# ---------------------------------------------------------------- editable topology
def rebuild_quads(me):
    """Join each generated quad's two triangles back into the quad, keeping shape and shading.

    The preview builds quads as two consecutive triangles split along one diagonal, and
    that order survives the export. Each quad is rebuilt starting at that diagonal's
    first corner, because Blender splits a quad from its first corner to its third when
    it renders it; any other start can flip the split and dent curved surfaces. Every
    corner keeps the normal and UV it had, so the shading doesn't change.
    """
    ps, loops = me.polygons, me.loops
    normals = [c.vector.copy() for c in me.corner_normals]
    uv_layers = [[d.uv.copy() for d in layer.data] for layer in me.uv_layers]
    uv_names = [layer.name for layer in me.uv_layers]
    faces, corners, mats = [], [], []
    i = 0
    while i < len(ps):
        a = ps[i]
        quad = None
        if i + 1 < len(ps) and a.loop_total == 3 and ps[i + 1].loop_total == 3 and a.material_index == ps[i + 1].material_index:
            la = list(range(a.loop_start, a.loop_start + 3))
            lb = list(range(ps[i + 1].loop_start, ps[i + 1].loop_start + 3))
            va = [loops[k].vertex_index for k in la]
            vb = [loops[k].vertex_index for k in lb]
            shared = set(va) & set(vb)
            if len(shared) == 2 and va[0] == vb[0] and len(set(va) | set(vb)) == 4:
                if va[2] == vb[1]:  # A = (a, p, s), B = (a, s, q)
                    quad = [la[0], la[1], la[2], lb[2]]
                elif va[1] == vb[2]:  # A = (a, s, p), B = (a, q, s)
                    quad = [la[0], lb[1], la[1], la[2]]
        if quad:
            corners.append(quad)
            i += 2
        else:
            corners.append(list(range(a.loop_start, a.loop_start + a.loop_total)))
            i += 1
        mats.append(a.material_index)
    # weld vertices at the same position, so flat-shaded boxes and panels become closed
    # shells; each corner keeps its own normal, so sharp edges stay sharp. A corner that
    # welds onto its neighbour (a lathe's tip) is dropped, and so is a face left with
    # fewer than three corners. The back face of a two-sided surface keeps its own
    # vertices, since Blender can't hold two faces on the same corners.
    weld, verts, remap = {}, [], []
    for v in me.vertices:
        key = (round(v.co.x, 5), round(v.co.y, 5), round(v.co.z, 5))
        if key not in weld:
            weld[key] = len(verts)
            verts.append(v.co.copy())
        remap.append(weld[key])
    faces, kept_corners, kept_mats, seen = [], [], [], set()
    for c, m in zip(corners, mats):
        f = [remap[loops[k].vertex_index] for k in c]
        keep = [j for j in range(len(f)) if f[j] != f[j - 1]]
        f2 = [f[j] for j in keep]
        if len(set(f2)) < 3 or len(set(f2)) < len(f2):
            continue
        if frozenset(f2) in seen:
            # the back of a two-sided surface (glass): keep it, on its own vertices
            verts += [verts[j].copy() for j in f2]
            f2 = list(range(len(verts) - len(f2), len(verts)))
        seen.add(frozenset(f2))
        faces.append(f2)
        kept_corners.append([c[j] for j in keep])
        kept_mats.append(m)
    corners, mats = kept_corners, kept_mats
    me.clear_geometry()
    me.from_pydata(verts, [], faces)
    order = [k for c in corners for k in c]
    for name, data in zip(uv_names, uv_layers):
        layer = me.uv_layers.get(name) or me.uv_layers.new(name=name)
        layer.data.foreach_set("uv", [x for k in order for x in data[k]])
    me.polygons.foreach_set("material_index", mats)
    me.polygons.foreach_set("use_smooth", [True] * len(faces))
    me.normals_split_custom_set([normals[k] for k in order])
    return sum(1 for c in corners if len(c) == 4), sum(1 for c in corners if len(c) != 4)


# The importer welds coincident vertices (keeping the file's normals as custom normals),
# so each part is one connected mesh; then the generated quads are rebuilt.
tris = quads = 0
for me in {o.data for o in bpy.data.objects if o.type == "MESH"}:
    q, t = rebuild_quads(me)
    quads += q
    tris += t
print(f"Topology: {quads} quads, {tris} triangles")

# ---------------------------------------------------------------- Level > Room collections
room_empties = [o for o in bpy.data.objects if o.type == "EMPTY" and "room" in o.keys()]
preview = {}
for room_empty in room_empties:
    level_empty = room_empty.parent
    level_col = bpy.data.collections.get(level_empty.name) or bpy.data.collections.new(level_empty.name)
    if level_col.name not in scene.collection.children:
        scene.collection.children.link(level_col)
    room_col = bpy.data.collections.new(room_empty.name)
    level_col.children.link(room_col)
    room_col["room"] = room_empty["room"]
    room_col["level"] = room_empty["level"]
    preview = json.loads(room_empty.get("preview", "{}"))
    for ob in list(room_empty.children):
        mw = ob.matrix_world.copy()
        ob.parent = None
        ob.matrix_world = mw
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        room_col.objects.link(ob)
for ob in [o for o in bpy.data.objects if o.type == "EMPTY" and not o.children]:
    bpy.data.objects.remove(ob)
for ob in [o for o in bpy.data.objects if o.type == "EMPTY" and not o.children]:
    bpy.data.objects.remove(ob)

# ---------------------------------------------------------------- textures as files
tex_dir = os.path.join(os.path.dirname(blend_path), "textures")
os.makedirs(tex_dir, exist_ok=True)
# glTF images arrive packed with no original path, so each is written out and loaded back
# from its file, keeping its colour space (normal maps are non-colour data)
for img in [i for i in bpy.data.images if i.packed_file]:
    name = file_name(img.name)
    path = os.path.join(tex_dir, name + ".png")
    with open(path, "wb") as f:
        f.write(img.packed_file.data)
    loaded = bpy.data.images.load(path)
    loaded.colorspace_settings.name = img.colorspace_settings.name
    loaded.alpha_mode = img.alpha_mode
    img.user_remap(loaded)
    bpy.data.images.remove(img)
    loaded.name = name

# ---------------------------------------------------------------- lights, sun, camera
lights_col = bpy.data.collections.new("Lighting")
scene.collection.children.link(lights_col)
for i, ld in enumerate(preview.get("lights", [])):
    kind = "SPOT" if ld.get("kind") == "spot" else "POINT"
    data = bpy.data.lights.new(f"Room light {i + 1}", kind)
    data.color = srgb_to_linear(ld["color"])
    data.energy = ld["day"] * DAY_BOOST * WATTS_PER_UNIT
    data.shadow_soft_size = 0.15
    data.use_custom_distance = True
    data.cutoff_distance = ld["range"]
    ob = bpy.data.objects.new(data.name, data)
    ob.location = to_blender(ld["pos"])
    if kind == "SPOT":
        data.spot_size = ld.get("angle", 1.2)
        d = to_blender(ld.get("dir") or (0, -1, 0))
        ob.rotation_mode = "QUATERNION"
        ob.rotation_quaternion = d.to_track_quat("-Z", "Y")
    lights_col.objects.link(ob)

sun = preview.get("sun")
if sun:
    data = bpy.data.lights.new("Sun", "SUN")
    data.color = srgb_to_linear(sun["color"])
    data.energy = SUN_STRENGTH
    data.angle = math.radians(1.5)
    ob = bpy.data.objects.new("Sun", data)
    ob.rotation_mode = "QUATERNION"
    # the preview's sun direction points towards the sun; the lamp shines along its -Z
    ob.rotation_quaternion = (-to_blender(sun["dir"])).to_track_quat("-Z", "Y")
    lights_col.objects.link(ob)

world = bpy.data.worlds.new("Jungle daylight")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.42, 0.52, 0.62, 1)
bg.inputs["Strength"].default_value = 1.0
scene.world = world

cam_def = preview.get("camera")
if cam_def:
    data = bpy.data.cameras.new(cam_def["name"])
    data.sensor_fit = "VERTICAL"
    data.angle = cam_def["fov"]
    data.clip_start = 0.05
    data.clip_end = 2000
    ob = bpy.data.objects.new(f"View: {cam_def['name']}", data)
    ob.location = to_blender((cam_def["x"], cam_def["y"], cam_def["z"]))
    yaw, pitch = cam_def["yaw"], cam_def["pitch"]
    forward = (math.sin(yaw) * math.cos(pitch), -math.sin(pitch), math.cos(yaw) * math.cos(pitch))
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = to_blender(forward).to_track_quat("-Z", "Y")
    lights_col.objects.link(ob)
    scene.camera = ob

# ---------------------------------------------------------------- render settings
engines = {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = RESOLUTION
scene.render.resolution_percentage = 100
scene.eevee.taa_render_samples = 64
if hasattr(scene.eevee, "use_raytracing"):
    scene.eevee.use_raytracing = True

# ---------------------------------------------------------------- save (and render)
os.makedirs(os.path.dirname(blend_path), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
bpy.ops.file.make_paths_relative()
bpy.ops.wm.save_mainfile()

objects = [o for o in bpy.data.objects if o.type == "MESH"]
print(f"Saved {blend_path}: {len(objects)} objects, {len(bpy.data.materials)} materials, {len(bpy.data.images)} images in {tex_dir}")

if render_path:
    scene.render.filepath = render_path
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print(f"Rendered {render_path}")
