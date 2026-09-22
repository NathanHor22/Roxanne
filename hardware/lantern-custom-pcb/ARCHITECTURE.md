# Lantern custom PCB — initial design brief

**22 September update:** Four microphones and one speaker are confirmed, now with
a 3-5 metre room-pickup target. See [revision A0 specification](rev-a/SCHEMATIC_SPECIFICATION.md)
for the newer recommendation: a dedicated XVF3800 audio front end and custom
main board. The ES7210 approach below remains an alternative, not the preferred
room-distance architecture. No fabrication files have been released.

Date: 21 September 2026
Status: proposed architecture for discussion; no schematic, routed PCB or manufacturing release yet.

## Confirmed direction

One purpose-built Lantern main board with a smaller screen, four microphone
connectors, one amplified speaker connector, rechargeable battery connection,
USB-C, volume up/down, BOOT, RESET and a hardware power button. The user confirmed
that all four microphones will sit around the case on short internal wires.
Retain microSD storage for complete recordings and upload retry.

## Proposed hardware

| Block | Starting design | Still to verify before schematic release |
|---|---|---|
| Processor | ESP32-S3 module; target 16 MB flash and 8 MB PSRAM, matching the current firmware's memory class | Exact module variant, available GPIOs, antenna keepout and supply peaks |
| Display | 1.3-inch 240 x 240 SPI colour LCD using ST7789; no touch for revision A | Exact bare panel/FPC pinout, backlight circuit and mechanical drawing |
| Microphones | Four matching small microphone daughterboards on short keyed cables, labelled MIC1–MIC4 | Capsule type, sensitivity, supply/bias, connector family, pinout and wire routing |
| Microphone interface | Four-channel synchronous capture; ES7210 with matched analog microphones is the leading candidate because Espressif supplies a four-mic SD-recording example | Current datasheet, sourcing, reference circuit, input bias and performance on a bench prototype |
| Speaker | One keyed two-wire amplified output; I2S class-D amplifier, MAX98357A-class candidate | Actual speaker impedance/power, supply rail, gain, noise and output filtering |
| Storage | Side-accessible microSD socket with card detection | Exact socket/eject travel, pin allocation, sustained writes and power-loss recovery |
| USB-C | One connector for 5 V charging and firmware/debug USB data | Proper CC configuration and current limit, ESD protection, connector mounting and no back-power when off |
| Battery | One-cell Li-ion/LiPo connector; suitable protection and temperature monitoring | Cell datasheet, charge voltage/current, thermistor, protection status, polarity and connector |
| Charger | Integrated charger with system power-path management; BQ24074-class candidate | Thermal dissipation, USB source current and full recording/playback/Wi-Fi load budget |
| Battery indication | Battery monitoring; evaluate a fuel gauge for useful percentage reporting | Cell profile and measured charge/discharge behaviour |
| Controls | Volume +/−, power, recessed BOOT/RESET; propose a separate Record/Stop button | Placement, debounce, boot strapping and intended short/long-press behaviour |

Part numbers above are candidates, not an order list. Four microphone connectors
must preserve four independent channels; they are not four sockets wired to a
single microphone input. The matching microphone boards and cables form part of
this design. Existing arbitrary microphone modules are not automatically compatible.

## Audio and firmware

```text
MIC1 ─┐
MIC2 ─┼─> synchronous four-channel audio input ─> ESP32-S3 ─> microSD
MIC3 ─┤                                              │
MIC4 ─┘                                              ├─> processed mono audio for existing services
                                                     └─> speaker amplifier ─> speaker
```

Start with simultaneous capture and per-channel diagnostics. Then evaluate
microphone selection/mixing, echo control and noise processing with the actual
case and speaker. More microphones do not automatically improve audio: spacing,
phase, sensitivity matching and vibration isolation matter. A channel records
all audible people; four microphones do not imply four isolated speakers.
Speaker identification still needs software.

The current firmware already has board profiles, ST7789 support on the original
board, SD-backed WAV recording, Wi-Fi and upload logic. Its current recording
pipeline is 16 kHz mono and WakeNet explicitly expects one channel. Add a new board
profile and a four-channel input driver; feed an appropriate processed mono stream
to existing wake/voice/cloud paths. Preserve raw multichannel recordings locally
for initial testing; decide the production archive format and upload contract
after measuring benefits and storage costs. Four 16-bit channels at the same
sample rate require four times the raw storage of mono.

## Power-off behaviour

```text
USB-C 5 V ─> input protection/current limit ─> charger + power path <─> protected cell
                                                      │
                                                      ├─> low-power button controller
                                                      └─> switched system supply
                                                               │
                                              ESP32 / LCD / mic circuit / SD / amplifier
```

Normal power-off should stop recording, finalize and close the WAV, flush the SD
card, retain the pending-upload state, mute the amplifier, then remove power from
the main system. It must not wait for an internet upload to complete. A controller
with an appropriate shutdown handshake/timeout is needed; select its timing only
after measuring worst-case SD finalization. Provide a forced-off escape for a hang
and test recovery from unexpected loss of power.

The ESP32, screen, microphones, amplifier and SD supply must actually turn off,
including while USB-C is plugged in. This is not ESP32 deep sleep. In this proposed
arrangement the charger and a tiny power-control circuit remain connected, so the
battery can charge while Lantern is off. It is not literal zero-current battery
isolation. If that is required, add a mechanical battery disconnect or an explicitly
verified isolation arrangement; do not describe an ordinary GPIO button as one.

## Mechanical direction

Keep the screen on the front, speaker facing a side, and distribute microphone
openings around the housing, with controlled acoustic paths and separation from
speaker vibration. Use keyed connectors and accessible mounting holes. Keep the
ESP32 antenna away from the battery and metal. Retain side access to the SD card
and USB-C. Plan a four-layer main PCB with a continuous ground reference.

The current battery measures 91 x 59 x 5 mm and speaker 41 x 29 x 10 mm. A smaller
LCD alone does not shrink the enclosure below the battery footprint. Final PCB
outline and a revised case follow battery/speaker/panel selection and placement.
The existing printed case is for the existing touchscreen board, not guaranteed
to fit this new board.

## Build stages and exit checks

1. **Fix components and dimensions.** Select panel, cell, speaker, microphone
   capsules, connector families and control behaviour. Produce a candidate BOM,
   power budget, interface/pin budget and mechanical arrangement.
2. **Prove the risky circuits.** Use evaluation hardware to demonstrate four
   simultaneous mic inputs, useful audio in the proposed arrangement, SD recording,
   speaker playback and charger/power-off behaviour. Avoid a PCB order based only
   on a block diagram.
3. **Design in KiCad.** Produce schematic, footprints, PCB layout, 3D fit checks and
   fabrication/assembly files. Check manufacturer references, electrical rules,
   routing/clearances, antenna placement and power integrity before release.
4. **Order a small assembled prototype batch.** Bring up power and USB first, then
   display/buttons, SD, four-channel audio and full Lantern flow. Test charging
   temperature, battery runtime, noise, forced-off recovery and repeated sessions.
   Revise hardware and enclosure before a larger manufacturing order.

## Evidence and references

- Existing firmware: `../lantern-firmware/main/lantern_board.h`,
  `boards/lantern_original.h`, `boards/lantern_v2_es3c28p.h`,
  `lantern_audio.c` and `lantern_wake.c` beneath the firmware main directory.
- [Espressif four-mic ES7210 TDM-to-SD example](https://github.com/espressif/esp-idf/tree/master/examples/peripherals/i2s/i2s_codec/i2s_es7210_tdm)
- [ESP32-S3 I2S peripheral documentation](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/i2s.html)
- [ESP32-S3 PCB layout guidance](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s3/pcb-layout-design.html)
- [Example 1.3-inch ST7789 colour display](https://www.waveshare.com/wiki/1.3inch_LCD_Module)
- [MAX98357A speaker amplifier](https://www.analog.com/en/products/max98357a.html)
- [BQ24074 charger and power-path device](https://www.ti.com/product/BQ24074)
- [Example of hardware pushbutton control with a shutdown handshake](https://www.analog.com/en/resources/design-notes/pushbutton-onoff-controller-simplifies-system-design.html)

These sources establish feasible building blocks. They do not validate the final
combined electrical design, microphone choice, thermals or physical performance.
