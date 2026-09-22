"""One STL, four disconnected case parts arranged flat with 6 mm gaps."""
from pathlib import Path
import json
import numpy as np
import trimesh

root=Path(__file__).resolve().parent
placements=[
    ('front_shell.stl',0,0,0),
    ('rear_lid.stl',98,0,0),
    ('battery_tray.stl',0,118,90),
    ('speaker_retainer.stl',103.8,118,0),
]
parts=[]
report=[]
for name,x,y,angle in placements:
    part=trimesh.load_mesh(root/'exports'/name)
    if angle:
        part.apply_transform(trimesh.transformations.rotation_matrix(np.radians(angle),[0,0,1]))
    part.apply_translation(np.array([x,y,0])-part.bounds[0])
    assert part.is_watertight and part.is_winding_consistent and part.volume>0
    assert abs(part.bounds[0,2])<.001
    for other in parts:
        separation=np.maximum(part.bounds[0,:2]-other.bounds[1,:2],
                              other.bounds[0,:2]-part.bounds[1,:2])
        assert separation.max()>=5.99, 'Print parts touch or are too close'
    report.append({'source':name,'bounds_mm':np.round(part.bounds,3).tolist()})
    parts.append(part)

combined=trimesh.util.concatenate(parts)
target=root/'Lantern-ALL-CASE-PARTS-v0.3.stl'
combined.export(target)
checked=trimesh.load_mesh(target)
assert checked.is_watertight and checked.is_winding_consistent
components=checked.split()
assert len(components)==4 and all(c.volume>0 for c in components)
assert abs(checked.volume-sum(p.volume for p in parts))<.1
bounds=np.round(checked.extents,2).tolist()
(root/'COMBINED-STL-PRINT-NOTES.txt').write_text('''LANTERN — ONE FILE / FOUR CASE PARTS

File: Lantern-ALL-CASE-PARTS-v0.3.stl
Contains one each: front case, back cover, internal battery support,
and speaker retaining mount. No electronics or reference models.

The four parts lie separately on the printing plane, with at least 6 mm
between their bounding boxes. They are not fused into an assembled case.
Import in MILLIMETRES at 100% scale. Footprint: 190 x 198.5 mm.
Allow additional printing-bed space for brims, skirts or supports.
Do not scale down to fit: split into separate objects and rearrange or
print in batches instead. The separate-STL package remains available.

These parts will normally print in the same colour in a single job.
Logo and tagline are engraved; white paint is optional after printing.
The printer operator must check supports, bridges and bed fit in the slicer.
This is a digitally checked prototype that still needs a physical fit test.
''',encoding='utf-8')
print(json.dumps({'file':str(target),'disconnected_print_parts':len(components),
                  'overall_dimensions_mm':bounds,'parts':report},indent=2))
