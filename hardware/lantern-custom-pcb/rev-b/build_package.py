"""Export the draft to editable KiCad sheets, readable PDF and component tables.

KiCad files follow the published S-expression format. Native KiCad/ERC is not
installed here: the included validator checks structure/connectivity only.
"""
from pathlib import Path
import json, csv, uuid, math, textwrap, re
from collections import Counter, defaultdict
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.utils import ImageReader
from design import *
from detail_pages import add_detail_pages

KICAD=OUT/'schematics';KICAD.mkdir(exist_ok=True)
PDFDIR=REPO/'output/pdf';PDFDIR.mkdir(exist_ok=True)
PDF=PDFDIR/'Fovea-B0-board-and-electrical-design.pdf'
GREEN=HexColor('#12674b');DARK=HexColor('#183027');GRAY=HexColor('#5d7067');PALE=HexColor('#ecf4ef');AMBER=HexColor('#8c531c')
UID=lambda text:str(uuid.uuid5(uuid.NAMESPACE_URL,'fovea-b0/'+text))
Q=lambda text:json.dumps(str(text),ensure_ascii=True)
ROOT_ID=UID('root')
PROJECT='Fovea-B0'
calc=calculate()

def pin_type(p,pin):
    name=pin['name']
    if not p['ref'].startswith('U'):return 'passive'
    if name in ['VCC','VDD','3V3','VIN','VBIAS','IN','GND','VSS','PGND','EP','CTG']:return 'power_in'
    if name in ['EN','EN_N','CE','EN1','EN2','S','OE_N','A','B','PORT','ADDR','KILL','PB','ONT','PDT','CT','ISET','ILIM','ITERM','TMR','TS','QSTRT','FB','VSEL','PS_SYNC']:return 'input'
    if name in ['CHG','PGOOD','PG','INT','SDA','ALRT','OUT1','OUT2','OUT3']:return 'open_collector'
    if name in ['VOUT','OUT','VAUX']:return 'power_out'
    if name=='Y':return 'output'
    return 'bidirectional'

def layout_parts(parts):
    # Millimetres on A3 landscape, with 3 columns and reserved footer space.
    pages=[];placed=[];col=0;y=48
    for p in parts:
        h=max(6.35,(len(p['pins'])-1)*2.54+5.08)
        block=h+12
        if y+block>258:
            col+=1;y=48
        if col==3:
            pages.append(placed);placed=[];col=0;y=48
        placed.append(dict(part=p,x=87+col*135,y=y+h/2,h=h))
        y+=block
    if placed:pages.append(placed)
    return pages

def lib_symbol(p,h):
    ref=p['ref'];body=[f'(symbol "Fovea:{ref}" (pin_names (offset 0.508)) (in_bom yes) (on_board yes)',
        f'(property "Reference" {Q(ref)} (at 0 {h/2+3} 0) (effects (font (size 1.27 1.27))))',
        f'(property "Value" {Q(p["value"])} (at 0 {h/2+6} 0) (effects (font (size 1.27 1.27))))',
        f'(symbol "{ref}_0_1" (rectangle (start -19.05 {h/2}) (end 19.05 {-h/2}) (stroke (width 0.254) (type default)) (fill (type background))))',
        f'(symbol "{ref}_1_1"']
    for i,pin in enumerate(p['pins']):
        y=(len(p['pins'])-1)*1.27-i*2.54
        body.append(f'(pin {pin_type(p,pin)} line (at -24.13 {y:.4f} 0) (length 5.08) (name {Q(pin["name"])} (effects (font (size 1.016 1.016)))) (number {Q(pin["number"])} (effects (font (size 1.016 1.016)))))')
    return '\n'.join(body+['))'])

def write_sheet(group,index,placed,page_no):
    filename=f'{group}_{index+1}.kicad_sch';sid=UID(filename);path=f'/{ROOT_ID}/{sid}'
    lines=[f'(kicad_sch (version 20230121) (generator "fovea_draft_generator") (uuid {Q(UID(filename+"-document"))}) (paper "A3")',
           f'(title_block (title {Q(GROUPS[group])}) (date "2026-09-22") (rev "B0-DRAFT") (company "Fovea") (comment 1 "NOT FOR FABRICATION - footprint mapping / ERC / routing pending"))',
           '(lib_symbols',*[lib_symbol(v['part'],v['h']) for v in placed],')',
           f'(text "DRAFT / ALL MATCHING GLOBAL NET LABELS CONNECT" (at 15 17 0) (effects (font (size 2 2)) (justify left)) (uuid {Q(UID(filename+"title"))}))']
    for j,note in enumerate(NOTES[group][:3]):
        lines.append(f'(text {Q(note)} (at 15 {24+j*4.5} 0) (effects (font (size 1.3 1.3)) (justify left)) (uuid {Q(UID(filename+"note"+str(j)))}))')
    for v in placed:
        p,x,y,h=v['part'],v['x'],v['y'],v['h'];ref=p['ref']
        for i,pin in enumerate(p['pins']):
            px=x-24.13;py=y-(len(p['pins'])-1)*1.27+i*2.54
            key=ref+':'+pin['number']
            if pin['net'] is None:
                lines.append(f'(no_connect (at {px:.4f} {py:.4f}) (uuid {Q(UID(key+"NC"))}))')
            else:
                lx=px-5.08
                lines.append(f'(wire (pts (xy {px:.4f} {py:.4f}) (xy {lx:.4f} {py:.4f})) (stroke (width 0) (type default)) (uuid {Q(UID(key+"wire"))}))')
                lines.append(f'(global_label {Q(pin["net"])} (shape bidirectional) (at {lx:.4f} {py:.4f} 0) (effects (font (size 1.016 1.016)) (justify right)) (uuid {Q(UID(key+"label"))}))')
        lines.append(f'(symbol (lib_id "Fovea:{ref}") (at {x} {y:.4f} 0) (unit 1) (in_bom yes) (on_board yes) (dnp no) (uuid {Q(UID(ref))})')
        lines.append(f'(property "Reference" {Q(ref)} (at {x-19.05} {y-h/2-5.4:.4f} 0) (effects (font (size 1.27 1.27)) (justify left)))')
        lines.append(f'(property "Value" {Q(p["value"])} (at {x-19.05} {y-h/2-2.6:.4f} 0) (effects (font (size 1.27 1.27)) (justify left)))')
        lines.append(f'(property "Footprint" "" (at {x} {y} 0) (effects (font (size 1.27 1.27)) hide))')
        for pin in p['pins']:lines.append(f'(pin {Q(pin["number"])} (uuid {Q(UID(ref+":"+pin["number"]+":pin"))}))')
        lines.append(f'(instances (project {Q(PROJECT)} (path {Q(path)} (reference {Q(ref)}) (unit 1)))) )')
    lines.append(')')
    (KICAD/filename).write_text('\n'.join(lines),encoding='utf-8')
    return dict(filename=filename,uuid=sid,page=page_no,group=group,placed=placed)

sheets=[]
for g in GROUPS:
    for i,placed in enumerate(layout_parts([p for p in PARTS if p['group']==g])):
        sheets.append(write_sheet(g,i,placed,len(sheets)+2))
root=[f'(kicad_sch (version 20230121) (generator "fovea_draft_generator") (uuid {Q(ROOT_ID)}) (paper "A3")',
 '(title_block (title "Fovea B0 - circuit draft") (date "2026-09-22") (rev "B0-DRAFT") (company "Fovea"))',
 '(lib_symbols)',f'(text "ENGINEERING DRAFT - NO ROUTED PCB - ERC / FOOTPRINT REVIEW REQUIRED" (at 20 20 0) (effects (font (size 2 2)) (justify left)) (uuid {Q(UID("root-note"))}))']
for i,s in enumerate(sheets):
    x=22+(i%3)*130;y=45+(i//3)*55
    root.append(f'(sheet (at {x} {y}) (size 115 35) (stroke (width 0.254) (type default)) (fill (color 0 0 0 0)) (uuid {Q(s["uuid"])}) (property "Sheetname" {Q(GROUPS[s["group"]])} (at {x} {y-3} 0) (effects (font (size 1.27 1.27)) (justify left))) (property "Sheetfile" {Q(s["filename"])} (at {x} {y+38} 0) (effects (font (size 1.27 1.27)) (justify left))) (instances (project {Q(PROJECT)} (path {Q("/"+ROOT_ID)} (page {Q(s["page"])})))))')
root+=['(sheet_instances (path "/" (page "1")))',')']
(KICAD/(PROJECT+'.kicad_sch')).write_text('\n'.join(root),encoding='utf-8')

with (OUT/'component-schedule.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.writer(f);w.writerow(['Reference','Value / candidate','Package / envelope','Status','Notes'])
    for p in PARTS:w.writerow([p['ref'],p['value'],p['package'],p['status'],p['note']])
with (OUT/'pin-connections.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.writer(f);w.writerow(['Reference','Physical pin / defined connector contact','Pin name','Net'])
    for p in PARTS:
        for pin in p['pins']:w.writerow([p['ref'],pin['number'],pin['name'],pin['net'] or 'NC'])
(OUT/'connections.json').write_text(json.dumps(dict(groups=GROUPS,notes=NOTES,parts=PARTS,sources=SOURCES),indent=2),encoding='utf-8')
(OUT/'power-calculations.json').write_text(json.dumps(calc,indent=2),encoding='utf-8')

# A3 electrical packet: practical summary followed by the same component-to-net drawings.
c=canvas.Canvas(str(PDF),pagesize=landscape(A3));PW,PH=landscape(A3);MM=72/25.4
c.setTitle('Fovea B0 - 3D board and electrical design draft');c.setAuthor('Fovea')
page_number=0
def begin(title,sub=''):
    global page_number
    page_number+=1
    bookmark=f'page-{page_number}'
    c.bookmarkPage(bookmark)
    c.addOutlineEntry(title,bookmark,level=0)
    c.setFillColor(GREEN);c.setFont('Helvetica-Bold',11);c.drawString(42,PH-36,'FOVEA / HARDWARE ENGINEERING / B0')
    c.setFillColor(DARK);c.setFont('Helvetica-Bold',27);c.drawString(42,PH-74,title)
    c.setFillColor(GRAY);c.setFont('Helvetica',10);c.drawString(42,PH-94,sub)
    c.setStrokeColor(HexColor('#c4d6cb'));c.line(42,34,PW-42,34)
    c.setFont('Helvetica',8);c.drawString(42,22,'22 SEPTEMBER 2026  |  REVIEW DRAFT - NOT FOR FABRICATION  |  CURRENTS ARE BUDGETS, NOT MEASUREMENTS')
    c.drawRightString(PW-42,22,str(page_number))
def text(x,y,s,size=11,bold=False,col=DARK):
    c.setFillColor(col);c.setFont('Helvetica-Bold' if bold else 'Helvetica',size);c.drawString(x,y,s)
def wrap(x,y,s,width=90,size=11,leading=16):
    for line in textwrap.wrap(s,width=width):text(x,y,line,size);y-=leading
    return y
def rows(data,y,widths):
    x0=42;lineheight=31
    for i,row in enumerate(data):
        c.setFillColor(GREEN if i==0 else (PALE if i%2 else HexColor('#ffffff')));c.rect(x0,y-lineheight,sum(widths),lineheight,fill=1,stroke=0)
        x=x0
        for j,item in enumerate(row):
            text(x+10,y-20,str(item),10,i==0,HexColor('#ffffff') if i==0 else DARK);x+=widths[j]
        y-=lineheight
    return y

begin('Custom board, microphone array and controls','A dimensioned placement model plus an editable circuit draft. The microphone module is the agreed first-prototype route.')
if (OUT/'assembly.png').exists():c.drawImage(str(OUT/'assembly.png'),35,100,width=650,height=600,preserveAspectRatio=True,anchor='c',mask='auto')
y=PH-147
for head,body in [
 ('MAIN PCB','110 x 158 x 1.6 mm. Proposed four-layer board; copper is not routed.'),
 ('AUDIO','100 mm ReSpeaker XVF3800 module. Four installed microphones in a 66 mm square. One side-facing speaker.'),
 ('SCREEN AND BATTERY','1.3-inch SPI module envelope; measured 91 x 59 x 5 mm battery below the main board.'),
 ('SIX BUTTONS','Power, Record/Stop, Volume +, Volume -, BOOT and RESET. Switch actuators and case caps need final part selection.'),
 ('MODEL ACCURACY','Board outline is dimensioned. Component bodies, supports and wiring are clearance models; connector mates and screen holes are not released.'),
 ('MANUFACTURING STATUS','No Gerbers, routed PCB, ERC pass or physical validation. Use this package for engineering review, not a PCB order.')]:
    text(719,y,head,12,True,GREEN);y-=20;y=wrap(719,y,body,55,11,16)-26
c.showPage()

# Reader-facing board maps, connected circuit diagrams and terminal schedules.
add_detail_pages(c,begin)

begin('Voltage and current budget','Engineering allocations include conversion losses and simultaneous loads; actual selected hardware must be measured.')
data=[['Load','Rail','Recording','Peak allocation','Basis']]
for name,v,normal,peak,note in LOADS:data.append([name,f'{v:.1f} V',f'{normal*1000:.0f} mA',f'{peak*1000:.0f} mA',note[:66]])
y=rows(data,PH-123,[235,80,110,125,550])-28
data=[['Design result','Calculated value','Meaning / limit'],
 ['3.3 V regulated rail','0.33 A recording / 0.85 A peak','Select and validate a >=1.0 A output stage across battery range.'],
 ['5 V audio rail','0.30 A recording / 0.871 A peak','RGB LEDs off; speaker limited to the assumed 2 W test output.'],
 ['Battery during recording',f'{calc["cases"]["record"]["battery_A"]:.2f} A / {calc["cases"]["record"]["battery_W"]:.2f} W','At 3.7 V, 90% conversion efficiency, 0.15 ohm total path.'],
 ['Battery at simultaneous peak',f'{calc["cases"]["combined_peak"]["battery_A"]:.2f} A / {calc["cases"]["combined_peak"]["battery_W"]:.2f} W','At 3.2 V, 85% efficiency, 0.15 ohm path; >=4 A pack/harness target.'],
 ['USB-C input limit',f'{calc["usb_input_A"]:.2f} A nominal / {calc["usb_input_max_A"]:.2f} A upper estimate','Only after >=1.5 A Type-C advertisement; default mode is 100 mA.'],
 ['Battery charging',f'{calc["charge_A"]:.2f} A nominal; {calc["charge_min_A"]:.3f}-{calc["charge_max_A"]:.3f} A estimate','Protected 4.2 V cell and correct NTC mandatory; pack spec still open.'],
 ['Illustrative runtime',f'{calc["runtime_record_h"]:.1f} hours','Assumes 4 Ah at 3.7 V and 80% usable energy; not a measured promise.'],
 ['Charge duration','8 h ideal constant-current portion','CV taper, load sharing and temperature make full charging longer.']]
y=rows(data,y,[240,285,575])-23
wrap(42,y,'Peak speaker playback can exceed USB input power: battery supplement is required. This design does not promise maximum operation from an empty battery or a weak USB port. Do not infer a battery discharge rating from its mAh capacity.',150,11)
c.showPage()

begin('Calculations and power-button behaviour','Values are derived from datasheets and explicit assumptions. They are not substitutes for load, thermal and stability tests.')
left=42;right=622;y=PH-136
items=[
 ('Charge current','I = 890 / 1780 = 0.500 A. Including IC factor and 1% resistor extremes: 0.443-0.553 A.'),
 ('USB current limit','I = 1610 / 1240 = 1.298 A. Worst factor / low resistor estimate = 1.401 A, below 1.5 A.'),
 ('3.3 V feedback','V = 0.8 x (1 + 470k / 150k) = 3.307 V. Static tolerance estimate 3.269-3.345 V.'),
 ('5 V feedback','V = 0.8 x (1 + 680k / 130k) = 4.985 V. Static tolerance estimate 4.926-5.043 V.'),
 ('Battery path','Solve I x (Vbat - I x Rpath) = Pload / efficiency. Rpath = 0.15 ohm is an assumed total, not a measured value.'),
 ('Speaker','At 2 W into 4 ohm: 2.83 Vrms, 0.707 Arms, 1.00 A sine peak in speaker wires. Neither wire is ground.'),
 ('Buttons and bus','Volume/record 10k pull-up + 1k series: 0.30 mA held, input low 0.30 V. I2C 4.7k: 0.70 mA low; ~398 ns rise at assumed 100 pF. Start at 100 kHz.'),
 ('Recording storage','16 kHz x 16-bit mono = 32,000 bytes/s = 1.831 MiB/minute, plus the WAV header.')]
for i,(head,body) in enumerate(items):
    x=left if i<4 else right;yy=y-(i%4)*126
    text(x,yy,head,14,True,GREEN);wrap(x,yy-23,body,73,11,17)
text(42,158,'POWER BUTTON',13,True,GREEN)
wrap(42,135,'Hold about 0.33 s to start. A normal press raises an interrupt: stop capture, finalize/flush WAV, persist upload state, mute, then drive POWER_HOLD low. Holding about 6.48 s forces off if firmware hangs. Timer tolerances apply. The charging/control circuits stay alive.',150,11,17)
text(42,67,'GPIO18 must be open-drain. The 100k switched-rail pull-up avoids depending on fast firmware boot to stay powered.',10,True,AMBER)
c.showPage()

begin('Checks that must close before fabrication','The calculated budget identifies concrete design risks. These remain release gates for the hardware engineer.')
issues=[
 ('REGULATOR STABILITY',f'Estimated boost right-half-plane zeros at simultaneous peak: {calc["regulator"]["3.3"]["rhp_zero_Hz"]/1000:.0f} kHz and {calc["regulator"]["5.0"]["rhp_zero_Hz"]/1000:.0f} kHz. Both are below TI\'s 400 kHz guideline. Select effective output capacitance and prove loop/load-step stability; the shown 76 uF nominal bank is not a validated solution.'),
 ('CHARGER TEMPERATURE','At 5 V USB, 0.5 A charging and the recording budget: approximately 1.04 W charger heat at a 3.7 V cell, or 1.39 W at 3.0 V. Using datasheet 44.5 C/W and 40 C ambient gives about 86 C / 102 C junction. Actual PCB/enclosure can be hotter; review charge-current reduction or a switching charger.'),
 ('LOW BATTERY AND BURSTS','The peak case predicts only 2.74 V at converter inputs and 1.42 W in the assumed series path. Measure voltage droop and pack protection behaviour. Enforce battery/volume limits before accepting uninterrupted recording at this load.'),
 ('UNKNOWN MODULE LOAD','The audio-module current is an allowance. Measure its startup, capture, playback and LED loads. If it exceeds the allocation, revise both converters, charging path and runtime estimate.'),
 ('CONNECTOR AND FOOTPRINT RELEASE','USB suffix, battery pack/harness, SD shell/detect pads, display SKU, audio-module mating pin map, switch actuators and ESD/fuse selection remain open. Symbol net numbering alone does not define a physical connector.'),
 ('POWER-OFF / FIRMWARE / RF','Validate no USB, gauge, debug or audio-module service-cable back-powering. Add the custom-board firmware profile and SD shutdown recovery. Keep battery, copper and metal away from the module antenna; verify the final RF keepout in CAD.'),
 ('ENGINEERING VALIDATION','Run KiCad ERC with reviewed electrical pin types, assign verified footprints, route a four-layer board and run DRC. Test rails, battery temperature, USB source changes, SD integrity, recording range and echo cancellation. No native KiCad/ERC or hardware test has run here.')]
y=PH-139
for head,body in issues:
    text(42,y,head,12,True,GREEN);y=wrap(42,y-21,body,159,11,16)-25
c.showPage()

def draw_component(v):
    p,x,y,h=v['part'],v['x']*MM,PH-v['y']*MM,v['h']*MM
    bx=x-19.05*MM;top=y+h/2
    text(bx,top+5.4*MM,p['ref'],7,True,GREEN)
    text(bx,top+2.5*MM,p['value'],6.3)
    c.setStrokeColor(GRAY);c.setFillColor(PALE);c.setLineWidth(.6);c.rect(bx,y-h/2,38.1*MM,h,fill=1,stroke=1)
    for i,pin in enumerate(p['pins']):
        py=y+(len(p['pins'])-1)*1.27*MM-i*2.54*MM
        px=x-24.13*MM;lx=px-5.08*MM
        c.setStrokeColor(GREEN);c.line(px,py,bx,py)
        text(bx+3,py-2,pin['name'],5.7)
        text(px+1,py+1.4,pin['number'],4.7,False,GRAY)
        if pin['net']:
            c.line(lx,py,px,py);c.setFont('Helvetica',5.8);c.setFillColor(GREEN);c.drawRightString(lx-2,py-2,pin['net'])
        else:
            c.line(px-2,py-2,px+2,py+2);c.line(px-2,py+2,px+2,py-2)

for sheet in sheets:
    begin(GROUPS[sheet['group']],f'Editable sheet: {sheet["filename"]} | Matching net labels are electrically connected across all sheets. NC pins carry an X.')
    # Coordinates reserve the top header, with notes below the component grid.
    for v in sheet['placed']:draw_component(v)
    for i,note in enumerate(NOTES[sheet['group']]):text(42,91-i*12,note,8,False,GRAY)
    c.showPage()

begin('References, files and review handoff','Public manufacturer references checked on 22 September 2026. This document does not redistribute manufacturer schematics.')
y=PH-137
for name,url in SOURCES.items():
    text(42,y,name,11,True,GREEN);text(210,y,url,9);c.linkURL(url,(210,y-2,PW-42,y+11),relative=0);y-=29
y-=24
wrap(42,y,'The package includes STEP and GLB assemblies, a Blender scene, three rendered views, the board-outline STL, editable KiCad schematic sheets, component and pin tables, a calculated power budget, and the generating source. The outline STL is a physical fit dummy only: printing it does not produce an electronic PCB.',145,12,18)
y-=110
wrap(42,y,'Next engineering release: freeze the actual display, battery, speaker and connectors; resolve power stability and thermal results; verify symbols/footprints and native ERC; route and review copper; produce Gerbers, drill, BOM and pick-and-place only after that review.',145,12,18)
c.showPage();c.save()

# Reproducible checks on the data, separate from native CAD/physical verification.
refs=[p['ref'] for p in PARTS];assert len(refs)==len(set(refs))
nets=defaultdict(list)
for p in PARTS:
    numbers=[q['number'] for q in p['pins']];assert len(numbers)==len(set(numbers)),p['ref']
    for pin in p['pins']:
        if pin['net']:nets[pin['net']].append((p['ref'],pin['number']))
assert all(len(nodes)>=2 for nodes in nets.values()),{n:v for n,v in nets.items() if len(v)<2}
assert not set([3,35,36,37,45,46]) & set(gp)
assert calc['usb_input_max_A']<1.5
assert all(calc['regulator'][v]['required_Isat_20pct_A']<4.6 for v in ('3.3','5.0'))

def balanced_sexpr(s):
    depth=0;quoted=False;escaped=False
    for ch in s:
        if escaped:escaped=False;continue
        if quoted and ch=='\\':escaped=True;continue
        if ch=='"':quoted=not quoted;continue
        if not quoted:
            depth+=(ch=='(')-(ch==')')
            assert depth>=0
    assert depth==0 and not quoted
all_ids=[]
for file in KICAD.glob('*.kicad_sch'):
    content=file.read_text()
    balanced_sexpr(content)
    all_ids+=re.findall(r'\(uuid "([a-z0-9-]+)"\)',content)
assert len(all_ids)==len(set(all_ids)), 'Duplicate schematic object UUID'
validation=dict(component_count=len(PARTS),net_count=len(nets),schematic_sheets=len(sheets)+1,pdf_pages=page_number,
 checks=['Unique component references, pin numbers and schematic object UUIDs','Every named net has at least two terminals','GPIO reservation check','USB limit tolerance bound','Inductor saturation budget','Balanced schematic S-expressions'],
 NOT_performed=['Native KiCad opening / ERC','PCB routing / DRC','Spice or regulator-loop simulation','Physical measurements'],
 open_release_gates=['Regulator loop stability below 400kHz RHPZ guideline','Charger thermal behaviour','Battery rating and low-voltage droop','Measured module loads','Footprints and connector mapping'])
(OUT/'electrical-validation.json').write_text(json.dumps(validation,indent=2),encoding='utf-8')
print(PDF);print(json.dumps(validation,indent=2))
