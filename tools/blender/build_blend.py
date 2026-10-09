"""Build a Blender file from rooms or zones exported by the ChimpHouse preview.

    blender --background --factory-startup --python tools/blender/build_blend.py -- \
        <out.blend> <export.glb or folder of them>... [--rooms <dir>] [--scene scene.json] [--render <view>=<out.png>]...

The whole house: `node tools/export-house.mjs`, then

    ... build_blend.py -- art/ChimpHouse.blend art/test/house --rooms art/rooms

(scene.json is picked up from the folder). One room: `node tools/export-room.mjs
theatre`, then build from `art/test/theatre.glb`, whose lights, sun and camera travel
inside it.

The script imports every export, turns their Group and Zone nodes into collections
(Upper > Theatre, Site > Canopy Bridge), shares the materials and images the exports
each carry a copy of, rebuilds editable topology (see rebuild_quads), saves every
texture as a PNG in a `textures` folder next to the .blend, and moves each zone's
leaves into a "<zone> · Foliage" collection, so they can be switched off.

With --rooms the house is split into linked files, so each room can be opened and
edited alone and only the files that change take new storage: every material goes in
a library beside the master (`materials.blend`), each room or zone in a file of its
own in the rooms folder, using the library's materials, and the master links every
room and holds the lights, the sun, a camera per viewpoint and the render settings.
Without it, everything goes in the one file. Each --render renders one viewpoint
(its id from the preview's viewpoints, or "active").

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

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
blend_path = os.path.abspath(argv[0])
inputs, scene_path, renders, rooms_dir = [], None, [], None
args = iter(argv[1:])
for a in args:
    if a == "--rooms":
        rooms_dir = os.path.abspath(next(args))
    elif a == "--scene":
        scene_path = os.path.abspath(next(args))
    elif a == "--render":
        view, out = next(args).split("=", 1)
        renders.append((view, os.path.abspath(out)))
    elif os.path.isdir(a):
        inputs += sorted(os.path.join(a, f) for f in os.listdir(a) if f.endswith(".glb"))
        if not scene_path and os.path.exists(os.path.join(a, "scene.json")):
            scene_path = os.path.abspath(os.path.join(a, "scene.json"))
    else:
        inputs.append(os.path.abspath(a))

# Interior lights in the preview are brightened by these in the day and at night.
DAY_BOOST = 1.6
NIGHT_BOOST = 2.2
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
    # strip only a real image extension: names like "chart:151:0.58" hold dots of their own
    base = re.sub(r"\.(png|jpe?g|webp)$", "", os.path.basename(name), flags=re.I) or "image"
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", base)


# ---------------------------------------------------------------- import
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
for path in inputs:
    bpy.ops.import_scene.gltf(filepath=path, merge_vertices=True)
    print(f"Imported {os.path.basename(path)}")

# every export carries its own copy of the materials and images it uses ("teal", "teal.001"):
# keep one of each
for coll in (bpy.data.materials, bpy.data.images):
    for d in list(coll):
        base = re.sub(r"\.\d{3}$", "", d.name)
        if base != d.name and base in coll:
            d.user_remap(coll[base])
            coll.remove(d)

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
    # colour layers (the terrain's, the gravel path's), read per face corner
    colours = []
    for a in me.color_attributes:
        vals = [tuple(d.color) for d in a.data]
        per_corner = vals if a.domain == "CORNER" else [vals[l.vertex_index] for l in me.loops]
        colours.append((a.name, a.data_type, per_corner))
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
    for name, data_type, per_corner in colours:
        a = me.color_attributes.new(name, data_type, "CORNER")
        a.data.foreach_set("color", [x for k in order for x in per_corner[k]])
        me.color_attributes.active_color = a
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
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
print(f"Topology: {quads} quads, {tris} triangles", flush=True)

# ---------------------------------------------------------------- Group > Zone collections
# each export is Group (Lower, Upper, Building, Site) > Zone (a room, the structure…) > items
preview = {}
for name in ("Lower", "Upper", "Building", "Site"):
    if any(o.type == "EMPTY" and o.name.split(".")[0] == name for o in bpy.data.objects):
        scene.collection.children.link(bpy.data.collections.new(name))
# a role empty (a cabinet slot, a remote spot, the lift car) carries its zone too, but sits inside it: not a zone of its own
for zone_empty in [o for o in bpy.data.objects if o.type == "EMPTY" and ("zone" in o.keys() or "room" in o.keys()) and "role" not in o.keys()]:
    group_name = zone_empty.parent.name.split(".")[0]
    group_col = bpy.data.collections.get(group_name) or bpy.data.collections.new(group_name)
    if group_col.name not in scene.collection.children:
        scene.collection.children.link(group_col)
    zone_col = bpy.data.collections.new(zone_empty.name)
    group_col.children.link(zone_col)
    for key in ("zone", "room", "level"):
        if key in zone_empty.keys():
            zone_col[key] = zone_empty[key]
    preview = json.loads(zone_empty.get("preview", "{}")) or preview
    for ob in list(zone_empty.children):
        mw = ob.matrix_world.copy()
        ob.parent = None
        ob.matrix_world = mw
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        zone_col.objects.link(ob)
for _ in range(2):
    for ob in [o for o in bpy.data.objects if o.type == "EMPTY" and not o.children]:
        bpy.data.objects.remove(ob)
# names used in more than one zone ("Armchair 1" in the lounge and the bar) carry their
# zone, rather than an import-order suffix: "Armchair 1 · Bar & Lounge"
zone_cols = [c for g in scene.collection.children for c in g.children]
zones_of = {}
for c in zone_cols:
    for ob in c.objects:
        zones_of.setdefault(re.sub(r"\.\d{3}$", "", ob.name), set()).add(c.name)
for c in zone_cols:
    for ob in list(c.objects):
        base = re.sub(r"\.\d{3}$", "", ob.name)
        if len(zones_of[base]) > 1:
            ob.name = f"{base} · {c.name}"
if scene_path:
    with open(scene_path) as f:
        preview = json.load(f)

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

# ---------------------------------------------------------------- foliage collections
def split_foliage(zone_col):
    """Move a zone's leaves into a "<zone> · Foliage" collection; returns how many objects.

    A plant's or tree's leaves become an object of their own, parented to the plant so
    they move with it; a clump that is all leaves moves whole.
    """
    leaves = bpy.data.materials.get("leaves")
    foliage, n = None, 0
    for ob in [o for o in zone_col.objects if o.type == "MESH"]:
        me = ob.data
        slot = next((i for i, m in enumerate(me.materials) if m == leaves), None)
        if leaves is None or slot is None:
            continue
        if foliage is None:
            foliage = bpy.data.collections.new(f"{zone_col.name} · Foliage")
            zone_col.children.link(foliage)
        n += 1
        if len(me.materials) == 1:
            zone_col.objects.unlink(ob)
            foliage.objects.link(ob)
            continue
        bm = bmesh.new()
        bm.from_mesh(me)
        leaf_bm = bm.copy()
        bmesh.ops.delete(leaf_bm, geom=[f for f in leaf_bm.faces if f.material_index != slot], context="FACES")
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == slot], context="FACES")
        for f in bm.faces:
            if f.material_index > slot:
                f.material_index -= 1
        for f in leaf_bm.faces:
            f.material_index = 0
        bm.to_mesh(me)
        bm.free()
        me.materials.pop(index=slot)
        leaf_me = bpy.data.meshes.new(f"{me.name} leaves")
        leaf_bm.to_mesh(leaf_me)
        leaf_bm.free()
        leaf_me.materials.append(leaves)
        name, _, zone = ob.name.partition(" · ")
        leaf_ob = bpy.data.objects.new(f"{name} leaves" + (f" · {zone}" if zone else ""), leaf_me)
        foliage.objects.link(leaf_ob)
        leaf_ob.parent = ob  # same mesh space as the plant: no offset
    return n


zone_cols = [c for g in scene.collection.children for c in g.children]
print(f"Foliage: {sum(split_foliage(c) for c in zone_cols)} objects in foliage collections", flush=True)


# ---------------------------------------------------------------- lights, sun, cameras, render settings
def setup_scene(scene, preview):
    """Lights, sun, world, a camera per viewpoint and render settings; returns cameras by view id."""
    lights_col = bpy.data.collections.new("Lighting")
    scene.collection.children.link(lights_col)
    counts = {}
    for ld in preview.get("lights", []):
        kind = "SPOT" if ld.get("kind") == "spot" else "POINT"
        room = ld["rooms"][0]
        counts[room] = counts.get(room, 0) + 1
        data = bpy.data.lights.new(f"Light: {room} {counts[room]}", kind)
        data.color = srgb_to_linear(ld["color"])
        data.energy = ld["day"] * DAY_BOOST * WATTS_PER_UNIT
        data.shadow_soft_size = 0.15
        data.use_custom_distance = True
        data.cutoff_distance = ld["range"]
        ob = bpy.data.objects.new(data.name, data)
        ob.location = to_blender(ld["pos"])
        # the preview's night brightness, for a night lighting setup
        ob["night_energy"] = ld["night"] * NIGHT_BOOST * WATTS_PER_UNIT
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

    cams_col = bpy.data.collections.new("Cameras")
    scene.collection.children.link(cams_col)
    views = {}
    for cam_def in preview.get("cameras", []) + ([preview["camera"]] if preview.get("camera") else []):
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
        ob["view"] = cam_def.get("id", "")
        if cam_def.get("ref"):
            ob["reference_image"] = cam_def["ref"]
        cams_col.objects.link(ob)
        views[cam_def.get("id", cam_def["name"])] = ob
        scene.camera = scene.camera or ob

    engines = {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = RESOLUTION
    scene.render.resolution_percentage = 100
    scene.eevee.taa_render_samples = 64
    if hasattr(scene.eevee, "use_raytracing"):
        scene.eevee.use_raytracing = True
    scene.unit_settings.system = "METRIC"
    return views


def save(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=path)
    bpy.ops.file.make_paths_relative()
    bpy.ops.wm.save_mainfile()


# ---------------------------------------------------------------- one file, or linked room files
if not rooms_dir:
    views = setup_scene(scene, preview)
    save(blend_path)
    objects = [o for o in bpy.data.objects if o.type == "MESH"]
    print(f"Saved {blend_path}: {len(objects)} objects, {len(bpy.data.materials)} materials, {len(bpy.data.images)} images in {tex_dir}")
else:
    # the material library, then every material swapped for its linked copy
    materials_path = os.path.join(os.path.dirname(blend_path), "materials.blend")
    bpy.data.libraries.write(materials_path, set(bpy.data.materials), path_remap="RELATIVE_ALL", fake_user=True, compress=True)
    with bpy.data.libraries.load(materials_path, link=True) as (src, dst):
        dst.materials = list(src.materials)
    linked = {m.name: m for m in dst.materials}
    for m in [m for m in bpy.data.materials if m.library is None]:
        if m.name in linked:
            m.user_remap(linked[m.name])
            bpy.data.materials.remove(m)
    print(f"Saved {materials_path}: {len(linked)} materials", flush=True)

    # a file per room or zone, with a scene of its own so it opens on its own: the build is
    # saved once, then opened per room with everything else deleted (writing a scene into a
    # partial file crashes Blender 5.2)
    os.makedirs(rooms_dir, exist_ok=True)
    whole = os.path.join(os.path.dirname(rooms_dir), ".whole-house.blend")
    bpy.ops.wm.save_as_mainfile(filepath=whole, relative_remap=False)
    zones = [(g.name, z.name, "-".join(p for p in (z.get("level", ""), z.get("zone", z.get("room", ""))) if p) or file_name(z.name)) for g in scene.collection.children for z in g.children]
    rooms = []
    for group_name, zone_name, slug in zones:
        bpy.ops.wm.open_mainfile(filepath=whole)
        sc = bpy.context.scene
        zone_col = bpy.data.collections[zone_name]
        keep = set(zone_col.all_objects)
        for c in list(sc.collection.children):
            sc.collection.children.unlink(c)
        sc.collection.children.link(zone_col)
        for ob in [o for o in bpy.data.objects if o not in keep]:
            bpy.data.objects.remove(ob)
        bpy.data.orphans_purge(do_recursive=True)
        sc.name = zone_name
        path = os.path.join(rooms_dir, f"{slug}.blend")
        save(path)
        rooms.append((group_name, zone_name, path))
        print(f"Saved {path}: {len(zone_col.all_objects)} objects", flush=True)
    os.remove(whole)

    # the master: every room linked into its group, with the lights, sun and cameras
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    scene = bpy.context.scene
    for group_name, zone_name, path in rooms:
        group_col = bpy.data.collections.get(group_name)
        if not group_col:
            group_col = bpy.data.collections.new(group_name)
            scene.collection.children.link(group_col)
        with bpy.data.libraries.load(path, link=True) as (src, dst):
            dst.collections = [zone_name]
        for c in dst.collections:
            group_col.children.link(c)
    views = setup_scene(scene, preview)
    save(blend_path)
    print(f"Saved {blend_path}: {len(rooms)} linked rooms, {len(views)} cameras")

for view, out in renders:
    cam = bpy.context.scene.camera if view == "active" else views.get(view)
    if not cam:
        print(f"No viewpoint {view}")
        continue
    bpy.context.scene.camera = cam
    bpy.context.scene.render.filepath = out
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print(f"Rendered {view}: {out}")
