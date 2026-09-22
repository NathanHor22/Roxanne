"""Dimensioned Lantern enclosure. Run in the isolated CAD environment.

All dimensions and STL coordinates are millimetres. Assembly origin is at the
centre of the front face; +Y is the microphone end, +Z points toward the rear.
STLs are repositioned for printing. STEP and preview retain assembly positions.
"""
from pathlib import Path
import json
import math
import cadquery as cq
import trimesh

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'exports'
OUT.mkdir(exist_ok=True)
P = json.loads((ROOT / 'dimensions.json').read_text(encoding='utf-8'))
C, B, A, S, M = (P[k] for k in ('case', 'board', 'battery', 'speaker', 'future_mic'))
W, H, D, T, R = (C[k] for k in ('width', 'length', 'depth', 'wall', 'corner_radius'))
SEAM = D - T
EPS = .05
BX, AX = B['center_x'], A['center_x']
SD = P['sd_access']
SPEAKER_WALL_X = -W/2+T

def box(w, h, d, x=0, y=0, z=0):
    return cq.Workplane('XY').box(w, h, d, centered=(True, True, False)).translate((x,y,z))

def rounded(w, h, d, r, x=0, y=0, z=0):
    return box(w,h,d).edges('|Z').fillet(r).translate((x,y,z))

def cyl(radius, depth, x=0, y=0, z=0):
    return cq.Workplane('XY').circle(radius).extrude(depth).translate((x,y,z))

def cut_all(part, cutters):
    # Subtract overlapping tools sequentially; an unfused compound can leave
    # spurious material at the overlap between a screw bore and nut pocket.
    for cutter in cutters:
        part=part.cut(cutter)
    return part

def hexhole(af, depth, x, y, z):
    return cq.Workplane('XY').polygon(6,af/math.cos(math.pi/6)).extrude(depth).translate((x,y,z))

def along_y_cyl(radius, length, x, y, z):
    return cyl(radius,length).rotate((0,0,0),(1,0,0),90).translate((x,y,z))

def side_speaker(obj):
    # Local XY is the speaker face; local +Z points inward from the side wall.
    return obj.rotate((0,0,0),(1,1,1),120).translate((SPEAKER_WALL_X,S['center_y'],S['center_z']))

case_screws = [(sx*(W/2-6.5),sy*(H/2-7)) for sx in (-1,1) for sy in (-1,1)]
tray_screws = [(x,sy*34) for x in (AX-35.5,39) for sy in (-1,1)]
board_screws = [(BX+sx*B['mount_pitch_x']/2,sy*B['mount_pitch_y']/2) for sx in (-1,1) for sy in (-1,1)]

# Front shell: a printable open-backed cup, screen bezel, board supports,
# protected upper microphone passage and four independent case fasteners.
body = rounded(W,H,SEAM,R)
body = body.cut(rounded(W-2*T,H-2*T,SEAM,R-T,z=T))
body = body.cut(rounded(48.4,67.6,T+2,.8,x=BX,y=B['glass_center_y'],z=-1))
for x,y in board_screws:
    body = body.union(cyl(3.2,B['pcb_front_z']-T+.1,x,y,T-.1))
for x,y in tray_screws:
    body = body.union(cyl(3.8,A['tray_z']-T+.1,x,y,T-.1))
for x,y in case_screws:
    body = body.union(cyl(5,SEAM-T+.1,x,y,T-.1))

# A short passage admits sound at the upper FRONT and at the TOP edge.
# A thin optional foam ring seals against the PCB without entering its sound hole.
duct_top = B['pcb_front_z']-.5
body = body.union(box(8,H/2-B['mic_y']+4,duct_top-T,
                          BX+B['mic_x'],(H/2+B['mic_y']-4)/2,T))
body = body.cut(cyl(2.5,B['pcb_front_z']+1,BX+B['mic_x'],B['mic_y'],-.1))
body = body.cut(box(4,H/2-B['mic_y']+2,2.4,BX+B['mic_x'],(H/2+B['mic_y'])/2,3.3))

collar_w,collar_h = S['width']+2*S['side_clearance'],S['length']+2*S['side_clearance']
collar = rounded(collar_w+3.2,collar_h+3.2,3.1,7,z=-.1)
collar = collar.cut(rounded(collar_w,collar_h,3.5,5.4,z=-.3))
body = body.union(side_speaker(collar))
retainer_z = S['gasket_thickness']+S['thickness']
for u in (-26,26):
    body=body.union(side_speaker(cyl(3.4,retainer_z+.1,u,0,-.1)))

cuts=[]
for x,y in board_screws:
    cuts.append(cyl(1.05,4.0,x,y,B['pcb_front_z']-3.8))
for x,y in tray_screws:
    cuts.append(cyl(1.05,5.5,x,y,A['tray_z']-5.3))
for x,y in case_screws:
    cuts += [hexhole(5.8,2.9,x,y,SEAM-2.8), cyl(1.7,8,x,y,SEAM-7.8)]
# USB-C is recessed because the battery is longer than the PCB. An unobstructed
# tunnel accommodates a plug hood; BOOT/RESET remain accessible with the back off.
cuts.append(box(18,H/2-B['length']/2+2,10,BX,-(H/2+B['length']/2)/2,7.8))
# SD slot is on +X (left when viewing the screen), 35.03 mm below the PCB top.
# A broad finger opening provides access across the 11 mm case recess.
board_edge=BX+B['width']/2
cuts.append(box(W/2-board_edge+2,SD['opening_length'],SD['opening_height'],
                (W/2+board_edge)/2,SD['center_y'],SD['opening_z']))
for u in (-26,26):
    cuts.append(side_speaker(cyl(1.05,6,u,0,retainer_z-5.8)))
for v in (-9,-6,-3,0,3,6,9):
    length=24 if abs(v)==9 else 32
    cuts.append(side_speaker(rounded(length,1.4,T+1.5,.65,y=v,z=-T-1)))
# Future top-edge microphone bay. Grille only; no unsupported claim of mic fit.
for dz in (-4,0,4):
    cuts.append(box(12,T+2,1.6,M['center_x'],H/2-T/2,M['center_z']+dz))
body = cut_all(body,cuts).clean()

# Front branding is a real 0.6 mm recess in the shell, not a rendering decal.
# Convert the original alpha silhouette into closed sketch wires. Local artwork
# reads from +Z; rotating about Y makes it read correctly on the front (-Z).
branding=P['branding']
outline=json.loads((ROOT/'branding/logo-outline.json').read_text(encoding='utf-8'))
scale=branding['logo_width']/outline['width_pixels']
logo_cutters=[]
for path in outline['paths']:
    assert path['area_pixels']>0, 'Logo holes require nested-wire handling'
    pts=[((x-outline['width_pixels']/2)*scale,(outline['height_pixels']/2-y)*scale)
         for x,y in path['points']]
    mark=cq.Workplane('XY').polyline(pts).close().extrude(branding['depth']+.05)
    assert mark.val().isValid(), 'Invalid logo contour'
    logo_cutters.append(mark.rotate((0,0,0),(0,1,0),180).translate(
        (branding['center_x'],branding['logo_center_y'],branding['depth'])))
tagline=cq.Workplane('XY').text(branding['tagline'],branding['font_size'],branding['depth']+.05,
    font='Arial',kind='bold',halign='center',valign='center',combine=False)
tagline=tagline.rotate((0,0,0),(0,1,0),180).translate(
    (branding['center_x'],branding['tagline_center_y'],branding['depth']))
brand_cutters=logo_cutters+[tagline]
brand_compound=cq.Compound.makeCompound([o.val() for o in brand_cutters])
brand_box=brand_compound.BoundingBox()
assert brand_box.ymax<B['glass_center_y']-67.6/2-1, 'Branding too close to screen'
assert brand_box.ymin>-H/2+2, 'Branding too close to case edge'
assert brand_box.xmin>-W/2+5 and brand_box.xmax<W/2-5
body=cut_all(body,brand_cutters).clean()
# White paint is optional finishing, shown only in the review assembly. This
# reference fills the actual engraved recesses and is never a separate print.
paint=cq.Workplane('XY').newObject([brand_compound]).intersect(box(W,H,branding['depth']-.05,z=.05))

# Flat rear lid with loose locating skirt and a reserved 50 x 60 mm logo area.
# Nuts drop into shell
# pockets and are retained by the assembled lid: repeated opening needs no
# threaded plastic or heat-set inserts for the case itself.
lid = rounded(W,H,T,R,z=SEAM)
lip_w,lip_h = W-2*T-2*C['lid_clearance'], H-2*T-2*C['lid_clearance']
lip_r = R-T-C['lid_clearance']
lip = rounded(lip_w,lip_h,1.8,lip_r,z=SEAM-1.8)
lip = lip.cut(rounded(lip_w-2.4,lip_h-2.4,2.2,lip_r-1.2,z=SEAM-2))
lip = cut_all(lip,[cyl(5.5,3,x,y,SEAM-2) for x,y in case_screws])
lip = lip.cut(side_speaker(box(collar_w+3.6,collar_h+3.6,3.8,z=-.3)))
lid = lid.union(lip)
cuts=[cyl(1.7,T+1,x,y,SEAM-.2) for x,y in case_screws]
lid=cut_all(lid,cuts).clean()

# A removable solid tray keeps the soft battery pouch off solder joints.
# Side guides and broad hook-and-loop straps retain the cell without squeezing.
tray_w = A['width']+2*A['side_clearance']+3.2
tray_h = A['length']+2*A['end_clearance']+2
tray = rounded(tray_w,tray_h,A['tray_thickness'],3,x=AX,z=A['tray_z'])
for x,y in tray_screws:
    tray=tray.union(cyl(4,A['tray_thickness'],x,y,A['tray_z']))
    if x>AX:
        tray=tray.union(box(7,8,A['tray_thickness'],x-3,y,A['tray_z']))
guide_z=A['tray_z']+A['tray_thickness']
for sx in (-1,1):
    for sy in (-1,1):
        tray=tray.union(box(1.6,18,6.8,AX+sx*(A['width']/2+A['side_clearance']+.8),sy*26,guide_z))
# End stops are deliberately short, leaving routes for the battery lead.
for sy in (-1,1):
    tray=tray.union(box(14,1.4,2.5,AX,sy*(A['length']/2+A['end_clearance']+.7),guide_z))
tray=cut_all(tray,[cyl(1.4,3,x,y,A['tray_z']-.2) for x,y in tray_screws]).clean()
# Open-ended cable notches: wires can be laid in with their plugs still attached.
# These stop beyond the measured pouch footprint; no holes beneath the cell.
wire_reserves={}
for name,x in [('speaker',AX-20),('battery',AX+20)]:
    notch=rounded(10,5,7,.8,x=x,y=-48.5,z=A['tray_z']-.2)
    tray=tray.cut(notch)
    wire_reserves[name]=box(8,4,5,x,-48.5,A['tray_z'])
future_reserve=box(M['bay_width'],M['bay_depth'],M['bay_height'],M['center_x'],M['center_y'],M['center_z']-M['bay_height']/2)
# Relieve the tray's spare end margin so it genuinely clears the future mic
# volume; the measured battery footprint remains fully supported below it.
tray=tray.cut(box(M['bay_width']+.4,M['bay_depth']+.4,M['bay_height']+.4,
    M['center_x'],M['center_y'],M['center_z']-M['bay_height']/2-.2)).clean()

# The side speaker retaining ring is removable independently of the lid. Place a
# small soft pad on its rim if required; do not press on the speaker diaphragm.
retainer=rounded(collar_w+3.2,collar_h+3.4,1.6,7,z=retainer_z)
retainer=retainer.cut(rounded(30,18,2,5,z=retainer_z-.2))
for x in (-26,26):
    retainer=retainer.union(cyl(3.4,1.6,x,0,retainer_z))
retainer=cut_all(retainer,[cyl(1.4,2,x,0,retainer_z-.2) for x in (-26,26)]).clean()
retainer=side_speaker(retainer)

parts={'front_shell':body,'rear_lid':lid,'battery_tray':tray,'speaker_retainer':retainer}
# Simplified dimensioned reference solids, never included in print STLs.
pcb=rounded(B['width'],B['length'],B['pcb_thickness'],3.5,x=BX,z=B['pcb_front_z'])
pcb=cut_all(pcb,[cyl(1.6,2,x,y,B['pcb_front_z']-.1) for x,y in board_screws])
glass=box(B['glass_width'],B['glass_length'],B['pcb_front_z']-B['glass_front_z'],x=BX,y=B['glass_center_y'],z=B['glass_front_z'])
screen=box(43.2,57.6,.08,x=BX,y=3.08,z=B['glass_front_z']-.08)
battery_z=guide_z+A['foam_thickness']
battery=rounded(A['width'],A['length'],A['thickness'],2,x=AX,z=battery_z)
speaker=side_speaker(rounded(S['width'],S['length'],S['thickness'],S['length']/2-.1,z=S['gasket_thickness']))
usb=box(9,7.5,3.4,BX,-40.75,8.6)
refs={'board_reference':pcb,'glass_reference':glass,'display_reference':screen,'battery_reference':battery,'speaker_reference':speaker,'usb_reference':usb}
refs['branding_finish_reference']=paint

report={'revision':P['revision'],'units':'mm','parts':{},'clearances_mm':{
 'glass_to_bezel':B['glass_front_z']-T,
 'board_components_to_battery_tray':A['tray_z']-(B['pcb_front_z']+B['pcb_thickness']+B['rear_component_height']),
 'tray_to_speaker_retainer':(AX-tray_w/2)-(SPEAKER_WALL_X+retainer_z+1.6),
 'sd_slot_recess':W/2-board_edge,
 'lid_skirt_per_side':C['lid_clearance']},'overlaps_mm3':{},'notes':P['status']}
report['branding']={'process':'engraved into front shell','depth_mm':branding['depth'],
 'remaining_front_wall_mm':T-branding['depth'],'tagline':branding['tagline'],
 'paint':'Optional white paint, shown as a reference only'}
assembly=cq.Assembly(name='Lantern_service_case_v03')
colours={'front_shell':(.035,.26,.13),'rear_lid':(.06,.09,.08),'battery_tray':(.16,.33,.27),'speaker_retainer':(.13,.20,.18)}
preview=[]
for name,obj in parts.items():
    shape=obj.val()
    assert shape.isValid(),f'{name}: invalid CAD solid'
    if len(obj.solids().vals()) != 1:
        for solid in obj.solids().vals():
            b=solid.BoundingBox()
            print('DISCONNECTED',name,solid.Volume(),(b.xmin,b.ymin,b.zmin,b.xmax,b.ymax,b.zmax),flush=True)
        raise AssertionError(f'{name}: disconnected solids')
    bb=shape.BoundingBox()
    oriented=obj
    if name=='rear_lid':
        oriented=obj.rotate((0,0,0),(1,0,0),180)
    elif name=='speaker_retainer':
        oriented=obj.rotate((0,0,0),(1,1,1),-120)
    zmin=oriented.val().BoundingBox().zmin
    oriented=oriented.translate((0,0,-zmin))
    path=OUT/f'{name}.stl'
    cq.exporters.export(oriented,str(path),tolerance=.05,angularTolerance=.1)
    mesh=trimesh.load_mesh(path)
    assert mesh.is_watertight and mesh.is_winding_consistent and mesh.volume>0,f'{name}: invalid mesh'
    report['parts'][name]={'bounds_mm':[round(bb.xlen,3),round(bb.ylen,3),round(bb.zlen,3)],'volume_cm3':round(shape.Volume()/1000,3),'triangles':len(mesh.faces),'watertight':bool(mesh.is_watertight),'solid_count':len(obj.solids().vals())}
    cq.exporters.export(obj,str(OUT/f'{name}_assembly.stl'),tolerance=.08,angularTolerance=.15)
    assembly.add(obj,name=name,color=cq.Color(*colours[name]))
    preview.append({'name':name,'file':f'{name}_assembly.stl','color':colours[name],'kind':'case'})
for name,obj in refs.items():
    cq.exporters.export(obj,str(OUT/f'{name}.stl'),tolerance=.1,angularTolerance=.2)
    preview.append({'name':name,'file':f'{name}.stl','kind':'reference'})
assembly.export(str(OUT/'lantern_case.step'))
fit_check=body.intersect(box(W+2,H+2,20))
cq.exporters.export(fit_check,str(OUT/'print_first_front_fit_check.stl'),tolerance=.05,angularTolerance=.1)
fit_mesh=trimesh.load_mesh(OUT/'print_first_front_fit_check.stl')
assert fit_mesh.is_watertight and fit_mesh.is_winding_consistent and len(fit_check.solids().vals())==1
for i,(an,a) in enumerate(parts.items()):
    for bn,b in list(parts.items())[i+1:]:
        vol=a.val().intersect(b.val()).Volume()
        report['overlaps_mm3'][f'{an} / {bn}']=round(vol,5)
        assert vol<.01,f'Parts overlap: {an}, {bn}: {vol}'
for an,a in parts.items():
    for bn,b in refs.items():
        vol=a.val().intersect(b.val()).Volume()
        report['overlaps_mm3'][f'{an} / {bn}']=round(vol,5)
        assert vol<.01,f'Reference collision: {an}, {bn}: {vol}'
assert min(report['clearances_mm'].values())>.1
for name,obj in parts.items():
    volume=obj.val().intersect(future_reserve.val()).Volume()
    report['overlaps_mm3'][f'{name} / future_mic_reserved_volume']=round(volume,5)
    assert volume<.01,f'Future mic bay obstructed by {name}: {volume}'
sd_travel=box(W/2+20-board_edge,16,3,(W/2+20+board_edge)/2,
    SD['center_y'],SD['card_plane_z']-1.5)
for path_name,path in {'sd_card_withdrawal':sd_travel,**wire_reserves}.items():
    for name,obj in parts.items():
        volume=obj.val().intersect(path.val()).Volume()
        report['overlaps_mm3'][f'{name} / {path_name}']=round(volume,5)
        assert volume<.01,f'Access route obstructed: {path_name} by {name}: {volume}'
(OUT/'validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
(OUT/'preview-manifest.json').write_text(json.dumps({'parameters':P,'parts':preview},indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
