"""Build real CAD solids for the B0 placement study. Dimensions are millimetres.

Component bodies are clearance envelopes, not vendor-qualified footprints.
Run with .tools/lantern-cad-env/Scripts/python.exe.
"""
from pathlib import Path
import json, math
import cadquery as cq
import trimesh

ROOT=Path(__file__).resolve().parent
OUT=ROOT.parents[2]/'output/pcb/Fovea-B0'
MESH=OUT/'model-parts'
MESH.mkdir(parents=True,exist_ok=True)
objects=[]
assembly=cq.Assembly(name='Fovea_B0_UNROUTED_PLACEMENT_STUDY')
GREEN=(.045,.30,.18); DARK=(.035,.045,.045); METAL=(.55,.59,.61)
GOLD=(.82,.61,.20); WHITE=(.83,.89,.84); BLUE=(.035,.12,.18)

def box(w,h,d,x=0,y=0,z=0,r=0):
    a=cq.Workplane('XY').box(w,h,d,centered=(True,True,False))
    if r:a=a.edges('|Z').fillet(r)
    return a.translate((x,y,z))

def cyl(r,d,x,y,z):return cq.Workplane('XY').circle(r).extrude(d).translate((x,y,z))

def add(name,shape,colour,kind='main',explode=(0,0,0),note='Nominal clearance envelope'):
    assert shape.val().isValid(), name
    path=MESH/(name+'.stl')
    cq.exporters.export(shape,str(path),tolerance=.13,angularTolerance=.2)
    assembly.add(shape,name=name,color=cq.Color(*colour))
    mesh=trimesh.load_mesh(path)
    assert mesh.is_watertight, name
    objects.append(dict(name=name,file='model-parts/'+name+'.stl',colour=colour,kind=kind,explode=explode,
                        bounds=mesh.bounds.tolist(),volume_mm3=shape.val().Volume(),note=note))
    return shape

W,H,T=110,158,1.6
mounts=[(-49,73),(49,73),(-49,-47),(49,-73)]
board=box(W,H,T,r=4)
for x,y in mounts:board=board.cut(cyl(1.4,3,x,y,-.5))
add('main_pcb_110x158',board,GREEN,note='Proposed 4-layer outline; no copper routing or footprint pads released')
for i,(x,y) in enumerate(mounts):
    ring=cyl(2.9,.05,x,y,1.6).cut(cyl(1.4,.2,x,y,1.55))
    add('mount_ring_'+str(i+1),ring,GOLD)

# Four-mic assembly: envelope from Seeed 2D drawing. Sensor centres 66 mm square.
array=cyl(50,1.2,0,25,10)
add('audio_array_100mm',array,DARK,'audio',(0,0,35),
    'Seeed drawing diameter 100, PCB 1.2, 66 mm mic spacing. Holes/components simplified; no XIAO fitted.')
for i,(x,y) in enumerate([(-33,-33),(33,-33),(33,33),(-33,33)]):
    head=box(4.8,4.8,1.2,x,y+25,11.2,r=.5)
    head=head.cut(cyl(.45,2,x,y+25,10.9))
    add('MIC_'+str(i+1),head,METAL,'audio',(0,0,35),'Microphone position from 66 x 66 array geometry; body illustrative')
    add('mic_port_'+str(i+1),cyl(.4,.05,x,y+25,11.2),DARK,'audio',(0,0,35))
add('XVF3800_processor',box(7,7,1,0,25,11.2),DARK,'audio',(0,0,35))
add('audio_codec',box(5,5,.9,16,16,11.2),DARK,'audio',(0,0,35))
add('audio_amp',box(4,4,1,24,5,11.2),DARK,'audio',(0,0,35))
add('array_service_usb',box(9,7,3.2,0,-22.5,11.2,r=.7),METAL,'audio',(0,0,35),'Service USB; not connected simultaneously with powered carrier until backfeed checked')
add('array_speaker_socket',box(8,6,5,13,-20,11.2),WHITE,'audio',(0,0,35),'Mating connector revision to verify')
add('array_logic_socket',box(20,5,3,0,67,11.2),WHITE,'audio',(0,0,35),'Illustrative position; module-side connector drawing is unresolved')
for k in range(12):
    ang=2*math.pi*k/12
    add('array_led_'+str(k+1),box(2,2,.6,40*math.cos(ang),25+40*math.sin(ang),11.2),WHITE,'audio',(0,0,35),'RGB LEDs disabled in the power budget')
# Temporary support envelopes are visible and explicitly not drill coordinates.
for i,(x,y) in enumerate([(-21.355,49.5),(21.355,49.5),(-21.355,.5),(21.355,.5)]):
    add('array_support_'+str(i+1),cyl(2.5,8.4,x,y,1.6),DARK,'support',(0,0,17),'Support envelope only; diameter and screw positions require module verification')

# The display is a replaceable SPI module, not bare LCD glass.
add('display_carrier',box(42,42,1.2,5,-49,8,r=1.2),BLUE,'display',(0,0,30),'Provisional envelope for 1.3-inch SPI module; exact SKU/drawing pending')
add('display_bezel',box(32,34,2.7,5,-48,9.2,r=.7),DARK,'display',(0,0,30))
add('display_glass',box(26,26,.4,5,-47,11.9,r=.3),(.02,.15,.10),'display',(0,0,30))
for k,(x,y) in enumerate([(-12,-66),(22,-66),(-12,-32),(22,-32)]):
    add('display_support_'+str(k+1),cyl(2,6.4,x,y,1.6),DARK,'support',(0,0,15),'Provisional screen support; final mount pattern pending')

add('ESP32_module',box(18,25.5,.8,-42,-69,1.6),DARK,note='Nominal Espressif module body; antenna faces bottom edge')
add('ESP32_shield',box(17,17,2.3,-42,-65,2.4,r=.3),METAL)
for k in range(5):
    add('antenna_mark_'+str(k),box(10,.5,.05,-42,-76-k,2.4),GOLD,note='Visual antenna indication, not an RF trace design')

# Main board power components positioned outside the microphone aperture regions.
chips=[('U1_charger',-30,11,3,3),('U2_USB_CC',-43,13,1.6,1.6),('U3_inverter',-40,22,2.9,2.9),
       ('U4_OR_gate',-34,22,2.9,2.9),('U12_suspend_inverter',-27,22,2.9,2.9),('Q1_suspend_level_shift',-27,16,2.9,1.3),('U5_power_controller',38,60,2.9,3),('U6_load_switch',34,48,2,2),
       ('U7_3V3',-19,11,2.5,3),('U8_5V',-7,11,2.5,3),('U10_USB_isolator',-38,-24,2,2),('U11_gauge',35,8,2,2)]
for name,x,y,w,h in chips:add(name,box(w,h,1,x,y,1.6),DARK)
for name,x in [('L1_3V3',-19),('L2_5V',-7)]:add(name,box(4,4,2.1,x,17,1.6,r=.3),(.16,.18,.18))
# These passive body rows are placement reservations tied to circuit areas.
for area,x0,y0,n in [('charge',-42,4,10),('regulators',-23,2,18),('controller',29,40,9)]:
    for i in range(n):
        x=x0+(i%5)*3.4; y=y0-(i//5)*3.1
        add(area+'_passive_'+str(i+1),box(1.6,.8,.65,x,y,1.6),(.53,.43,.28),note='Passive placement reservation; not a final part-to-pad layout')

# USB at left edge; SD at right. Their withdrawal paths stay outside the stack.
usb=box(7.5,9,3.2,-53,30,1.6,r=.7)
usb=usb.cut(box(8,6.7,1.4,-56,30,2.4,r=.35))
add('USB_C_charge_program',usb,METAL,note='Receptacle envelope; cable enters from left')
sd=box(15,15,1.9,49,-13,1.6,r=.4)
sd=sd.cut(box(7,12,1.1,55,-13,1.75))
add('microSD_socket',sd,METAL,note='Provisional socket; card slides right')
add('microSD_card',box(15,11,1,54,-13,1.85,r=.4),DARK,'sd',(22,0,0),'Card withdrawal envelope; confirm push-push travel')

def button(name,x,y,colour=WHITE,small=False):
    size=4 if small else 6
    add(name+'_body',box(size,size,2.2,x,y,1.6),(.37,.39,.37),'button')
    add(name+'_cap',cyl(1.4 if small else 2.6,1.7,x,y,3.8),colour,'button')

button('POWER',48,61,(.1,.7,.38))
button('RECORD_STOP',45,-48,(.85,.3,.20))
button('VOLUME_UP',45,-32)
button('VOLUME_DOWN',45,-64)
button('BOOT',-40,-38,WHITE,True)
button('RESET',-30,-38,WHITE,True)

for name,w,h,d,x,y,col in [('battery_socket',12,8,7,40,20,WHITE),('audio_harness_socket',17,6,5,20,59,WHITE),('speaker_in_socket',7,6,4,-47,-3,WHITE),('speaker_out_socket',7,6,4,-48,-15,WHITE),('display_socket',22,5,4,9,-24,WHITE)]:
    add(name,box(w,h,d,x,y,1.6,r=.4),col,note='Connector housing envelope; verify exact selected connector and mating space')

# Measured battery envelope, separated from solder joints; no clamp on the pouch.
add('battery_insulation',box(62,94,.8,14,-1,-4.8,r=2),(.13,.2,.17),'battery',(0,0,-20),'Insulating support envelope, retention/case not designed here')
add('battery_91x59x5',box(59,91,5,14,-1,-10.8,r=2),(.72,.56,.16),'battery',(0,0,-40),'User measured; 4Ah is an assumption for runtime, ratings unverified')
add('battery_label',box(54,79,.05,14,-1,-10.85,r=.3),(.73,.76,.73),'battery',(0,0,-40))

# Side-facing speaker. Face plane YZ, 41 mm along Y and 29 mm along Z.
speaker=box(29,41,10,r=12).rotate((0,0,0),(0,1,0),-90).translate((-59,-7,7))
add('side_speaker_41x29x10',speaker,DARK,'speaker',(-22,0,0),'Measured bounding envelope; 4 ohm/2W requirement is not verified for existing speaker')
face=box(23,35,.6,r=10).rotate((0,0,0),(0,1,0),-90).translate((-69,-7,7))
add('speaker_cone',face,(.06,.065,.067),'speaker',(-22,0,0))

def wire(name,pts,r,colour,kind='wire',explode=(0,0,0)):
    # Segmented leads describe routing space, not exact bend radii or cable assembly.
    shapes=[]
    for a,b in zip(pts,pts[1:]):
        v=cq.Vector(*b)-cq.Vector(*a)
        shapes.append(cq.Solid.makeCylinder(r,v.Length,cq.Vector(*a),v.normalized()))
    for i,s in enumerate(shapes):add(name+'_'+str(i),cq.Workplane(obj=s),colour,kind,explode,'Illustrative wire route; verify cable lengths and strain relief')
wire('battery_red',[(37,39,-6),(47,40,-5),(49,34,5),(40,23,6)],.65,(.65,.06,.04))
wire('battery_black',[(36,39,-6),(46,40,-5),(48,34,5),(38,23,6)],.65,DARK)
wire('speaker_lead', [(-49,-15,5),(-56,-15,5),(-60,-18,8)],.75,(.66,.10,.07))

cq.exporters.export(board,str(OUT/'main-board-outline.stl'))
assembly.export(str(OUT/'Fovea-B0-assembly.step'))
manifest=dict(status='UNROUTED placement study - NOT fabrication or print assembly',units='mm',
 board=dict(width=W,length=H,thickness=T,mount_holes=mounts,hole_diameter=2.8),
 array=dict(diameter=100,mic_spacing=66,pcb_thickness=1.2),
 parts=objects)
(OUT/'model-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
scene=trimesh.Scene()
for p in objects:
    m=trimesh.load_mesh(OUT/p['file']);m.apply_scale(.001)
    m.visual.vertex_colors=[round(c*255) for c in p['colour']]+[255]
    scene.add_geometry(m,node_name=p['name'],geom_name=p['name'])
scene.export(str(OUT/'Fovea-B0-assembly.glb'))
validation=dict(valid_solids=len(objects),watertight_meshes=len(objects),
 limits=['Component packages/enclosures are simplified envelopes.','No routed copper, footprint validation, case fit or acoustic test.', 'Array support locations and connector mates are provisional.'])
(OUT/'model-validation.json').write_text(json.dumps(validation,indent=2),encoding='utf-8')
print(f'Exported STEP, GLB, outline STL and {len(objects)} validated solid envelopes.')
