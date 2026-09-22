"""Offline, rotatable preview of the actual CAD geometry; no external resources."""
import base64, json
from pathlib import Path
import numpy as np
import trimesh

ROOT=Path(__file__).resolve().parent
OUT=ROOT.parents[2]/'output/pcb/Fovea-B0'
manifest=json.loads((OUT/'model-manifest.json').read_text())
parts=[]
for p in manifest['parts']:
    m=trimesh.load_mesh(OUT/p['file'])
    vertices=np.asarray(m.vertices[m.faces],dtype='<f4').reshape(-1,3)
    normals=np.repeat(np.asarray(m.face_normals,dtype='<f4'),3,axis=0)
    raw=np.hstack((vertices,normals)).astype('<f4')
    parts.append({k:p[k] for k in ('name','kind','colour','explode')} | {
        'count':len(vertices),'buffer':base64.b64encode(raw.tobytes()).decode()})
template=(ROOT/'preview-template.html').read_text(encoding='utf-8')
(OUT/'preview.html').write_text(template.replace('/*MODEL_DATA*/',json.dumps(parts,separators=(',',':'))),encoding='utf-8')
print('Wrote offline CAD preview.')
