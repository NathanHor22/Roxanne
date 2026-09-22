"""Build the preliminary engineering handoff, not PCB fabrication data."""
from pathlib import Path
import csv
import html

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon, Circle
from reportlab.graphics import renderSVG

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
OUT = REPO / 'output' / 'pdf'
OUT.mkdir(parents=True, exist_ok=True)
PDF = OUT / 'Fovea-meeting-recorder-PCB-design-A0.pdf'

GREEN = colors.HexColor('#12674b')
DARK = colors.HexColor('#172a25')
MUTED = colors.HexColor('#52645d')
PALE = colors.HexColor('#eef6f2')
EDGE = colors.HexColor('#cbdad2')
AMBER = colors.HexColor('#8d5813')
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleA', fontName='Helvetica-Bold', fontSize=25, leading=29, textColor=DARK, spaceAfter=10))
styles.add(ParagraphStyle(name='SubtitleA', fontName='Helvetica', fontSize=10, leading=15, textColor=MUTED, spaceAfter=13))
styles.add(ParagraphStyle(name='BodyA', fontName='Helvetica', fontSize=10, leading=14, textColor=DARK, spaceAfter=8))
styles.add(ParagraphStyle(name='SmallA', fontName='Helvetica', fontSize=8.3, leading=11, textColor=DARK, spaceAfter=5))
styles.add(ParagraphStyle(name='HeadA', fontName='Helvetica-Bold', fontSize=13, leading=17, textColor=GREEN, spaceAfter=8, spaceBefore=9))
styles.add(ParagraphStyle(name='CellA', fontName='Helvetica', fontSize=8.5, leading=11.5, textColor=DARK))
styles.add(ParagraphStyle(name='CellHeadA', parent=styles['CellA'], fontName='Helvetica-Bold', textColor=colors.white))

def p(text, style='BodyA'):
    return Paragraph(text, styles[style])

def table(rows, widths):
    content = [[p(html.escape(str(c)), 'CellHeadA' if i == 0 else 'CellA') for c in row]
               for i, row in enumerate(rows)]
    t = Table(content, colWidths=widths, repeatRows=1, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,0),GREEN),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,PALE]),
        ('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),
        ('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),7),
        ('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,0),.5,GREEN),
        ('LINEBELOW',(0,-1),(-1,-1),.5,EDGE)]))
    return t

def box(d,x,y,w,h,title,lines=(),fill=PALE):
    d.add(Rect(x,y,w,h,rx=6,ry=6,fillColor=fill,strokeColor=EDGE,strokeWidth=1))
    d.add(String(x+12,y+h-20,title,fontName='Helvetica-Bold',fontSize=11,fillColor=GREEN))
    for i,line in enumerate(lines):
        d.add(String(x+12,y+h-37-i*13,line,fontName='Helvetica',fontSize=9,fillColor=DARK))

def arrow(d,x1,y1,x2,y2,label=None,ly=6):
    d.add(Line(x1,y1,x2,y2,strokeColor=GREEN,strokeWidth=1.5))
    if x1 == x2:
        s = 1 if y2>y1 else -1
        pts=[x2,y2,x2-4,y2-7*s,x2+4,y2-7*s]
    else:
        s=1 if x2>x1 else -1
        pts=[x2,y2,x2-7*s,y2-4,x2-7*s,y2+4]
    d.add(Polygon(pts,fillColor=GREEN,strokeColor=GREEN))
    if label:
        d.add(String((x1+x2)/2,(y1+y2)/2+ly,label,textAnchor='middle',fontSize=8,fillColor=MUTED))

def architecture():
    d=Drawing(755,260)
    box(d,0,155,145,82,'4 microphones',['Fixed acoustic positions','All four captured together'])
    box(d,205,155,185,82,'Audio processor',['XVF3800 preferred','Room capture + voice commands'])
    box(d,455,155,145,82,'ESP32-S3',['Recording + controls','Wi-Fi + account pairing'])
    box(d,652,155,102,82,'microSD',['Complete audio','Upload retry'])
    arrow(d,145,197,205,197,'audio')
    arrow(d,390,197,455,197,'I2S')
    arrow(d,600,197,652,197,'SDMMC')
    box(d,205,15,185,65,'Codec / amplifier',['One side-facing speaker'])
    box(d,455,15,145,65,'Display + buttons',['Small front screen'])
    box(d,652,15,102,65,'Cloud',['Per-user records'])
    arrow(d,297,155,297,80,'',0)
    d.add(String(305,112,'playback',fontSize=8,fillColor=MUTED))
    arrow(d,527,155,527,80)
    arrow(d,600,165,704,80,'Wi-Fi',-9)
    # The echo reference follows the same playback stream, never a separate source.
    d.add(Line(482,155,482,119,strokeColor=GREEN,strokeWidth=1.5))
    arrow(d,482,119,355,119)
    arrow(d,355,119,355,155)
    d.add(String(380,99,'Playback + echo reference',fontSize=8,fillColor=MUTED))
    d.add(String(0,126,'3-5 m: validation target',fontName='Helvetica-Bold',fontSize=9,fillColor=AMBER))
    d.add(String(0,111,'Table placement; clear sound holes.',fontSize=8,fillColor=MUTED))
    return d

def power():
    d=Drawing(755,158)
    box(d,0,90,125,64,'USB-C 5 V',['Protection + current limit'])
    box(d,188,90,177,64,'Charger / power path',['BQ24074 candidate'])
    box(d,421,90,145,64,'System load switch',['TPS22965 candidate'])
    box(d,619,90,136,64,'Switched rails',['3.3 V main / audio rails'])
    arrow(d,125,120,188,120)
    arrow(d,365,120,421,120,'SYS_RAW')
    arrow(d,566,120,619,120,'SYS_SW')
    box(d,188,0,177,59,'Protected 1-cell battery',['Polarity + NTC to be fixed'])
    arrow(d,275,59,275,90)
    arrow(d,290,90,290,59)
    box(d,421,0,205,59,'Power-button controller',['LTC2954-1; save / shutdown'])
    arrow(d,493,59,493,90)
    d.add(Line(391,120,391,29,strokeColor=GREEN,strokeWidth=1))
    d.add(Circle(391,120,2,fillColor=GREEN,strokeColor=GREEN))
    arrow(d,391,29,421,29)
    d.add(String(0,48,'Main system off; charging available.',fontSize=8,fillColor=MUTED))
    d.add(String(0,33,'Not zero-current battery isolation.',fontSize=8,fillColor=MUTED))
    return d

pin_rows=[
('Audio MCLK reserve','4','Only if required by the selected DSP firmware'),
('Audio BCLK / frame sync','5 / 7','Choose one clock master; finalize firmware image'),
('Audio capture / playback','6 / 8','ESP RX / ESP TX; playback also feeds echo reference'),
('Audio reset; I2C SDA / SCL','9; 16 / 15','Check control addresses, voltage and off-state paths'),
('LCD MOSI / SCLK / CS','11 / 12 / 10','SPI display; final panel/FPC still to select'),
('LCD DC / RESET / backlight','13 / 14 / 47','Backlight uses a driver stage'),
('SD CLK / CMD / D0','38 / 40 / 39','Dedicated SDMMC wiring'),
('SD D1 / D2 / D3','41 / 42 / 48','Four-bit target; route beside ground reference'),
('Volume + / - / Record','1 / 2 / 21','Switches with defined pull-ups and debounce'),
('Power request / acknowledge','17 / 18','Power-controller handshake; verify boot defaults'),
('USB D- / D+','19 / 20','USB programming; ESD and off-state isolation'),
('UART TX / RX; BOOT / RESET','43 / 44; 0 / EN','Recessed service controls and test pads')]

bom=[
('Main','1','ESP32-S3-WROOM-1-N16R8','Processor/radio','Candidate; antenna keepout and exact module pads'),
('A0 only','1','ReSpeaker XVF3800 module','4 mics + processing + output path','Cytron MPN 114993701; module mechanics/interface to confirm'),
('A1 only','1','XVF3800 reference-design circuit','Custom four-mic processor board','Exact silicon, support parts, firmware rights and rails pending'),
('A1 only','4','Infineon IM69D130','PDM microphone heads','Bench candidate; fixed geometry, supply and connector drawing'),
('Main','1','BQ24074','Charging and source power path','Cell limits, USB input policy and thermals pending'),
('Main','1 each','LTC2954-1 + TPS22965','Power button and system isolation','Shutdown handshake and all back-power paths to review'),
('Main','1','TPS63070','3.3 V buck-boost rail','Inductor, passives and load budget pending'),
('A0 only','1','Regulated 5 V converter - TBD','Switched audio-module power','Part and load/current budget not yet selected'),
('Main','1','MAX17048','Battery gauge','Validate pack model and off-state I2C isolation'),
('Main','1','1.3-inch 240 x 240 SPI display','Small front screen','ST7789 direction; exact panel/FPC not frozen'),
('Main','1','Hirose DM3AT-SF-PEJM5 candidate','microSD socket','Check footprint, detect mechanism and eject clearance'),
('Main','1','GCT USB4105 family candidate','USB-C connector','Select suffix, ESD and current-control circuitry'),
('Assembly','1 each','Protected cell + one speaker','Battery and playback','Existing electrical ratings unverified'),
('Assembly','6','Momentary switches','Power, record, volume +/-, boot, reset','Actuator dimensions and placement pending'),
('Assembly','Set','Keyed connectors and harnesses','Battery/audio/display/speaker/mics','A1 has four mic sockets; A0 mics are on its module')]

with (ROOT/'candidate-components.csv').open('w',newline='',encoding='utf-8-sig') as f:
    writer=csv.writer(f); writer.writerow(['Variant','Quantity','Candidate','Function','Release status']); writer.writerows(bom)
with (ROOT/'gpio-allocation.csv').open('w',newline='',encoding='utf-8-sig') as f:
    writer=csv.writer(f); writer.writerow(['Function','GPIO numbers - not physical pads','Constraint']); writer.writerows(pin_rows)

doc=SimpleDocTemplate(str(PDF),pagesize=landscape(A4),rightMargin=43,leftMargin=43,topMargin=43,bottomMargin=39,
                      title='Fovea meeting recorder - PCB architecture and schematic brief A0',author='Fovea / Codex')
story=[]
def title(kicker,text,sub):
    story.extend([p(kicker.upper(),'SmallA'),p(text,'TitleA'),p(sub,'SubtitleA')])
def para(text): story.append(p(text))
def page(): story.append(PageBreak())

title('Fovea / hardware development / 22 September 2026','Meeting recorder: custom PCB',
      'Revision A0 | Four microphones, one speaker | 3-5 metre room-pickup target')
para('<b>Engineering draft.</b> This packet defines the circuits and interfaces to design. It is not a completed pin-level schematic, PCB layout or manufacturing file set.')
story.append(architecture())
para('<b>Recommended first build:</b> a custom ESP32/power/storage main board plus a replaceable audio-processing board. Prove room pickup with an existing array before designing four individual microphone heads.')
para('Keep the smaller front display, volume and record buttons, USB-C charging, side-access microSD and a side-facing speaker. Final PCB and case dimensions follow the battery, audio assembly and display selection.')

page(); title('01 / audio architecture','Audio design for 3-5 metre pickup',
      'A microphone hears every audible source. Extra channels enable processing; they do not identify four people automatically.')
story.append(table([
    ['Route','Audio hardware','Trade-off'],
    ['A0 - recommended first prototype','ReSpeaker XVF3800 + custom ESP32 main PCB','Existing array and processing. Fastest way to evaluate the 3-5 m target; four microphones are built onto the module.'],
    ['A1 - custom mechanical design','XVF3800 reference design + four PDM mic heads','MIC1-MIC4 connectors and fixed positions around the case. More PCB design, firmware integration and acoustic tuning.'],
    ['B - lower-cost research route','ES7210 + four analog mic heads','Useful for synchronized raw capture. Needs more DSP development; not the default room-distance recommendation.']
], [171,253,330]))
story.append(Spacer(1,14))
para('<b>Candidate microphones:</b> IM69D130 PDM heads for A1; IM73A135 differential analog heads for B. These have different interfaces and are not interchangeable. A purchased array uses its own installed microphones.')
para('<b>Preserve conversation:</b> evaluate conference and command-processing outputs separately. Strong voice isolation can suppress a quiet participant; test alternating and overlapping speakers. Keep all four raw inputs only where the selected interface supports them.')
para('<b>Speaker echo:</b> send the same playback signal through the speaker path and the processor reference input. The firmware must match clock roles, sample rates and channel format. Existing firmware needs a new audio-board driver.')
story.append(p('Basis: <link href="https://www.xmos.com/xvf3800/" color="#12674b">XMOS XVF3800</link> and <link href="https://wiki.seeedstudio.com/respeaker_xvf3800_introduction/" color="#12674b">Seeed interface documentation</link>. Published range is not a guarantee in this enclosure.','SmallA'))

page(); title('02 / charging and shutdown','A real power button with safe file closure',
      'The processor, SD, display and audio loads switch off. Charging remains available while the device is off.')
story.append(power()); story.append(Spacer(1,12))
story.append(table([
    ['Circuit','Design requirement'],
    ['USB-C input','5 V sink, individual 5.1 kohm Rd on CC1 and CC2, ESD protection and verified input-current control. Isolate data/off-state back-power paths.'],
    ['Battery + charger','Protected one-cell pack; confirm polarity, thermistor, charge limits and thermal performance. BQ24074 is a candidate, not a released circuit.'],
    ['Main / audio supply','TPS63070 candidate for 3.3 V. A0 audio module needs an additional regulated, switched 5 V stage; its part and load budget are pending.'],
    ['Power button','LTC2954-1 + TPS22965 candidates: stop capture, finalize/flush SD, persist pending upload, mute, then remove system power. Forced-off recovery also needs testing.']
], [150,604]))
story.append(Spacer(1,10))
para('Do not wait for an internet upload to power off. Persistent recovery after a power cut still needs firmware work. A charger and button controller draw some standby current; this arrangement is not a mechanical battery disconnect.')

page(); title('03 / main-board interfaces','A GPIO budget that leaves the memory pins alone',
      'Proposed ESP32-S3-WROOM-1-N16R8 allocation. These are GPIO numbers, not physical package-pad numbers.')
story.append(table([['Function','GPIO(s)','Constraint']]+pin_rows,[225,116,413]))
story.append(Spacer(1,10))
story.append(p('Keep GPIO35-37 reserved for this module\'s octal PSRAM. Preserve GPIO0 boot behaviour; avoid peripheral loads on strap pins 3/45/46. A hardware designer must verify module-pad mapping, clocks, power domains and reset behaviour before capture/layout.','SmallA'))

page(); title('04 / components and assembly','Components for an assembled prototype',
      'Candidate parts for quoting. A0 and A1 audio rows are alternatives, not components to fit together.')
short_bom=[['Block','Candidate / assembly','Before release']]
for rows in [
    ('Processor','ESP32-S3-WROOM-1-N16R8','Antenna placement, decoupling and module pad mapping'),
    ('Audio','A0 module OR A1 XVF3800 + four PDM heads','Select reference design, firmware image, connector and acoustic geometry'),
    ('Power','BQ24074, LTC2954-1, TPS22965, TPS63070','Complete calculations, input policy, passives, thermals and isolation'),
    ('Audio-module supply','Additional switched 5 V converter for A0','Exact part, inductor and current budget pending'),
    ('Battery reporting','MAX17048 candidate','Pack characterization and off-state I2C isolation'),
    ('Screen','1.3-inch SPI / ST7789 direction','Exact panel SKU, connector and backlight driver'),
    ('Storage / USB','DM3AT microSD; USB4105 family candidates','Exact suffixes, footprints and mechanical clearances'),
    ('Connectors','Keyed battery, audio, display, speaker; A1 MIC1-MIC4','Harness polarity/current rating; no generic interchangeable sockets'),
    ('Controls','Power, Record/Stop, Volume +/-, BOOT, RESET','Six physical switches; service controls recessed'),
    ('Speaker / cell','Reuse only after electrical identification','Speaker 41 x 29 x 10 mm; cell 91 x 59 x 5 mm')
]: short_bom.append(rows)
story.append(table(short_bom,[125,268,361])); story.append(Spacer(1,12))
para('Ask the assembler to supply the soldered microphone boards and crimped cables. SPK+ and SPK- are an amplified pair; neither speaker wire is ground. A smaller screen alone cannot shrink the product below the current battery footprint.')

page(); title('05 / Malaysia handoff','Local prototype route and release checklist',
      'Research checked 22 September 2026. No order or message has been sent to a supplier.')
story.append(table([
 ['Lead','Why it is relevant','What to confirm'],
 ['Cytron Malaysia','ReSpeaker XVF3800 with enclosure, MPN 114993701: RM299; 3 shown when checked.','Live stock, exact revision and access to the integration connector.'],
 ['Jaavin / Rawang','Advertises PCB design, component sourcing, assembly and prototype testing.','Audio/XMOS experience, 2- and 5-unit quotes, design-file ownership.'],
 ['JAC Engineering / Cheras + Rawang','Advertises schematic/layout, fabrication, assembly and product testing.','Prototype MOQ, scope, lead time and fabrication location.']
], [145,325,284])); story.append(Spacer(1,12))
para('<b>Release sequence:</b> acoustic proof with array -> exact components and mechanical envelope -> pin-level schematic and electrical review -> four-layer PCB layout and DRC -> 2-5 assembled prototypes -> power, SD and room-audio acceptance tests.')
para('<b>Files the factory needs:</b> Gerber/drill files for bare boards, plus a full assembly BOM, pick-and-place and assembly drawings. Retain editable KiCad source and a STEP fit model. This PDF and a case STL cannot manufacture the electronics.')
para('<b>Acceptance:</b> record at 1, 3 and 5 m from four directions; repeat with air-conditioning, two voices and speaker playback. Check complete WAVs, upload retries, charging temperature, power-off on USB and recovery after forced shutdown.')
para('<b>Open decisions:</b> A0 module versus A1 custom array; exact cell and speaker ratings; display and connectors; audio power budget; enclosure size. Ask whether both fabrication and assembly are physically in Malaysia.')
story.append(p('Links: <link href="https://my.cytron.io/p-respeaker-xmos-xvf3800-with-case" color="#12674b">Cytron module</link> | <link href="https://www.jaavin.com/manufacturing" color="#12674b">Jaavin</link> | <link href="https://jac-eng.com/page/services" color="#12674b">JAC Engineering</link>. The companion SCHEMATIC_SPECIFICATION.md contains the engineering sources; REQUEST_FOR_QUOTATION.txt is ready to share.','SmallA'))

def footer(canvas, doc):
    canvas.saveState(); w,h=landscape(A4)
    canvas.setStrokeColor(EDGE); canvas.line(43,30,w-43,30)
    canvas.setFillColor(MUTED); canvas.setFont('Helvetica',8)
    canvas.drawString(43,18,'FOVEA  /  PCB A0  /  ENGINEERING DRAFT - NOT FOR FABRICATION')
    canvas.drawRightString(w-43,18,str(doc.page)); canvas.restoreState()

doc.build(story,onFirstPage=footer,onLaterPages=footer)
renderSVG.drawToFile(architecture(),str(ROOT/'system-architecture.svg'))
print(PDF)
