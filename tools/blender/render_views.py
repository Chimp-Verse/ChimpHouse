"""Render viewpoint cameras from a ChimpHouse Blender file.

    blender --background <file.blend> --python tools/blender/render_views.py -- <out dir> [view id...] [--scale 50] [--samples 16]

Cameras are the "View: …" objects the build adds; their "view" property is the
preview's viewpoint id (front, entry, theatre…). With no ids, every camera is
rendered. Each goes to <out dir>/<id>.png.
"""

import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :]
out_dir = os.path.abspath(argv[0])
scale = 100
samples = None
ids = []
args = iter(argv[1:])
for a in args:
    if a == "--scale":
        scale = int(next(args))
    elif a == "--samples":
        samples = int(next(args))
    else:
        ids.append(a)

scene = bpy.context.scene
scene.render.resolution_percentage = scale
if samples:
    scene.eevee.taa_render_samples = samples
scene.render.image_settings.file_format = "PNG"
os.makedirs(out_dir, exist_ok=True)
cams = {o.get("view", o.name): o for o in bpy.data.objects if o.type == "CAMERA"}
for view in ids or list(cams):
    cam = cams.get(view)
    if not cam:
        print(f"No viewpoint {view}")
        continue
    scene.camera = cam
    scene.render.filepath = os.path.join(out_dir, f"{view}.png")
    bpy.ops.render.render(write_still=True)
    print(f"Rendered {view}")
