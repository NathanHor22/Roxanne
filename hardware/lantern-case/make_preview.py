"""Self-contained WebGL viewer of the actual STL geometry; no remote resources."""
import base64
import json
from pathlib import Path
import numpy as np
import trimesh

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'exports'
manifest=json.loads((OUT/'preview-manifest.json').read_text())
colours={'front_shell':[.07,.43,.24],'rear_lid':[.10,.15,.13],
 'battery_tray':[.19,.48,.35],'speaker_retainer':[.16,.23,.20],
 'board_reference':[.10,.12,.12],'glass_reference':[.07,.10,.11],
 'display_reference':[.07,.52,.30],'battery_reference':[.85,.64,.16],
 'speaker_reference':[.14,.16,.15],'usb_reference':[.65,.68,.67],
 'branding_finish_reference':[.91,.95,.91]}
offsets={'front_shell':[0,0,0],'board_reference':[0,0,18],'glass_reference':[0,0,18],'display_reference':[0,0,18],
 'usb_reference':[0,0,18],'battery_tray':[0,0,44],'battery_reference':[0,0,65],
 'speaker_retainer':[-75,0,0],'speaker_reference':[-40,0,0],'rear_lid':[0,0,105],
 'branding_finish_reference':[0,0,0]}
data=[]
for p in manifest['parts']:
 m=trimesh.load_mesh(OUT/p['file'])
 vertices=np.asarray(m.vertices[m.faces],dtype='<f4').reshape(-1,3)
 normals=np.repeat(np.asarray(m.face_normals,dtype='<f4'),3,axis=0)
 buf=np.hstack((vertices,normals)).astype('<f4')
 data.append({'name':p['name'],'kind':p['kind'],'colour':colours[p['name']],
              'explode':offsets[p['name']],'count':len(vertices),
              'buffer':base64.b64encode(buf.tobytes()).decode()})
template=(ROOT/'preview-template.html').read_text(encoding='utf-8')
(OUT/'preview.html').write_text(template.replace('/*MODEL_DATA*/',json.dumps(data,separators=(',',':'))),encoding='utf-8')
print('Created self-contained 3D preview.')
