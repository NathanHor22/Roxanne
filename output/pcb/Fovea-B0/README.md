# Fovea B0: modular recorder board design draft

22 September 2026. The product name remains undecided; Fovea identifies the company.

This package contains a dimensioned 3D placement study, an editable electrical
schematic draft and explicit voltage/current calculations. **It is not a routed,
manufacturing-ready PCB. Do not order PCB fabrication or assembly from these files.**
No firmware, deployed service, existing recorder or previous enclosure was changed.

## What was selected

The user chose a ready-made four-microphone module for this prototype. Use a
ReSpeaker XVF3800 100 mm circular module above an ESP32-S3-WROOM-1-N16R8 carrier.
Its four installed microphones are the recording inputs; this revision does not
add four connectors for loose microphones. The 3-5 metre capture distance is an
acoustic test target, not a guarantee. Firmware, room acoustics, placement and
echo cancellation all affect results.

The main board outline is **110 x 158 x 1.6 mm**, provisionally four layers.
The measured battery envelope is **91 x 59 x 5 mm** below the board. A
**41 x 29 x 10 mm** speaker faces sideways. Its electrical rating is unverified;
the calculation assumes a suitable 4-ohm speaker operated at no more than 2 W.
The 1.3-inch SPI screen uses a provisional 42 x 42 mm module envelope.
The assembly is wider than the main PCB because the speaker and connectors
extend beyond it. This model does not fit the old enclosure.

Six buttons are included: Power, Record/Stop, Volume +, Volume -, BOOT and RESET.
The volume and record buttons are accessible along the lower right-hand edge;
the upper microphone module does not cover them. Switch actuators and enclosure
caps require final mechanical selection.

## Open these files

| File | Purpose |
| --- | --- |
| `preview.html` | Offline interactive model; rotate, separate layers and inspect the main board. |
| `Fovea-B0-assembly.step` | CAD assembly, millimetres, individual solids and colours. |
| `Fovea-B0-assembly.glb` | Portable 3D viewing model; glTF units are metres. |
| `Fovea-B0-assembly.blend` | Blender scene with assembled geometry and camera. |
| `main-board-outline.stl` | Millimetre-scale outline fit dummy only. It is not an electronic PCB. |
| `schematics/Fovea-B0.kicad_sch` | Root of the editable schematic and eight circuit sheets. |
| `Fovea-B0-board-and-electrical-design.pdf` | 25-page illustrated review packet with board maps, pin schedules, connected circuit diagrams, calculations and full component-to-net sheets. |
| `component-schedule.csv` | Candidate components, values and unresolved package choices. Not a procurement BOM. |
| `pin-connections.csv` | Explicit physical pin / carrier contact to net mapping. |
| `connections.json`, `power-calculations.json` | Machine-readable design source and numerical results. |
| `model-validation.json`, `electrical-validation.json` | Checks performed and checks still outstanding. |

The schematic uses self-contained rectangular component symbols with named
global nets. Matching net names connect across sheets. Connector definitions
are carrier-side assignments; they must be mapped to the real module and
selected connector before any wiring. Pin numbers alone are not footprints.
Native KiCad opening and ERC were not available in the authoring environment.

## PDF navigation

Every page has a PDF bookmark. The physical placement diagrams and terminal
tables use the same component references as the editable schematic.

| Pages | Contents |
| --- | --- |
| 1-3 | Assembly overview, upward-facing microphones and screen, USB/SD access, component locations and XY coordinates. |
| 4 | Power distribution, rail currents and system interconnect. |
| 5-6 | All 41 ESP32 module pads, GPIO names, net names and destinations. |
| 7-8 | Audio, display, battery, USB, microSD, service and speaker connector pinouts. |
| 9-11 | Button circuits, safe shutdown, regulator wiring and USB/charging control. |
| 12 | Audio path, manufacturer capability claims and the required 1/3/5-metre recording tests. |
| 13 | Small-batch prototype cost estimates, retail price anchors and Malaysian quotation routes. |
| 14-16 | Detailed power calculations and unresolved engineering release requirements. |
| 17-24 | Complete component-to-net electrical sheets. |
| 25 | Manufacturer references. |

The module pad map is drawn with its antenna upward. U9 is rotated 180 degrees
in the current board placement. Connector tables define carrier-side assignments;
unselected mating connectors still need their orientation and pin order verified.

The provisional build allowance is **RM900-1,600 per prototype** at approximately
five units, plus **RM5,000-15,000 one-time engineering**. These are planning
estimates, not supplier quotes. The RM299 microphone-module price is an observed
local retail anchor; final parts, fabrication and engineering need itemized quotes.
Shipping, taxes, rework, extra PCB revisions, major firmware changes, acoustic
tuning and certification are excluded.

## Power and current budget

These are engineering allocations, not measured module currents.

| Item | Recording | Simultaneous peak |
| --- | ---: | ---: |
| 3.3 V rail | 0.33 A | 0.85 A |
| 5 V audio rail | 0.30 A | 0.871 A |
| Total regulated outputs | 2.589 W | 7.158 W |
| Battery including estimated losses | 2.97 W / 0.80 A at 3.7 V | 9.84 W / 3.07 A at 3.2 V |

Battery calculations assume 0.15 ohm total series resistance and 90% recording /
85% peak conversion efficiency. Specify a **protected 1S, 4.2 V charge battery
and harness with at least a 4 A discharge target**, then check real peak current,
temperature and voltage droop. The old battery is not approved by its dimensions.
A pack with a compatible 10k NTC is required for the charging circuit as drawn.

The current BQ24074 charger draft sets 0.50 A nominal charging and 1.30 A nominal
USB input limit only when a Type-C source advertises at least 1.5 A. A default
source is limited to 100 mA; it may not sustain recording or useful charging
while running. GPIO4 requests USB suspend through a level-translated control.
This is 5 V Type-C current detection, not USB Power Delivery negotiation.

Illustrative runtime for a 4 Ah, 3.7 V pack at 80% usable energy is about 4 hours.
The ideal constant-current charging portion alone is 8 hours; actual full
charging takes longer. These figures must be revised after audio-module and
screen currents are measured.

## Power button

The low-current momentary button controls an LTC2954-1 and a system load switch.
Hold approximately 0.33 seconds to power on. A normal press requests firmware
shutdown: stop recording, finalize and flush WAV, persist upload state, mute,
then drive GPIO18 low in open-drain mode. Holding approximately 6.48 seconds
forces off if firmware hangs and can interrupt a write. Timing tolerances apply.

This disconnects the main recorder rails. The charger, gauge and control circuit
remain powered, so USB charging is available while off. It is not total battery
isolation. A true zero-current shipping disconnect would be a separate change.

## Required before manufacture

1. **Resolve regulator stability.** Both TPS63070 stages currently calculate below
   TI's 400 kHz right-half-plane-zero guideline at the combined peak load. The
   drawn 76 uF nominal output bank is not validated compensation. Check effective
   capacitance, loop response and load steps; change the stage if needed.
2. **Resolve charger heating.** Recording plus charging calculates roughly
   1.04-1.39 W charger dissipation, with an illustrative 86-102 C junction at
   40 C ambient using datasheet thermal resistance. Actual enclosure/PCB may be
   hotter. Reduce current or choose a switching charger as bench results require.
3. **Validate low-battery peaks.** The assumed worst case leaves only 2.74 V at
   converter inputs and dissipates 1.42 W in the series path. Verify pack,
   connectors and current limiting before accepting the peak load.
4. Measure ReSpeaker startup, recording and playback loads. RGB LEDs are assumed
   off. Verify the selected I2S firmware clock direction, sample format, I2C
   addresses and the module-side mating harness. GPIO4 is now USB suspend, not
   the unused MCLK reserve in the earlier A0 brief.
5. Select exact screen, speaker, protected pack/NTC, USB/SD/battery connectors,
   tactile switches, TVS and fuse. Verify every footprint and mounting hole.
   Array supports in the model are provisional, not released drill positions.
6. Review power sequencing and back-powering through USB, I2C, audio-module
   service USB and debug adapters. Confirm battery/copper clearance at the ESP
   antenna. Adapt firmware to the new GPIO map and safe SD shutdown.
7. Open and review the schematic in KiCad, correct electrical pin types as
   needed, run ERC, route the four-layer PCB and run DRC. Review with a PCB
   engineer before releasing Gerbers, drills, BOM and pick-and-place files.
8. Test an assembled prototype for rail voltage/ripple, temperature, USB source
   changes, audio quality, SD integrity, battery behaviour and 3-5 m pickup.

All current/voltage equations and cited manufacturer references are in the PDF
and source. Malaysia PCB fabrication/assembly services can review this package;
they still need the completed manufacturing outputs listed above to build it.

## Verification completed

- 134 CAD solids pass the CAD kernel validity check; 134 exported meshes are watertight.
- 112 unique component references and 77 named nets; every net has at least two terminals.
- Physical pin numbers are unique within each component; reserved ESP32 GPIOs are excluded.
- USB current-limit tolerance and candidate inductor saturation budgets checked.
- Schematic expressions structurally checked; this is not native KiCad/ERC validation.
- All 397 symbol pins checked against their generated wire labels or no-connect marks.
- Renders and every PDF page visually reviewed before delivery.
- Interactive assembly, exploded and main-board views checked in the browser; no console warnings/errors.
- No electrical simulation, hardware measurements, routing, DRC or prototype assembly performed.

## Regenerating

The source scripts live in `hardware/lantern-custom-pcb/rev-b/` in the repository.
Run `build_model.py` with CadQuery, trimesh and numpy; `render_model.py` in a fresh
background Blender process; `make_preview.py` with trimesh/numpy; and
`build_package.py` with ReportLab. `design.py` is the shared electrical source.
The package contains a copy of these scripts under `source/` for review, but
their default output paths assume the original repository directory structure.

Downloaded manufacturer PDFs are not redistributed in this package. The source
reference links and `fetch_references.py` are included instead.
