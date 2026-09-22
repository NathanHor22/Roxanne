# Lantern service case — prototype v0.3

An editable, dimensioned enclosure for the **LCDWiki ES3C28P touchscreen Lantern**, with the existing microphone exposed at the upper front and through a short top-edge passage. A separate top-edge grille and internal space are reserved for a future external microphone. The oval black component is the speaker; it mounts against the right side when looking at the screen. The opposite side has an SD-card access opening. The supplied Fovea mark and “Your business development partner” are engraved on the lower front. The back stays flat.

**Status: CAD prototype, not yet physically printed or acoustically tested.** Battery and speaker dimensions came from the user's ruler measurements on 20 September 2026. Connector housings, speaker rim/diaphragm shape, battery wire exit, mic alignment and printer tolerances still require a fit check. Do not order an expensive finished print without the fit check.

## Files and what they mean

- `exports/print_first_front_fit_check.stl`: 20 mm-deep test piece. Check the board holes, screen, microphone, USB and SD-card access before the full case. This is a disposable fit gauge, not a fifth part of the finished enclosure.
- `exports/front_shell.stl`: green front frame and walls, open at the back.
- `exports/rear_lid.stl`: flat removable back with locating lip.
- `exports/battery_tray.stl`: removable separator and battery guides.
- `exports/speaker_retainer.stl`: ring securing the speaker against the side wall.
- `exports/lantern_case.step`: editable solid CAD assembly for Fusion, FreeCAD, Onshape and similar tools.
- `exports/lantern_case.blend`: visual assembly, editable in Blender. Reference battery/screen/speaker objects are illustrative and must not be printed.
- `exports/assembled.png`, `front-branding.png`, `rear.png`, `sd-access.png`, `exploded.png`: renders of the actual generated geometry, with simplified electronics.
- `exports/preview.html`: self-contained rotatable 3D preview. Open this file in a browser; it works without an internet connection.
- `dimensions.json`: the measurements used by the model; all values are millimetres.
- `exports/validation.json`: solid, mesh and interference checks, including their limits.

**STL** is the shape file a print shop imports. **STEP** is the editable engineering model. The shop's **slicer** converts the STL into instructions for its printer. No Blender connection is needed to print these files. They are geometry, not printer-ready G-code.

Files ending `_assembly.stl` and `_reference.stl` support the preview only; do not add those to a print order. The four named print STLs are individually oriented with their lowest point at Z=0. STL does not embed units: import at **100% scale in millimetres**.

## Dimensions

| Item | Width × length × depth, mm | Basis |
|---|---|---|
| Finished enclosure | 92 × 112 × 39 | Prototype design with wiring/service space |
| ESP32 display PCB | 50 × 86 × 1.6 | Manufacturer drawing |
| Whole display/board stack | 50 × 86 × 10.6 | Manufacturer drawing |
| PCB mounting pattern | 42 × 78, four Ø3.2 holes | Manufacturer drawing |
| Battery | 59 × 91 × 5 | User ruler measurement; verify wire exit and pouch edges |
| Speaker envelope | 41 × 29 × 10 | User ruler measurement; verify rim and diaphragm clearance |
| Future mic space | 23 × 20 × 6 | Checked reserved volume, not a verified mount for a specific mic |
| Main walls / back plate | 2.4 | Design choice |
| Lid locating clearance | 0.35 per side | Starting value; tune after test print |

This is a serviceable prototype. The speaker sits on edge beside the battery, and stays attached to the shell when the back is removed. The screen is offset toward the SD opening to improve access. The 29 mm speaker dimension lies across the depth of the enclosure, which remains 39 mm overall.

## Front branding

The Fovea logo is traced from the alpha silhouette of the user-supplied `branding/fovea-logo.webp`. It is 28 mm wide and recessed 0.6 mm into the front face. The complete tagline below it reads **Your business development partner**. The front wall remains at least 1.8 mm thick beneath the engraving. Logo and text are part of the shell STL and STEP geometry, not a sticker or a rendering-only decal.

The white finish in the preview represents optional white paint rubbed into the recesses after printing. A normal single-colour print produces green engraved details; it does not print white automatically. The paint reference is not an additional printed part. Fine tapered tips may soften with an FDM printer; use the fit-check piece to check the lettering and logo as well as fit. A smooth build plate is preferable for this face.

`branding/logo-outline.svg` and `logo-outline.json` preserve the traced artwork. Rebuilding the text uses the Arial Bold font installed on this workstation; the supplied STL/STEP files already contain the final letter geometry.

## Fasteners and soft parts

- Four **M3 × 8 mm machine screws** and four ordinary M3 hex nuts, approximately 5.5 mm across flats and 2.4 mm thick, to close the case. The modeled nut pockets are 5.8 mm across flats. Check screw head diameter is no larger than about 6 mm.
- Ten **2.5 × 6 mm plastic-thread/self-tapping screws**: four for the PCB, four for the battery tray and two for the speaker retainer. The model uses 2.1 mm pilot holes; verify the chosen screw and printed pilot on scrap first. Do not force a screw that splits a post.
- Four approximately **1 mm thick insulating washers** under the PCB screw heads, with a hole that fits the 2.5 mm screw. These limit screw penetration and protect the board.
- Thin nonconductive battery padding, modeled as **0.5 mm**, and two broad soft hook-and-loop straps around the tray and battery. Keep straps loose enough not to squeeze the pouch. No screw passes through the battery.
- Approximately **0.6 mm soft speaker gasket** around the speaker's rigid rim. Keep the diaphragm and grille unobstructed. The retainer geometry must be checked against the actual rear housing before tightening it.
- Optional thin open acoustic mesh behind the mic opening. Do not cover the sound port with solid tape, glue or a waterproof film.

Nut pockets open into the case. Insert the nuts before the lid and hold them in place while starting the screws. A small removable dab of adhesive on the outside edge of a nut can retain it; keep adhesive off the threads. No heat-set inserts are required for the four cover screws.

## First print and assembly

1. Ask a local FDM print shop to print **only `print_first_front_fit_check.stl` first**, at 100% scale in mm. PLA is sufficient for this dimensional gauge. Fit the unpowered board, check that the four mounts line up without bending it, and check that the bezel leaves the active screen clear. Check the microphone hole aligns with the board's MIC aperture.
2. Confirm the USB plug hood can reach the recessed socket through the opening. The board's USB port is recessed roughly 13 mm from the outside wall; the 18 mm opening is intentionally generous. Try your actual USB cable. The SD card is reached through the screen’s left side: a 24 × 14 mm opening spans the slot, nominally 35.03 mm below the PCB top according to the manufacturer drawing. The slot is recessed 11.5 mm from the outside wall. With the test piece, check that your finger can operate the card mechanism and pull the card fully clear. The modeled card travel is unobstructed, but fingertip reach and the socket mechanism require this physical check. BOOT/RESET remain accessible by removing the cover and, if necessary, the battery tray.
3. After the fit check, print the four final STL parts. PETG is the proposed working-case material; a PLA trial can check assembly. Starting settings: 0.4 mm nozzle, 0.2 mm layer height, four perimeters, five top/bottom layers and 20–30% infill. Ask the shop to inspect the USB and SD openings, side speaker supports and acoustic passage for bridge/support needs. These settings are a starting point, not a tested printer profile.
4. Disconnect USB and the battery before assembly. Seat the board on its four posts. The touchscreen faces the opening and the MIC end goes toward the small upper acoustic opening. Use the four PCB screws and insulating washers, tightening only until seated. Confirm no screw touches glass or a trace.
5. Fit the speaker against the side grille with the 0.6 mm soft gasket on its rigid rim. Secure its retaining ring with two screws from inside, before fitting the tray. Keep the diaphragm clear. Check the retainer against the actual speaker housing; its exact contours and terminals were not measured. The speaker remains on the shell, so opening the back does not tug its lead. Route its cable below the tray and along the lower edge, leaving slack.
6. Lay the battery and speaker leads into the two open notches at the lower end of the tray. Each notch is 10 mm wide and stops short of the measured battery footprint. The plugs go around the edge while the tray is removed; these are lay-in wire routes, not holes sized for an unmeasured connector. Fit the removable battery tray using four screws. Add thin nonconductive padding, place the cell on the tray, and retain it with broad straps. Keep the pouch and its tabs away from posts, screw tips and sharp edges. The separator protects the cell from solder joints; it is not a sealed or fire-rated battery compartment.
7. Check that cables remain below the tray or in its notches, clear of the pouch, SD-card path, antenna and microphone passage. Keep battery tabs and connectors clear of the lower end stop. If a cable or plug needs force to fit, adjust its route or the model; do not pinch it under the lid.
8. Insert four M3 nuts into the shell pockets and close the lid with four M3 × 8 screws. The cover should sit flat with light pressure. If it needs force, reopen it and find the interference. For development, remove these four screws to reopen the case.
9. Compare a spoken command with the case open and closed. Listen for muffling, rattles or speaker feedback. Adjust the mic passage/gasket if needed before treating this as the final design.

Stop recording and safely finish card writes before removing the SD card; power the device off before handling internal wiring.

The case is enclosed apart from the screen, USB/SD access and acoustic openings. It is **not waterproof**. A plastic case and an additional opening do not change the firmware's microphone selection.

## Validation and limitations

The build checks every final part is a valid single CAD solid, exports a watertight consistently wound STL, and checks that the separate printed parts do not overlap. It also checks against simplified board, glass, battery, speaker and USB envelopes, and checks that the reserved SD withdrawal path, wire passages and future microphone space are clear of printed parts. The model leaves clearance above the maximum component height in the manufacturer drawing.

These checks do not prove fit to every connector, cable, screw, LiPo pouch seam or speaker contour. Printer shrinkage, the actual battery terminal position, soldered wires and acoustic performance remain physical checks. The official board STEP was downloaded for reference; it is not redistributed in the case package.

## Rebuild

Use Python 3.11 with `requirements.txt`. From the repository root, the current workstation can run:

```powershell
& '.tools/lantern-cad-env/Scripts/python.exe' hardware/lantern-case/build_case.py
& '.tools/lantern-cad-env/Scripts/python.exe' hardware/lantern-case/make_preview.py
& 'C:\Program Files\Blender Foundation\Blender 5.0\blender.exe' --background --factory-startup --python hardware/lantern-case/render_preview.py
```

Edit `dimensions.json` to change measured component dimensions. Several mounting coordinates and port details in `build_case.py` are board-specific; replacing the board requires reviewing these, not just changing width and length.

Assembly coordinates: the front exterior is Z=0, +Z points toward the removable back, and +Y is the microphone end. +X is to the right when viewing the rear, so the front-facing MIC aperture is at X=-5.5 after shifting the PCB centre to X=9.5. SD access is on +X; the speaker is on −X.

## Sources

- [LCDWiki ES3C28P dimension drawing](https://www.lcdwiki.com/res/ES3C28P/ES3C28P_Size.pdf)
- [LCDWiki board documentation and manufacturer 3D download](https://www.lcdwiki.com/2.8inch_ESP32-S3_Display)
- [Prusa guidance on designing for printing](https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135)
- [Prusa PETG material guide](https://help.prusa3d.com/article/petg_2059)
