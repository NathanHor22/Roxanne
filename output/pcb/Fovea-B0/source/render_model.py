"""Render only in a fresh background Blender process; no live scene touched."""
import bpy, json, math, sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'output/pcb/Fovea-B0'
data=json.loads((OUT/'model-manifest.json').read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.unit_settings.system='METRIC';scene.unit_settings.length_unit='MILLIMETERS'
scene.render.engine='CYCLES';scene.cycles.samples=16
scene.render.resolution_x=1500;scene.render.resolution_y=1300;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.world.use_nodes=True
bg=scene.world.node_tree.nodes.get('Background');bg.inputs['Color'].default_value=(.13,.16,.15,1);bg.inputs['Strength'].default_value=.4
scene.view_settings.view_transform='AgX';scene.view_settings.exposure=-3.5

def mat(name,c,metal=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
    n=m.node_tree.nodes.get('Principled BSDF');n.inputs['Base Color'].default_value=(*c,1);n.inputs['Metallic'].default_value=metal;n.inputs['Roughness'].default_value=.4
    return m
objs={}
for p in data['parts']:
    bpy.ops.wm.stl_import(filepath=str(OUT/p['file']))
    o=bpy.context.object;o.name=p['name'];o.scale=(.001,)*3
    o.data.materials.append(mat(p['name'],p['colour'],.65 if 'shield' in p['name'] or 'socket' in p['name'] or 'MIC_' in p['name'] else .1))
    objs[p['name']]=o
white=mat('Silkscreen',(.85,.94,.87))
def label(name,text,x,y,z,size=2,kind='main',align='CENTER'):
    curve=bpy.data.curves.new(name,'FONT');curve.body=text;curve.size=size*.001;curve.align_x=align;curve.align_y='CENTER'
    o=bpy.data.objects.new(name,curve);scene.collection.objects.link(o);o.location=(x*.001,y*.001,z*.001);o.data.materials.append(white)
    return o,kind
labels=[]
for args in [
 ('brand','FOVEA  /  B0',15,-75,1.75,2.5,'main'),
 ('status','PLACEMENT STUDY',13,-71,1.75,1.5,'main'),
 ('esp','ESP32-S3',-42,-64,4.82,1.5,'main'),
 ('pwr','POWER',46,69,1.75,1.6,'main'),
 ('volup','VOL +',45,-38,1.75,1.7,'main'),
 ('voldown','VOL -',45,-70,1.75,1.7,'main'),
 ('record','REC / STOP',44,-55,1.75,1.7,'main'),
 ('boot','BOOT',-40,-43,1.75,1.3,'main'),
 ('reset','RESET',-30,-43,1.75,1.3,'main'),
 ('array','XVF3800',0,38,11.35,3.1,'audio'),
 ('four','4 MICROPHONES',0,33,11.35,1.6,'audio'),
 ('audio5v','5 V  /  AUDIO',0,3,11.35,1.6,'audio'),
 ('lcd','READY',5,-45,12.4,3.2,'display'),
 ('lcd2','MEETING RECORDER',5,-50,12.4,1.5,'display'),
 ('sd','SD',44,-25,1.75,1.7,'main'),
 ('usb','USB-C',-44,30,1.75,1.5,'main'),
 ('rail3','3.3 V',-19,22,1.75,1.5,'main'),
 ('rail5','5 V',-7,22,1.75,1.5,'main')]: labels.append(label(*args))

bpy.ops.mesh.primitive_plane_add(size=3,location=(0,0,-.02));floor=bpy.context.object;floor.name='Studio floor';floor.data.materials.append(mat('Backdrop',(.12,.17,.15)))
def light(name,location,energy,size):
    d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.shape='DISK';d.size=size
    o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=location;o.rotation_euler=(Vector((0,0,0))-o.location).to_track_quat('-Z','Y').to_euler()
light('Softbox',(.1,-.15,.35),18,.25);light('Fill',(-.2,.06,.19),10,.22);light('Rim',(.15,.2,.20),13,.18)
camdata=bpy.data.cameras.new('Camera');cam=bpy.data.objects.new('Camera',camdata);scene.collection.objects.link(cam);scene.camera=cam;camdata.type='ORTHO'
def camera(loc,target,scale):
    cam.location=loc;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();camdata.ortho_scale=scale
def render(name):
    scene.render.filepath=str(OUT/name);bpy.ops.render.render(write_still=True)
camera((-.24,-.29,.34),(0,0,.005),.215)
render('assembly.png')
if '--assembly-only' in sys.argv:
    sys.exit(0)
camera((0,0,.35),(0,0,0),.192)
render('top.png')
for p in data['parts']:
    if p['kind']=='wire':objs[p['name']].hide_render=True
    else:objs[p['name']].location+=Vector(p['explode'])*.001
offsets={'audio':Vector((0,0,.035)),'display':Vector((0,0,.030)),'main':Vector((0,0,0))}
for o,kind in labels:o.location+=offsets[kind]
floor.location.z=-.066
camera((-.27,-.31,.33),(0,0,.006),.25)
render('exploded.png')
# Save assembled state, so opening the Blender file starts with the complete model.
for p in data['parts']:
    if p['kind']=='wire':objs[p['name']].hide_render=False
    else:objs[p['name']].location-=Vector(p['explode'])*.001
for o,kind in labels:o.location-=offsets[kind]
floor.location.z=-.02
camera((-.24,-.29,.34),(0,0,.005),.215)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'Fovea-B0-assembly.blend'))
print('Rendered assembled, top and exploded views; saved Blender assembly.')
