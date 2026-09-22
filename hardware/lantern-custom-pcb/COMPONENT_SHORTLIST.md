# Lantern custom board — component shortlist

**22 September update:** This analog-microphone list is an alternative design.
The confirmed 3-5 metre target now favours the dedicated audio-processor options
in [revision A0](rev-a/SCHEMATIC_SPECIFICATION.md). Its PDM microphones are not
interchangeable with the analog capsules listed below.

21 September 2026. Design candidates, not a released purchasing BOM. Packages,
footprints, sourcing, interfaces and thermal/current limits must be checked in
the schematic and bench prototype. No hardware changes or orders have been made.

## Parts to design around

| Item | Quantity per device | Candidate | Purpose and selection status |
|---|---:|---|---|
| Processor/radio module | 1 | ESP32-S3-WROOM-1-N16R8 | 16 MB flash, 8 MB PSRAM; preserves the current firmware's memory class. Use the module rather than designing bare-chip RF. Confirm antenna clearance and memory-reserved GPIOs. |
| Small colour display | 1 | 1.3-inch, 240 x 240, SPI ST7789 | Waveshare SKU 15867 is a bench-test candidate. It is a complete display module, not a finalized bare-panel/FPC part number. Select exact panel and connector before laying out the main board. |
| Microphone capsules | 4 | Infineon IM73A135V01XTSA1 | Analog differential MEMS microphones, one on each small matching plug-in PCB. Manufacturer specifies a 1.52–3.00 V operating supply; do not power from 3.3 V. |
| Four-channel microphone ADC | 1 | Everest ES7210 | Leading candidate due to Espressif's four-mic TDM-to-SD example. Input coupling, bias/common mode, gain, clocking and availability must be verified with the chosen microphones. |
| Microphone supply | 1 | TI TPS7A20, 2.8 V version | Candidate low-noise regulator for the four mic boards. Exact order code and operating-mode/performance at 2.8 V remain schematic checks. Do not connect its output to the ADC's microphone-bias output. |
| Speaker amplifier | 1 | MAX98357AETE+T | I2S amplifier in the 16-pin TQFN package; retain as the initial prototype candidate. Confirm gain and output power against actual speaker ratings. Manufacturer also offers newer alternatives; reassess size/noise after the bench test. |
| Speaker | 1 | Existing 41 x 29 x 10 mm unit, conditional | Its dimensions are known; impedance and rated power are not. Obtain its label or supplier specification before approving reuse. |
| Rechargeable battery | 1 | Protected single-cell LiPo, exact model pending | Existing battery is approximately 91 x 59 x 5 mm and labelled 4000 mAh. Protection, charge limits, temperature sensing, connector and polarity are unverified. Smaller battery selection is a product-size/runtime decision. |
| Charger/power path | 1 | TI BQ24074 | Initial candidate consistent with the architecture brief. Set charge/input limits from the selected cell and USB source capability, not the chip's maximum rating. Check enclosure thermals. |
| Main 3.3 V regulator | 1 | TI TPS63070 | Buck-boost candidate to provide 3.3 V across the cell discharge range. Inductor/capacitors, output capability at minimum battery voltage and noise are not yet finalized. |
| Battery gauge | 1 | MAX17048 | Single-cell state-of-charge reporting. Validate against the actual cell and temperature handling. |
| Power-button controller | 1 | LTC2954-1 | Candidate for a shutdown request, firmware save/acknowledgement, and forced-off long press. Verify boot handshake and shutdown timings. |
| Main load switch | 1 | TI TPS22965 | Positive-enable system-supply switch candidate. Disconnect the main system whether powered by battery or USB; verify bias supply, leakage, discharge and all possible back-power paths. |
| USB-C receptacle | 1 | GCT USB4105 family | USB 2.0 data plus 5 V input. Final suffix/PCB mounting drawing still required. Add appropriate CC, ESD and input-protection circuitry. |
| microSD socket | 1 | Hirose DM3AT-SF-PEJM5 | Push-push candidate; reserve the complete insertion/ejection travel in the case and verify card-detect wiring. |
| Mic connectors | 4 on main board, 4 on mic boards | JST GH, 1.25 mm, four positions | Four short matching cable assemblies. Proposed signals: mic supply, ground, differential output +/−; exact order must be documented. Pinout is not yet released. |
| Speaker connector | 1 board connector plus harness | Two-position keyed connector, e.g. JST GH | Confirm wire and contact current ratings. Both speaker wires are amplifier outputs; neither is automatically ground. |
| Battery connector | 1 plus matching harness | Distinct keyed connector, exact family pending | Prefer temperature-sense provision; number of positions and current rating follow the selected cell. Do not assume generic JST cables have consistent polarity. |
| Momentary switches | 6 proposed | Volume +, Volume −, Power, Record/Stop, BOOT, RESET | Exact switch family/actuator height follows case placement. BOOT/RESET should be recessed; the power button works through the controller/load switch. |

The battery, gauge and small power-control/charging circuits remain connected
when the main system is off. This arrangement is not literal zero-current
battery isolation; that requires a separate mechanical disconnect or a verified
isolation design.

## Additional engineering parts

Select decoupling and bulk capacitors, resistor networks, input coupling/filter
components, regulator inductor, USB ESD/input protection, status LEDs, battery
protection where not supplied by the pack, test points and programming pads
during schematic work. Reserve acoustic gaskets, microphone sound holes, mounting
hardware and strain relief in the mechanical design. These are needed for a
complete working product, but their values cannot be selected from the block
diagram alone.

## What to decide first

1. Exact screen assembly: confirm the 1.3-inch format and choose module versus
   bare display with FPC. The connector cannot be inferred from ST7789 alone.
2. Battery: reuse the current large cell only after obtaining its specification,
   or choose a smaller documented pack and a runtime target.
3. Speaker: obtain impedance and power rating for the current unit or choose a
   documented replacement with its mechanical drawing.
4. Validate the IM73A135 + ES7210 audio circuit on evaluation hardware before
   committing the microphone interface and all four cable pinouts.

The intended deliverable is an assembled main PCB plus four assembled microphone
PCBs and ready-made cable harnesses. The user should not need to hand-solder MEMS
microphone capsules or fine-pitch ICs. This shortlist does not require replacing
the current working device while the custom board is developed.

## Primary references

- [ESP32-S3-WROOM-1 module datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf)
- [Waveshare 1.3-inch LCD module](https://docs.waveshare.net/1.3inch_LCD_Module/)
- [Infineon IM73A135](https://www.infineon.com/part/IM73A135)
- [Espressif ES7210 four-microphone example](https://github.com/espressif/esp-idf/tree/master/examples/peripherals/i2s/i2s_codec/i2s_es7210_tdm)
- [TPS7A20](https://www.ti.com/product/TPS7A20)
- [MAX98357A](https://www.analog.com/en/products/max98357a.html)
- [BQ24074](https://www.ti.com/product/BQ24074)
- [TPS63070](https://www.ti.com/product/TPS63070)
- [MAX17048](https://www.analog.com/en/products/max17048.html)
- [LTC2954](https://www.analog.com/en/products/ltc2954.html)
- [TPS22965](https://www.ti.com/product/TPS22965)
- [GCT USB4105](https://gct.co/connector/usb4105)
- [Hirose DM3AT-SF-PEJM5](https://www.hirose.com/product/p/CL0609-0031-0-00)
- [JST GH connectors](https://www.jst-mfg.com/product/index.php?lang=2&series=105)
