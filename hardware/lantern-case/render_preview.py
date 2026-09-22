"""Run with Blender --background --factory-startup --python render_preview.py.
Only a fresh background scene is used. Never touches a live user Blender file.
"""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector, Matrix

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'exports'
manifest=json.loads((OUT/'preview-manifest.json').read_text())
scene=bpy.context.scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene.unit_settings.system='METRIC'
scene.unit_settings.length_unit='MILLIMETERS'
scene.render.resolution_x=1500
scene.render.resolution_y=1100
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=False
scene.view_settings.exposure=-3.5
scene.world.color=(.07,.07,.07)
scene.world.use_nodes=True
background=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND')
background.inputs['Color'].default_value=(.045,.06,.052,1)
background.inputs['Strength'].default_value=.6

def material(name,color,metallic=0,roughness=.42,emission=0):
    m=bpy.data.materials.new(name)
    m.use_nodes=True
    n=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    n.inputs['Base Color'].default_value=(*color,1)
    n.inputs['Metallic'].default_value=metallic
    n.inputs['Roughness'].default_value=roughness
    if emission:
        n.inputs['Emission Color'].default_value=(*color,1)
        n.inputs['Emission Strength'].default_value=emission
    return m

mats={
 'front_shell':material('Forest green printed shell',(.008,.10,.03)),
 'rear_lid':material('Graphite rear cover',(.004,.008,.005)),
 'battery_tray':material('Removable battery tray',(.10,.31,.22)),
 'speaker_retainer':material('Speaker retaining ring',(.055,.085,.067)),
 'board_reference':material('PCB reference',(.008,.012,.011)),
 'glass_reference':material('Touchscreen glass reference',(.009,.014,.018),roughness=.18),
 'display_reference':material('Illustrative display',(.016,.14,.062),roughness=.3,emission=.25),
 'battery_reference':material('Battery envelope, measured',(.72,.48,.055),metallic=.15),
 'speaker_reference':material('Speaker envelope, measured',(.025,.027,.025)),
 'usb_reference':material('USB-C reference',(.35,.39,.37),metallic=.8),
 'branding_finish_reference':material('Optional white paint in engraved branding',(.85,.90,.86)),
}
objects={}
for item in manifest['parts']:
    bpy.ops.wm.stl_import(filepath=str(OUT/item['file']))
    obj=bpy.context.object
    obj.name=item['name']
    obj.scale=(.001,)*3
    obj.data.materials.clear()
    obj.data.materials.append(mats[item['name']])
    objects[obj.name]=obj
    # Small visual bevel only; manufacturing geometry remains the exported CAD.
    if item['name']!='branding_finish_reference':
        bevel=obj.modifiers.new('Render edge highlight','BEVEL')
        bevel.width=.12
        bevel.segments=2

letter_mat=material('Soft white lettering',(.64,.91,.74),emission=.5)
def label(name,text,position,size,mat=letter_mat):
    bpy.ops.object.text_add(location=tuple(p*.001 for p in position),rotation=(0,math.pi,0))
    o=bpy.context.object
    o.name=name
    o.data.body=text
    o.data.align_x='CENTER'
    o.data.align_y='CENTER'
    o.data.size=size*.001
    o.data.extrude=0
    o.data.materials.append(mat)
    return o

bx=manifest['parameters']['board']['center_x']
screen_texts=[label('Display title','LANTERN',(bx,12,2.49),5),
              label('Display status','READY',(bx,-2,2.49),2.7),
              label('Display footer','SERVICE PROTOTYPE',(bx,-14,2.49),1.7)]
# Display text is illustrative. Front branding comes from the real CAD recess.

def light(name,location,power,size):
    d=bpy.data.lights.new(name,'AREA'); o=bpy.data.objects.new(name,d)
    scene.collection.objects.link(o)
    o.location=Vector(location)*.001
    o.rotation_euler=(Vector((0,0,.015))-o.location).to_track_quat('-Z','Y').to_euler()
    d.energy=power; d.shape='DISK'; d.size=size*.001

light('Key softbox',(-100,160,-150),30,150)
light('Fill softbox',(160,30,-60),22,130)
light('Rear rim',(40,100,180),35,120)
cam_data=bpy.data.cameras.new('Review camera')
cam=bpy.data.objects.new('Review camera',cam_data)
scene.collection.objects.link(cam)
scene.camera=cam
cam.data.type='ORTHO'

def camera(position,target,scale):
    cam.location=Vector(position)*.001
    forward=(Vector(target)*.001-cam.location).normalized()
    right=forward.cross(Vector((0,1,0))).normalized()
    up=right.cross(forward).normalized()
    cam.rotation_euler=Matrix((right,up,-forward)).transposed().to_euler()
    cam.data.ortho_scale=scale*.001
    cam.data.clip_start=.001
    cam.data.clip_end=10

def render(name):
    scene.render.filepath=str(OUT/name)
    bpy.ops.render.render(write_still=True)

camera((-155,145,-230),(0,0,18),215)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lantern_case.blend'))
render('assembled.png')
camera((0,0,-260),(0,0,18),175)
render('front-branding.png')
camera((145,145,230),(0,0,18),215)
render('rear.png')
camera((240,85,-100),(0,0,18),185)
render('sd-access.png')
offsets={'front_shell':(0,0,0),'board_reference':(0,0,18),'glass_reference':(0,0,18),'display_reference':(0,0,18),
         'usb_reference':(0,0,18),'battery_tray':(0,0,44),'battery_reference':(0,0,65),
         'speaker_retainer':(-75,0,0),'speaker_reference':(-40,0,0),'rear_lid':(0,0,105),
         'branding_finish_reference':(0,0,0)}
for name,o in objects.items(): o.location=Vector(offsets[name])*.001
for o in screen_texts: o.location.z+=.018
camera((-310,155,-185),(-15,0,65),320)
scene.render.resolution_x=1800
scene.render.resolution_y=1100
render('exploded.png')
print('Rendered assembled, rear, SD access and exploded previews; saved editable .blend.')
