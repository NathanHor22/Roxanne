"""Single source for Rev B0 engineering draft connections and calculations.

No measured current is invented. PCB routing, connector footprints and hardware
qualification remain separate work. Nets below describe an editable draft.
"""
from pathlib import Path
from math import pi, sqrt
import json

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
OUT = REPO / 'output' / 'pcb' / 'Fovea-B0'
OUT.mkdir(parents=True, exist_ok=True)
PARTS = []
GROUPS = {
 '01_usb_charge': 'USB-C current detection and charging',
 '02_power_button': 'Power button and switched system supply',
 '03_regulators': '3.3 V and 5 V regulated supplies',
 '04_processor': 'ESP32-S3, service buttons and USB data',
 '05_storage_display': 'microSD and small display connector',
 '06_audio_controls': 'Audio module, speaker and user buttons',
 '07_battery_gauge': 'Battery gauge and bus pull-ups',
}
NOTES = {
 '01_usb_charge': ['TUSB320LAI supplies CC termination: do not add parallel 5.1k Rd resistors.', 'OUT1 low means 1.5 A or 3 A advertised. Inverter selects 1.30 A nominal input limit.', 'Default advertisement selects USB100. GPIO4 requests USB suspend; implement in firmware.', 'Battery: protected 1S, 4.2 V charge, >=4 A discharge target, 10k NTC. Existing pack not approved.'],
 '02_power_button': ['SW1 is a low-current momentary input; it does not carry battery current.', 'KILL has a pull-up to switched 3.3 V. GPIO18 must be open-drain; drive low only after SD closure.', 'Approximate hold times: 0.33 s on; 6.48 s forced off. Normal press raises shutdown interrupt.', 'Charger/control/gauge remain powered. This is not total battery isolation.'],
 '03_regulators': ['Both converters use forced PWM, 1.5 uH and 3 x 22uF + 10uF nominal output capacitance.', 'Verify effective ceramic capacitance under DC bias. Prove loop stability at low battery/full load.', '3.3 V: 470k/150k. 5 V: 680k/130k. Values are calculated; tolerance limits are in budget.', 'L1/L2: XFL4020-152ME candidate. 4.6 A nominal saturation is not an output-current rating.'],
 '04_processor': ['Module pad numbers shown, not GPIO numbers. GPIO35-37 intentionally unused for N16R8.', 'USB switch provides powered-off isolation; check Ioff and USB eye/ESD after routing.', 'GPIO4 is USB_SUSPEND, replacing the unused MCLK reserve. No audio MCLK exported.', 'EN: 10k pull-up / 1uF reset capacitor. Verify reset and converter rise times on the bench.'],
 '05_storage_display': ['J4 numbering is SD card contact numbering; socket detect/shell pad mapping awaits final footprint.', 'J5 numbering is the carrier connector definition, not a claim about an arbitrary display plug.', 'Use a 3.3 V-compatible SPI display module with onboard backlight driver; bare glass is not interchangeable.', 'Display envelope is provisional 42 x 42 x 6 mm. Exact module drawing and mounting holes remain open.'],
 '06_audio_controls': ['B0 uses four microphones already on ReSpeaker; no four loose external microphones are attached.', 'J6 is a carrier-defined harness. Map its labels to the selected ReSpeaker revision before assembly.', 'ESP supplies BCLK/WS for the selected INT-device slave image; verify image clock role before power.', 'SPK+/- come from the module amplifier. Neither is ground. Target <=2 W into a verified 4-ohm speaker.'],
 '07_battery_gauge': ['MAX17048 uses battery power. I2C pull-ups connect only to switched 3.3 V.', 'Gauge has open-drain SDA and no battery-rail bus pull-ups. Confirm off-state leakage in assembly.', 'Address 0x36; check audio addresses. Start at 100 kHz; verify combined pull-up/rise time.', 'Gauge capacity estimate requires pack characterization; it does not measure audio-board current.'],
}

def part(ref, value, group, pins, *, package='', status='draft', note=''):
    # pins: physical pin name -> (signal name, connected net or None)
    item = dict(ref=ref, value=value, group=group, package=package, status=status, note=note,
                pins=[dict(number=str(n), name=v[0], net=v[1]) for n,v in pins.items()])
    PARTS.append(item)
    return item

def two(ref, value, group, a, b, package='0603', note=''):
    return part(ref,value,group,{'1':('1',a),'2':('2',b)},package=package,note=note)

g='01_usb_charge'
part('J1','USB-C USB2 receptacle',g,{
 'A1':('GND','GND'),'A4':('VBUS','VBUS_5V'),'A5':('CC1','CC1'),'A6':('D+','USB_DP'),
 'A7':('D-','USB_DM'),'A8':('SBU1',None),'A9':('VBUS','VBUS_5V'),'A12':('GND','GND'),
 'B1':('GND','GND'),'B4':('VBUS','VBUS_5V'),'B5':('CC2','CC2'),'B6':('D+','USB_DP'),
 'B7':('D-','USB_DM'),'B8':('SBU2',None),'B9':('VBUS','VBUS_5V'),'B12':('GND','GND'),'S1':('SHIELD','GND')},
 package='USB4105 family - exact suffix/footprint pending',status='connector release pending')
two('F1','2 A fuse target',g,'VBUS_5V','USB_PROTECTED','1206 fuse - trip/derating TBD')
part('D1','5 V VBUS TVS target',g,{'1':('K','USB_PROTECTED'),'2':('A','GND')},package='SMF - exact part/clamp TBD',status='ESD release pending')
part('U1','BQ24074RGTR',g,{1:('TS','BAT_NTC'),2:('BAT','BAT_PLUS'),3:('BAT','BAT_PLUS'),4:('CE','GND'),5:('EN2','CHG_EN2'),6:('EN1','CHG_SUSPEND'),7:('PGOOD',None),8:('VSS','GND'),9:('CHG','CHARGING_N'),10:('OUT','SYS_RAW'),11:('OUT','SYS_RAW'),12:('ILIM','ILIM_SET'),13:('IN','USB_PROTECTED'),14:('TMR',None),15:('ITERM',None),16:('ISET','CHG_SET'),17:('EP','GND')},package='VQFN16 3x3 EP')
two('R1','1.24k 1%',g,'ILIM_SET','GND')
two('R2','1.78k 1%',g,'CHG_SET','GND')
two('C1','4.7uF 16V X7R',g,'USB_PROTECTED','GND','0805')
two('C2','10uF 10V X7R',g,'BAT_PLUS','GND','0805')
two('C3','22uF 10V X7R',g,'SYS_RAW','GND','0805')
part('J2','Protected battery + NTC',g,{1:('PACK+','BAT_PLUS'),2:('PACK-','GND'),3:('10k NTC','BAT_NTC')},package='Keyed 3-pin >=4 A harness - TBD',status='pack/harness release pending')
part('U2','TUSB320LAIRWBR',g,{1:('CC1','CC1'),2:('CC2','CC2'),3:('PORT','GND'),4:('VBUS_DET','VBUS_SENSE'),5:('ADDR',None),6:('OUT3',None),7:('OUT1','CC_LOW_CURRENT'),8:('OUT2',None),9:('ID',None),10:('GND','GND'),11:('EN_N','GND'),12:('VDD','SYS_RAW')},package='X2QFN12 1.6x1.6')
two('R3','900k 1%',g,'VBUS_5V','VBUS_SENSE')
two('R4','10k',g,'SYS_RAW','CC_LOW_CURRENT')
two('C4','100nF 10V',g,'SYS_RAW','GND')
part('U3','SN74LVC1G04DBVR',g,{1:('NC',None),2:('A','CC_LOW_CURRENT'),3:('GND','GND'),4:('Y','HIGH_CURRENT_OK'),5:('VCC','SYS_RAW')},package='SOT23-5')
part('U4','SN74LVC1G32DBVR',g,{1:('A','HIGH_CURRENT_OK'),2:('B','CHG_SUSPEND'),3:('GND','GND'),4:('Y','CHG_EN2'),5:('VCC','SYS_RAW')},package='SOT23-5')
part('Q1','2N7002',g,{1:('G','USB_SUSPEND'),2:('S','GND'),3:('D','SUSPEND_N_RAW')},package='SOT23-3',note='Low-current open-drain level translation; verify chosen vendor pinout.')
part('U12','SN74LVC1G04DBVR',g,{1:('NC',None),2:('A','SUSPEND_N_RAW'),3:('GND','GND'),4:('Y','CHG_SUSPEND'),5:('VCC','SYS_RAW')},package='SOT23-5')
two('R8','100k',g,'SYS_RAW','SUSPEND_N_RAW')
two('C7','100nF 10V',g,'SYS_RAW','GND')
two('R5','47k',g,'USB_SUSPEND','GND')
two('R6','100k',g,'CHG_EN2','GND')
two('C5','100nF 10V',g,'SYS_RAW','GND')
two('C6','100nF 10V',g,'SYS_RAW','GND')
two('R7','2.2k',g,'SYS_RAW','CHG_LED_A')
part('D2','Amber charge LED',g,{1:('A','CHG_LED_A'),2:('K','CHARGING_N')},package='0603')
part('D3','TPD2EUSB30DRTR',g,{1:('IO1','CC1'),2:('IO2','CC2'),3:('GND','GND')},package='DRT 3-pin',note='5.5V standoff; verify CC transient clamping on PCB')

g='02_power_button'
part('U5','LTC2954ITS8-1',g,{1:('VIN','SYS_RAW'),2:('PB','PWR_BUTTON'),3:('ONT','PWR_ONT'),4:('GND','GND'),5:('INT','PWR_INT_N'),6:('EN','SYS_ENABLE'),7:('PDT','PWR_PDT'),8:('KILL','POWER_HOLD')},package='TSOT23-8')
two('SW1','POWER momentary NO',g,'PWR_BUTTON','GND','6x6 tactile; actuator envelope provisional')
two('C10','100nF 10V',g,'SYS_RAW','GND')
two('C11','47nF 10%',g,'PWR_ONT','GND')
two('C12','1uF 10% timer',g,'PWR_PDT','GND','0805')
two('R10','100k',g,'SYS_RAW','SYS_ENABLE')
two('R11','100k',g,'V3V3','PWR_INT_N')
two('R12','100k',g,'V3V3','POWER_HOLD')
part('U6','TPS22965DSGR',g,{1:('VIN','SYS_RAW'),2:('VIN','SYS_RAW'),3:('ON','SYS_ENABLE'),4:('VBIAS','SYS_RAW'),5:('GND','GND'),6:('CT','SWITCH_CT'),7:('VOUT','SYS_SW'),8:('VOUT','SYS_SW'),9:('EP','GND')},package='WSON8 2x2 EP')
two('C13','10nF 25V X7R',g,'SWITCH_CT','GND')
two('C14','10uF 10V X7R',g,'SYS_RAW','GND','0805')
two('C15','10uF 10V X7R',g,'SYS_SW','GND','0805')

g='03_regulators'
for i,rail,top,bot in [(7,'V3V3','470k 0.1%','150k 0.1%'),(8,'V5_AUDIO','680k 0.1%','130k 0.1%')]:
    pre='REG'+str(i)
    part('U'+str(i),'TPS63070RNMR',g,{1:('PS_SYNC','GND'),2:('PG',None),3:('VAUX',pre+'_VAUX'),4:('GND','GND'),5:('FB',pre+'_FB'),6:('FB2','GND'),7:('VOUT',rail),8:('VOUT',rail),9:('L2',pre+'_L2'),10:('PGND','GND'),11:('L1',pre+'_L1'),12:('VIN','SYS_SW'),13:('VIN','SYS_SW'),14:('EN',pre+'_EN'),15:('VSEL','GND')},package='VQFN-HR15 2.5x3',note='Forced PWM. Footprint is not an ordinary QFN16.')
    two('L'+str(i-6),'1.5uH XFL4020-152ME',g,pre+'_L1',pre+'_L2','4x4x2.1')
    for offset,value,net in [(0,'10uF 10V X7R','SYS_SW'),(1,'10uF 10V X7R','SYS_SW'),(2,'100nF 10V',pre+'_VAUX'),(3,'10uF 10V X7R',rail),(4,'22uF 10V X7R',rail),(5,'22uF 10V X7R',rail),(6,'22uF 10V X7R',rail)]:
        two('C'+str(20+(i-7)*10+offset),value,g,net,'GND','0805' if 'uF' in value else '0603')
    two('R'+str(20+(i-7)*4),top,g,rail,pre+'_FB')
    two('R'+str(21+(i-7)*4),bot,g,pre+'_FB','GND')
    two('R'+str(22+(i-7)*4),'10k',g,'SYS_SW',pre+'_EN')

g='04_processor'
gp={0:'BOOT_N',1:'VOL_UP',2:'VOL_DOWN',4:'USB_SUSPEND',5:'AUDIO_BCLK',6:'AUDIO_FROM_DSP',7:'AUDIO_WS',8:'AUDIO_TO_DSP',9:'AUDIO_RESET_N',10:'LCD_CS',11:'LCD_MOSI',12:'LCD_CLK',13:'LCD_DC',14:'LCD_RST',15:'I2C_SCL',16:'I2C_SDA',17:'PWR_INT_N',18:'POWER_HOLD',19:'MCU_USB_DM',20:'MCU_USB_DP',21:'RECORD_N',38:'SD_CLK',39:'SD_D0',40:'SD_CMD',41:'SD_D1',42:'SD_D2',43:'UART_TX',44:'UART_RX',47:'LCD_BL',48:'SD_D3'}
pad_gpio={4:4,5:5,6:6,7:7,8:15,9:16,10:17,11:18,12:8,13:19,14:20,15:3,16:46,17:9,18:10,19:11,20:12,21:13,22:14,23:21,24:47,25:48,26:45,27:0,28:35,29:36,30:37,31:38,32:39,33:40,34:41,35:42,36:44,37:43,38:2,39:1}
pins={1:('GND','GND'),2:('3V3','V3V3'),3:('EN','MCU_EN'),40:('GND','GND'),41:('EP','GND')}
pins.update({pad:('GPIO'+str(gpio),gp.get(gpio)) for pad,gpio in pad_gpio.items()})
part('U9','ESP32-S3-WROOM-1-N16R8',g,dict(sorted(pins.items())),package='18x25.5 module; antenna keepout')
two('R30','10k',g,'V3V3','MCU_EN')
two('C40','1uF 10V',g,'MCU_EN','GND')
two('R31','10k',g,'V3V3','BOOT_N')
two('SW2','BOOT momentary NO',g,'BOOT_N','GND','3x6 tactile - provisional')
two('SW3','RESET momentary NO',g,'MCU_EN','GND','3x6 tactile - provisional')
two('C41','47uF 6.3V X7R',g,'V3V3','GND','1206')
two('C42','10uF 10V X7R',g,'V3V3','GND','0805')
two('C43','100nF 10V',g,'V3V3','GND')
part('U10','TS3USB221ARSER',g,{1:('1D+','USB_DP_ISO'),2:('1D-','USB_DM_ISO'),3:('2D+',None),4:('2D-',None),5:('GND','GND'),6:('OE_N','GND'),7:('D-','USB_DM'),8:('D+','USB_DP'),9:('S','GND'),10:('VCC','V3V3')},package='UQFN10 RSE')
two('R32','22R',g,'USB_DP_ISO','MCU_USB_DP')
two('R33','22R',g,'USB_DM_ISO','MCU_USB_DM')
two('C44','100nF 10V',g,'V3V3','GND')
part('J3','UART service pads',g,{1:('GND','GND'),2:('TX','UART_TX'),3:('RX','UART_RX'),4:('EN','MCU_EN'),5:('BOOT','BOOT_N'),6:('VREF','V3V3')},package='6 test pads; fixture must not power VREF')
part('D4','TPD2EUSB30DRTR',g,{1:('IO1','USB_DP'),2:('IO2','USB_DM'),3:('GND','GND')},package='DRT 3-pin',note='5.5V standoff; verify USB signal integrity and clamping')

g='05_storage_display'
part('J4','microSD 4-bit socket',g,{1:('DAT2','SD_D2'),2:('DAT3','SD_D3'),3:('CMD','SD_CMD'),4:('VDD','V3V3'),5:('CLK','SD_CLK_CARD'),6:('VSS','GND'),7:('DAT0','SD_D0'),8:('DAT1','SD_D1'),'S':('SHELL','GND')},package='DM3AT family - contact/pad mapping must be checked',status='connector release pending')
two('R40','33R',g,'SD_CLK','SD_CLK_CARD')
for k,net in enumerate(['SD_CMD','SD_D0','SD_D1','SD_D2','SD_D3']): two('R'+str(41+k),'10k',g,'V3V3',net)
two('C50','22uF 10V X7R',g,'V3V3','GND','0805')
two('C51','100nF 10V',g,'V3V3','GND')
part('J5','1.3in SPI display module',g,{1:('VCC','V3V3'),2:('GND','GND'),3:('DIN','LCD_MOSI'),4:('CLK','LCD_CLK'),5:('CS','LCD_CS'),6:('DC','LCD_DC'),7:('RST','LCD_RST'),8:('BL input','LCD_BL')},package='Carrier-defined 8-pin connector; module with BL driver',status='display/connector release pending')
two('C52','10uF 10V X7R',g,'V3V3','GND','0805')
two('R46','100k',g,'LCD_BL','GND')

g='06_audio_controls'
audio_pins={1:('+5V','V5_AUDIO'),2:('GND','GND'),3:('BCLK','AUDIO_BCLK'),4:('GND','GND'),5:('WS','AUDIO_WS'),6:('GND','GND'),7:('DSP OUT','AUDIO_FROM_DSP'),8:('DSP IN','AUDIO_TO_DSP'),9:('SDA','I2C_SDA'),10:('SCL','I2C_SCL'),11:('RESET_N','AUDIO_RESET_N'),12:('GND','GND')}
part('J6','ReSpeaker logic harness',g,audio_pins,package='Carrier-defined keyed 2x6 >=1.5 A; exact family TBD',status='module-side mapping pending')
two('C60','22uF 10V X7R',g,'V5_AUDIO','GND','0805')
two('C61','100nF 10V',g,'V5_AUDIO','GND')
two('R50','10k',g,'V3V3','AUDIO_RESET_N')
part('J7','Speaker amplifier FROM module',g,{1:('AMP+','SPK_PLUS'),2:('AMP-','SPK_MINUS')},package='Keyed 2-pin harness >=1 A; verify module mate',status='module-side mapping pending')
part('J8','Speaker output TO speaker',g,{1:('SPK+','SPK_PLUS'),2:('SPK-','SPK_MINUS')},package='Keyed 2-pin >=1 A')
for k,(net,title) in enumerate([('VOL_UP','VOLUME +'),('VOL_DOWN','VOLUME -'),('RECORD_N','RECORD / STOP')]):
    two('SW'+str(4+k),title,g,net+'_SW','GND','6x6 tactile - actuator provisional')
    two('R'+str(51+2*k),'1k',g,net+'_SW',net)
    two('R'+str(52+2*k),'10k',g,'V3V3',net)
    two('C'+str(62+k),'100nF 10V',g,net,'GND')

g='07_battery_gauge'
part('U11','MAX17048G+T10',g,{1:('CTG','GND'),2:('CELL','BAT_PLUS'),3:('VDD','BAT_PLUS'),4:('GND','GND'),5:('ALRT',None),6:('QSTRT','GND'),7:('SCL','I2C_SCL'),8:('SDA','I2C_SDA'),9:('EP','GND')},package='TDFN8 2x2 EP')
two('C70','100nF 10V',g,'BAT_PLUS','GND')
two('R60','4.7k',g,'V3V3','I2C_SDA')
two('R61','4.7k',g,'V3V3','I2C_SCL')

SOURCES = {
 'ESP32 module': 'https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf',
 'BQ24074': 'https://www.ti.com/lit/ds/symlink/bq24074.pdf',
 'TUSB320LAI': 'https://www.ti.com/lit/ds/symlink/tusb320lai.pdf',
 'Power button': 'https://www.analog.com/media/en/technical-documentation/data-sheets/2954fb.pdf',
 'System switch': 'https://www.ti.com/lit/ds/symlink/tps22965.pdf',
 'Both regulators': 'https://www.ti.com/lit/ds/symlink/tps63070.pdf',
 'USB isolation': 'https://www.ti.com/lit/ds/symlink/ts3usb221a.pdf',
 'Battery gauge': 'https://www.analog.com/media/en/technical-documentation/data-sheets/max17048-max17049.pdf',
 'Audio module': 'https://wiki.seeedstudio.com/respeaker_xvf3800_introduction/',
 'Module mechanics': 'https://files.seeedstudio.com/wiki/respeaker_xvf3800_usb/respeaker_xvf3800_2d_mechanical_drawing.pdf',
 'I2S example': 'https://wiki.seeedstudio.com/respeaker_xvf3800_xiao_i2s/',
 'Display candidate': 'https://www.waveshare.com/wiki/1.3inch_LCD_Module',
}

LOADS = [
 # All figures are allocations, not measurements or part guarantees.
 ('ESP32 + flash + PSRAM',3.3,.20,.50,'Engineering allocation; Wi-Fi bursts included in peak'),
 ('microSD',3.3,.06,.25,'Card-dependent; measure selected card'),
 ('SPI screen + backlight',3.3,.06,.08,'Module provisional; brightness dependent'),
 ('Other switched 3.3 V loads',3.3,.01,.02,'Pull-ups/control and design allowance'),
 ('XVF3800 module, silent',5.0,.30,.40,'Allocation; no verified module current. RGB LEDs disabled'),
 ('Speaker amplifier increment',5.0,0,2/(5*.85),'2 W continuous test output / assumed 85% amplifier efficiency'),
]

def calculate():
    rails={v:dict(record_A=sum(r[2] for r in LOADS if r[1]==v),peak_A=sum(r[3] for r in LOADS if r[1]==v)) for v in (3.3,5.0)}
    cases={}
    # Simple R series loss, explicit assumption not extrapolated guaranteed RDS.
    for name,peak,vb,eta in [('record',False,3.7,.90),('combined_peak',True,3.2,.85)]:
        pout=sum(v*r['peak_A' if peak else 'record_A'] for v,r in rails.items())
        preg=pout/eta
        rpath=.15 # pack/protection/charger/switch/connector/wires together
        discr=vb*vb-4*rpath*preg
        if discr<=0: raise ValueError('No feasible battery operating point')
        ib=(vb-sqrt(discr))/(2*rpath)
        cases[name]=dict(output_W=pout,regulator_input_W=preg,battery_V=vb,battery_A=ib,path_loss_W=ib*ib*rpath,battery_W=vb*ib,converter_input_V=vb-ib*rpath,assumed_efficiency=eta)
    out=dict(rails=rails,cases=cases,assumed_series_ohm=.15,charge_A=890/1780,
      charge_min_A=797/(1780*1.01),charge_max_A=975/(1780*.99),
      usb_input_A=1610/1240,usb_input_min_A=1500/(1240*1.01),usb_input_max_A=1720/(1240*.99),
      battery_capacity_Ah_assumed=4,usable_energy_Wh=3.7*4*.8,
      runtime_record_h=(3.7*4*.8)/cases['record']['battery_W'],
      ideal_CC_charge_h=4/(890/1780),
      on_hold_s=(32+1+.047/.000156)/1000,forced_off_s=(64+1+1/.000156)/1000,
      speaker_Vrms=sqrt(2*4),speaker_Arms=sqrt(2/4),speaker_Apeak=sqrt(2)*sqrt(2/4),
      button_held_A=3.3/(10000+1000),button_input_low_V=3.3*1000/11000,
      button_RC_s=(10000*1000/(10000+1000))*100e-9,
      i2c_pull_low_A=3.3/4700,i2c_rise_100pF_s=.8473*4700*100e-12,
      storage_MiB_per_min=16000*2*60/1048576,
      standby_budget_mA=2.0,
      regulator={},usb_thermal={})
    for v,rt,rb in [(3.3,470000,150000),(5.0,680000,130000)]:
        actual=.8*(1+rt/rb)
        # Forced PWM +/-1% Vref and 0.1% resistor extremes; no ripple/load error included.
        out['regulator'][str(v)] = dict(nominal_V=actual,min_static_V=.8*.99*(1+rt*.999/(rb*1.001)),max_static_V=.8*1.01*(1+rt*1.001/(rb*.999)),divider_A=actual/(rt+rb))
        vin=cases['combined_peak']['converter_input_V']; io=rails[v]['peak_A']; d=max(0,1-vin/actual)
        il=io/(.85*(1-d))+vin*d/(2*1.5e-6*2.1e6)
        out['regulator'][str(v)].update(inductor_peak_A_est=il,required_Isat_20pct_A=il*1.2,rhp_zero_Hz=((1-d)**2*actual)/(2*pi*io*1.5e-6) if d else None)
    isys=cases['record']['regulator_input_W']/4.4
    for vb in (3.0,3.7,4.2):
        pd=(5-4.4)*isys+(5-vb)*out['charge_A']
        out['usb_thermal'][str(vb)] = dict(system_A=isys,total_input_A=isys+out['charge_A'],charger_loss_W=pd,estimate_Tj_40C=40+44.5*pd)
    return out

if __name__=='__main__':
    data=calculate()
    (OUT/'connections.json').write_text(json.dumps(dict(groups=GROUPS,notes=NOTES,parts=PARTS,sources=SOURCES),indent=2),encoding='utf-8')
    (OUT/'power-calculations.json').write_text(json.dumps(data,indent=2),encoding='utf-8')
    print(json.dumps(data,indent=2))
