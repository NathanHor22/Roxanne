# Meeting recorder PCB - revision A0 design specification

22 September 2026. Product name undecided; Fovea is the company.

**Status: preliminary circuit architecture and schematic-capture specification.
This is not a component-level KiCad schematic, routed board, or fabrication release.**
No hardware, firmware, deployment or component order was changed for this design.
This packet establishes a concrete engineering handoff; it cannot be sent directly
to a bare-board factory as manufacturing data.

## Confirmed requirements

- Four microphones and one speaker, with a 3-5 metre room-pickup target.
- Rechargeable single-cell battery, USB-C charging/programming and physical power control.
- Smaller front display; keep the earlier 1.3-inch SPI display direction as a draft.
- Volume +/-, Record/Stop, recessed BOOT and RESET buttons.
- microSD for complete audio and retry; accessible from the side of the case.
- Microphones around the case, with short internal connections, rather than room-length wires.
- Malaysian design, fabrication and assembly services; ready-made cable harnesses.

The distance is a test target, not a guarantee. Put the recorder on the table with
unobstructed sound openings. A device worn under clothing or blocked by the user's
body has a different acoustic problem. Four channels do not mean four isolated
people, and direction finding does not identify a person's name.

## Architecture decision

The 21 September analog ES7210 shortlist remains a lower-cost research option.
For the newly confirmed room-distance requirement, prefer a dedicated four-mic
audio processor. An ADC such as ES7210 digitizes signals; it does not by itself
provide a tuned four-mic beamformer.

**A0 recommendation:** custom ESP32/power/display/SD main PCB plus a replaceable
XVF3800 audio board. Start with the ReSpeaker XVF3800 module for acoustic trials.
Its four microphones are already on the module: this version does not have four
separately pluggable microphone heads.

**A1 custom audio board:** XVF3800 reference design plus four PDM microphone heads
in fixed, measured positions, with MIC1-MIC4 keyed connectors. Infineon IM69D130
is a candidate compatible with the processor's documented microphone class.
Exact silicon ordering code, reference-design revision, power rails, clocking,
flash image, connector assignments and firmware licensing need engineering release.
This is a separate board design, not an instruction to connect analog IM73A135
microphones to PDM inputs or to rewire a purchased ReSpeaker module.

```
4 microphones -> audio processor -> processed I2S audio -> ESP32-S3 -> microSD
                          ^                                  |        |
                          | playback/reference audio         +--> Wi-Fi/cloud
                          +------------------------------- ESP32-S3
                          |
                          +-> codec/amplifier -> one side-facing speaker

USB-C 5 V -> input protection/current control -> charger/power path <- battery
                                                      |
                                                      +-> power-button controller
                                                      +-> system load switch
                                                            +-> 3.3 V main rail
                                                            +-> audio rail(s)
```

The exact same playback signal must reach both the speaker path and the echo
canceller. Do not bypass the processor's playback/reference route. Select a
conference capture profile that retains conversation, and an ASR profile for
commands if available. Test that noise suppression does not erase quiet speakers
or overlapping speech. Raw multi-mic diagnostic capture depends on the chosen
module firmware/interface; it is not promised on its two-channel I2S output.

## Audio choices

| Choice | Hardware | Reason to choose | Consequence |
|---|---|---|---|
| A0 recommended prototype | ReSpeaker XVF3800 module + custom main board | Integrated array and processing allow useful acoustic testing before a custom array | Larger assembly; requires I2S firmware and host integration; module connector is not a ready-made main-board harness |
| A1 custom form factor | XVF3800 reference design + 4 PDM heads, e.g. IM69D130 | Four plug-in mic positions and custom mechanical fit | Greater PCB, firmware, sourcing and acoustic-tuning work |
| B lower-cost research | ES7210 + 4 differential analog heads, e.g. IM73A135 | Existing ESP-IDF four-channel capture example and driver | Requires additional DSP work; not the default for the 3-5 m target |

The Infineon IM73A135 analog part and IM69D130 PDM part have different electrical
interfaces. They are not interchangeable. The former requires a suitable supply
within its 1.52-3.00 V operating range; the previous 2.8 V supply proposal applies
only to that analog option. Do not reuse its wiring for the PDM option.

## Main-board electrical specification

### Processor, USB and controls

Use ESP32-S3-WROOM-1-N16R8: 16 MB flash and 8 MB PSRAM. Preserve the antenna
keepout and avoid memory-reserved GPIO35-37. GPIO0 remains BOOT; avoid allocating
GPIO3/45/46 to peripherals that could disturb boot strapping.

Native USB uses GPIO19 D- and GPIO20 D+. Include connector ESD protection and
an off-state isolation strategy so USB cannot back-power the unpowered main rail.
USB-C is a 5 V sink and USB device/programming port in A0, not a general USB-mic
host. CC1 and CC2 each need their own 5.1 kohm Rd to ground. Current availability
must be detected or constrained appropriately; Rd alone is not authorization to
draw 1.5/3 A. Finalize input current control before release.

EN requires the Espressif reset/power-up circuit. RESET pulls EN low; BOOT pulls
GPIO0 low. Record and volume switches go to GPIO inputs with defined pull-ups and
debouncing. The power button goes to the power controller, not just a GPIO.

### Proposed GPIO allocation - GPIO numbers, NOT module pad numbers

| Function | GPIO(s) | Design note |
|---|---|---|
| Audio clock reserve | 4 | MCLK only if selected audio firmware requires it |
| Audio BCLK / frame sync | 5 / 7 | Exactly one clock master; finalize selected XVF image first |
| Audio capture / playback | 6 / 8 | Processor -> ESP RX / ESP TX -> processor reference |
| Audio reset | 9 | Verify required level and off-state isolation |
| I2C SDA / SCL | 16 / 15 | Shared control bus; check addresses and rail pull-ups |
| Display MOSI / SCLK / CS | 11 / 12 / 10 | Separate from SD bus |
| Display DC / RESET / backlight | 13 / 14 / 47 | Backlight through driver, never LED load directly from GPIO |
| SD CLK / CMD / D0 | 38 / 40 / 39 | Route as short SDMMC bus |
| SD D1 / D2 / D3 | 41 / 42 / 48 | Four-bit target; fallback mode evaluated during bring-up |
| Volume + / Volume - / Record | 1 / 2 / 21 | Active-low switches |
| Power request / shutdown acknowledge | 17 / 18 | Level translation and boot defaults reviewed with controller |
| USB D- / D+ | 19 / 20 | Native USB route |
| UART TX / RX | 43 / 44 | Programming/test pads, 3.3 V logic |
| BOOT / RESET | 0 / EN | Recessed controls |

This pin budget avoids duplicate assignments. A designer must still map these
GPIOs to the exact module pads and confirm every peripheral role. Optional card
detect, charge status and mute indicators can use an I2C expander if needed;
do not consume boot-strapping pins casually.

### Power and battery

Candidate chain: BQ24074 charger/power path -> TPS22965 main load switch ->
TPS63070 3.3 V regulator. LTC2954-1 controls the switch and requests orderly
shutdown. MAX17048 is a candidate battery gauge. Set charge/input currents and
the controller timing from the selected cell and measured load, not IC maxima.

A0's purchased audio module needs a switched, regulated 5 V supply; provide a
separate appropriately rated boost/buck-boost stage. Its final part, inductors,
capacitors and current rating are release items. The 3.3 V regulator does not
power that module directly. A1's custom XVF audio board must instead implement
the exact rails from its verified reference design.

Power-off sequence: stop capture -> finish and flush the SD file -> persist the
pending upload -> mute playback -> acknowledge shutdown -> disconnect system
loads. Do not wait for a network upload. A forced-off timeout is required for a
hang; firmware and recovery tests must accommodate an incomplete write.

Main CPU/display/audio/SD turn off even with USB attached. The charger and tiny
button-control circuit remain alive so charging while off is possible. This is
not zero-current battery isolation. A fuel gauge left on the battery rail needs
I2C isolation/level handling to avoid back-powering the switched processor.

The existing battery is approximately 91 x 59 x 5 mm. Its protection, thermistor,
connector polarity, allowed charge current and cell datasheet are unverified.
Do not finalize the charger around a photograph or label capacity alone.

### Speaker and connectors

One side-facing speaker uses a keyed two-wire harness. The existing speaker is
41 x 29 x 10 mm; impedance and power are unknown. A0 uses its audio module's
documented amplified output. A1 needs a matched codec/amplifier stage. An
amplified bridge output has SPK+ and SPK-; neither wire is ground. No parallel
speakers or second amplifier should be connected to that output.

| Connector | Intended interface | Still required |
|---|---|---|
| J_BAT | BATT+, BATT-, cell temperature sense where supported | Protected pack, keyed current-rated family, fixed polarity drawing |
| J_AUDIO | Audio power, grounds, I2S capture/playback/clocks, I2C, reset | Exact module revision, logic levels, power rating and mating harness |
| J_SPK | SPK+, SPK- amplified pair | Speaker specification, connector and wire current rating |
| J_LCD | SPI, reset, backlight control and power | Exact display SKU/FPC drawing; controller name alone is insufficient |
| J_MIC1-4 (A1 only) | PDM mic supply, grounds, clock, data and channel select | Clock loading/termination, pairing/edge selection, pin numbering and cable drawing |
| J_DEBUG | 3.3 V reference, ground, UART TX/RX, EN, BOOT | Test fixture and off-state isolation; not a battery-power connector |

Use incompatible keys or connector sizes for power, microphone and speaker
ports. A matching plastic plug does not establish electrical compatibility.
Prototype short mic harnesses first; cable length and geometry must be fixed
before acoustic tuning. Use a small array PCB in A0 rather than four loose wires.

## Firmware work required on the new board

The currently working firmware remains on its existing hardware. Add a separate
custom-board profile. Integrate the audio processor control protocol, matching
I2S clock roles, sample format and processed channel selection. Convert/resample
to the existing 16 kHz mono capture and supported playback formats deliberately.
Preserve consent, full-WAV storage and per-user upload ownership.

Add real battery monitoring, volume handling, hardware shutdown acknowledgement,
and persistent SD recovery after power loss. That last feature is not implemented
by the current 0.7.3 firmware. The cloud's current 25 MiB upload limit is also not
removed by this PCB. Processed mono remains the first cloud path; multichannel
diagnostic recordings require a separate format/storage decision.

## Fabrication and acceptance plan

Ask for a four-layer main PCB with continuous ground reference, proper RF
keepout, separated switching/class-D and microphone areas, accessible test points,
and soldered/inspected assembly. No final outline or mounting-hole coordinates
are released: the known battery size and selected array constrain the enclosure.
Existing case STLs are for the old touchscreen board and are not this board's fit check.

Before ordering populated boards, finalize actual component symbols/pads, all
passives, charge and regulator design, DSP firmware rights, connector polarity,
and the mechanical model. Then produce KiCad schematic/layout, ERC/DRC reports,
Gerber/drill files, assembly BOM, pick-and-place files, drawings and STEP model.
An STL case and this architecture PDF cannot manufacture a PCB.

Request quotes for 2 and 5 assembled prototypes, separating design fees, bare
boards, component sourcing, assembly, test fixtures and firmware/audio tuning.
Ask whether bare-board fabrication is in Malaysia or subcontracted overseas;
Malaysian ordering/assembly alone does not prove local bare-board manufacture.

Bench sequence: validate rails/current limit/off-state isolation; USB programming;
SD/display/buttons; all four channels and playback; acoustic tests at 1, 3 and 5 m
from four directions; quiet and air-conditioned rooms; two people taking turns
and overlapping; voice replies playing; battery and USB operation; long recording,
interrupted upload, normal shutdown and forced-off recovery. Compare replay and
transcript quality with the current device, and retain original test recordings.

## Verified sourcing and engineering leads

- Cytron Malaysia lists ReSpeaker XVF3800 with enclosure, MPN 114993701, at
  RM299 with 3 units shown when checked on 22 September 2026. Stock/pricing must
  be reconfirmed; no purchase was made. https://my.cytron.io/p-respeaker-xmos-xvf3800-with-case
- Jaavin, Rawang: advertises prototype PCB design, sourcing, assembly and testing.
  Ask for an audio/DSP-capable engineer, not only bare-board printing.
  https://www.jaavin.com/manufacturing
- JAC Engineering, Cheras/Rawang: advertises schematic/layout, fabrication,
  sourcing, assembly and product testing. Small-batch terms need a quotation.
  https://jac-eng.com/page/services

## Primary engineering references

- ESP32-S3 module: https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf
- XMOS processor: https://www.xmos.com/xvf3800/
- XMOS pipeline/reference routing: https://www.xmos.com/documentation/XM-014888-PC/html/modules/fwk_xvf/doc/datasheet/03_audio_pipeline.html
- XMOS acoustic design: https://www.xmos.com/documentation/XM-014888-PC/html/modules/fwk_xvf/doc/user_guide/06_acoustic_design_guidelines.html
- Seeed module/interface: https://wiki.seeedstudio.com/respeaker_xvf3800_introduction/
- Infineon PDM microphone: https://www.infineon.com/part/IM69D130
- Infineon analog alternative: https://www.infineon.com/part/IM73A135
- BQ24074: https://www.ti.com/product/BQ24074
- TPS63070: https://www.ti.com/product/TPS63070
- TPS22965: https://www.ti.com/product/TPS22965
- LTC2954: https://www.analog.com/en/products/ltc2954.html
- Local ESP-IDF 5.2.3 example: `.tools/esp-idf/examples/peripherals/i2s/i2s_codec/i2s_es7210_tdm/`

These references support individual building blocks. The combined custom board
has not been electrically simulated, laid out, assembled or bench-validated.
