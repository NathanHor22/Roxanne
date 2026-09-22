"""Create the unambiguous handoff for a print shop: four case STLs only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import shutil
import trimesh

root=Path(__file__).resolve().parent
out=root/'print-only'
out.mkdir(exist_ok=True)
parts={
    'front_shell.stl':'01_front_case.stl',
    'rear_lid.stl':'02_back_cover.stl',
    'battery_tray.stl':'03_internal_battery_support.stl',
    'speaker_retainer.stl':'04_speaker_mount.stl',
}
for source,destination in parts.items():
    src=root/'exports'/source
    mesh=trimesh.load_mesh(src)
    assert mesh.is_watertight and mesh.is_winding_consistent and mesh.volume>0
    assert len(mesh.split())==1, f'{source}: unexpected extra objects'
    assert abs(mesh.bounds[0,2])<.001, f'{source}: not resting on print plane'
    shutil.copyfile(src,out/destination)
    print(destination, 'one solid, mm:', [round(float(v),2) for v in mesh.extents])

instructions='''LANTERN / FOVEA — CASE ONLY, v0.3

Print ONE of each of these four STL files:
  01_front_case.stl                 Main shell, engraved logo and tagline
  02_back_cover.stl                 Removable back
  03_internal_battery_support.stl   Plastic support tray, NOT the battery
  04_speaker_mount.stl              Plastic retaining ring, NOT the speaker

These contain only the plastic enclosure parts. No ESP32, screen, speaker,
battery or paint reference models are included.

Units: MILLIMETRES. Scale: 100%. Do not resize to fit a print bed.
Parts are separated and oriented with their lowest point at Z=0.
Finished enclosure: 92 x 112 x 39 mm.

Suggested material: green PETG front; black or green PETG back and mounts.
Suggested starting settings: 0.4 mm nozzle, 0.2 mm layers, four walls,
five top/bottom layers and 20-30% infill. Printer operator must inspect
bridges/support needs at the side speaker supports, ports and mic passage.
Keep SD access, USB, speaker grille and microphone openings clear.
The logo and text are recessed 0.6 mm into the front shell. Any white
lettering is paint applied after printing, not a separate printed object.

This is a prototype checked digitally, not yet physically fitted.
Please confirm a trial fit before a finished print.
Assembly uses four M3 x 8 screws with M3 nuts for the cover and ten
2.5 x 6 plastic-thread screws for the board, tray and speaker mount.
Hardware, electronics and padding are not part of the print order.
'''
(out/'READ_ME_FOR_PRINTER.txt').write_text(instructions,encoding='utf-8')
target=root/'Lantern-CASE-ONLY-STL-v0.3.zip'
names=[*parts.values(),'READ_ME_FOR_PRINTER.txt']
with ZipFile(target,'w',ZIP_DEFLATED,compresslevel=9) as archive:
    for name in names:
        archive.write(out/name,arcname=name)
with ZipFile(target) as archive:
    assert archive.testzip() is None
    assert archive.namelist()==names
print('Verified print-only package:',target)
