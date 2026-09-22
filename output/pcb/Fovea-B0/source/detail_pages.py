"""Illustrated wiring and placement guide, derived from the same circuit data.

Logical connector numbering is intentionally separated from unreleased footprints.
Vector diagrams supplement, rather than replace, the complete component net sheets.
"""
import json, math
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase.pdfmetrics import stringWidth
from design import PARTS, OUT, gp

INK=HexColor('#183027'); GREEN=HexColor('#12674b'); PALE=HexColor('#edf5ef')
GRAY=HexColor('#5d7067'); BLUE=HexColor('#216786'); AMBER=HexColor('#93521e')
BYREF={p['ref']:p for p in PARTS}
PIN={p['ref']:{q['number']:q for q in p['pins']} for p in PARTS}

class Guide:
    def __init__(self,c,begin):self.c=c;self.begin=begin
    def txt(self,x,y,t,size=10,bold=False,color=INK,align='left'):
        c=self.c;c.setFillColor(color);c.setFont('Helvetica-Bold' if bold else 'Helvetica',size)
        getattr(c,{'left':'drawString','right':'drawRightString','center':'drawCentredString'}[align])(x,y,str(t))
    def para(self,x,y,t,width=480,size=11,leading=16,color=INK):
        line=''
        for word in t.split():
            trial=(line+' '+word).strip()
            if line and stringWidth(trial,'Helvetica',size)>width:
                self.txt(x,y,line,size,color=color);y-=leading;line=word
            else:line=trial
        if line:self.txt(x,y,line,size,color=color);y-=leading
        return y
    def line(self,pts,color=GREEN,width=1.2,dash=False):
        c=self.c;c.setStrokeColor(color);c.setLineWidth(width);c.setDash(4,3) if dash else c.setDash()
        p=c.beginPath();p.moveTo(*pts[0])
        for xy in pts[1:]:p.lineTo(*xy)
        c.drawPath(p);c.setDash()
    def dot(self,x,y,color=GREEN):
        self.c.setFillColor(color);self.c.circle(x,y,2.4,fill=1,stroke=0)
    def arrow(self,pts,label='',color=BLUE):
        self.line(pts,color)
        (x0,y0),(x,y)=pts[-2:];a=math.atan2(y-y0,x-x0)
        self.line([(x-8*math.cos(a-.45),y-8*math.sin(a-.45)),(x,y),(x-8*math.cos(a+.45),y-8*math.sin(a+.45))],color)
        if label:self.txt((x0+x)/2,(y0+y)/2+9,label,9,color=color,align='center')
    def box(self,x,y,w,h,title,lines=(),color=PALE):
        c=self.c;c.setFillColor(color);c.setStrokeColor(GREEN);c.setLineWidth(.9);c.roundRect(x,y,w,h,5,fill=1,stroke=1)
        self.txt(x+12,y+h-21,title,12,True,GREEN)
        yy=y+h-40
        for s in lines:yy=self.para(x+12,yy,s,w-24,10,14)
    def table(self,x,y,widths,heads,rows,fs=9.5,rh=25):
        c=self.c;allrows=[heads]+rows
        for n,row in enumerate(allrows):
            c.setFillColor(GREEN if n==0 else (PALE if n%2 else white));c.rect(x,y-rh,sum(widths),rh,fill=1,stroke=0)
            xx=x
            for item,w in zip(row,widths):
                f=fs
                while stringWidth(str(item),'Helvetica-Bold' if n==0 else 'Helvetica',f)>w-14 and f>7:f-=.2
                self.txt(xx+7,y-rh/2-3.3,item,f,n==0,white if n==0 else INK);xx+=w
            y-=rh
        return y
    def ground(self,x,y):
        self.line([(x,y),(x,y-8)])
        for k,w in enumerate([16,10,4]):self.line([(x-w/2,y-8-k*4),(x+w/2,y-8-k*4)])
    def resistor(self,x1,y1,x2,y2,label,below=False):
        # Horizontal or vertical IEC resistor; terminal coordinates are endpoints.
        if y1==y2:
            mid=(x1+x2)/2;self.line([(x1,y1),(mid-15,y1)]);self.line([(mid+15,y1),(x2,y2)])
            self.c.setStrokeColor(GREEN);self.c.setFillColor(white);self.c.rect(mid-15,y1-5,30,10,fill=1,stroke=1)
            self.txt(mid,y1-20 if below else y1+12,label,9,align='center')
        else:
            mid=(y1+y2)/2;self.line([(x1,y1),(x1,mid+13)]);self.line([(x1,mid-13),(x2,y2)])
            self.c.setStrokeColor(GREEN);self.c.setFillColor(white);self.c.rect(x1-5,mid-13,10,26,fill=1,stroke=1)
            self.txt(x1+11,mid,label,9)
    def capacitor(self,x,y,label):
        self.line([(x,y),(x,y-17)]);self.line([(x-10,y-17),(x+10,y-17)]);self.line([(x-10,y-24),(x+10,y-24)])
        self.line([(x,y-24),(x,y-38)]);self.ground(x,y-38);self.txt(x+14,y-20,label,9)
    def switch(self,x,y,label):
        self.line([(x,y),(x,y-13)]);self.line([(x,y-34),(x,y-46)])
        self.c.setStrokeColor(GREEN);self.c.circle(x,y-13,2,fill=0);self.c.circle(x,y-34,2,fill=0)
        self.line([(x,y-34),(x+13,y-15)]);self.ground(x,y-46);self.txt(x+20,y-24,label,10,True)
    def pinbox(self,x,y,w,h,ref,left,right):
        self.box(x,y,w,h,ref,[BYREF[ref]['value']])
        nodes={}
        for side,pins in [('left',left),('right',right)]:
            for n,(num,dy) in enumerate(pins):
                yy=y+dy;pp=PIN[ref][str(num)];edge=x if side=='left' else x+w;ext=edge+(-25 if side=='left' else 25)
                self.line([(edge,yy),(ext,yy)])
                self.txt(edge+8 if side=='left' else edge-8,yy+3,f'{num} {pp["name"]}',8,align='left' if side=='left' else 'right')
                nodes[str(num)]=(ext,yy)
        return nodes
    def finish(self):self.c.showPage()

def model_plan(g,hide=False):
    """Draw model envelopes in true XY arrangement, not a footprint illustration."""
    data=json.loads((OUT/'model-manifest.json').read_text());scale=3.35;cx,cy=322,430
    def pos(x,y):return cx+x*scale,cy+y*scale
    c=g.c;c.setFillColor(PALE);c.setStrokeColor(GREEN);c.roundRect(cx-55*scale,cy-79*scale,110*scale,158*scale,12,fill=1,stroke=1)
    if not hide:
        c.setStrokeColor(GRAY);c.setFillColor(HexColor('#d3ddd7'));c.circle(*pos(0,25),50*scale,fill=1,stroke=1)
        for k,(x,y) in enumerate([(-33,-8),(33,-8),(33,58),(-33,58)],1):
            px,py=pos(x,y);c.setFillColor(white);c.circle(px,py,10,fill=1,stroke=1);g.txt(px,py-3,'M'+str(k),8,True,align='center')
        g.txt(*pos(0,35),'FOUR-MIC MODULE',13,True,align='center');g.txt(*pos(0,28),'100 mm diameter',10,align='center')
        sx,sy=pos(-16,-70);c.setFillColor(HexColor('#216f57'));c.rect(sx,sy,42*scale,42*scale,fill=1,stroke=1)
        g.txt(*pos(5,-46),'SCREEN',14,True,white,align='center');g.txt(*pos(5,-53),'faces upward',10,color=white,align='center')
    shown=['USB_C_charge_program','microSD_socket','ESP32_module','side_speaker_41x29x10']
    if hide:shown += ['battery_socket','audio_harness_socket','speaker_in_socket','speaker_out_socket','display_socket']
    for p in data['parts']:
        if p['name'] in shown or p['kind']=='button' and p['name'].endswith('_body') or hide and re_chip(p['name']):
            a,b=p['bounds'];x,y=pos(a[0],a[1]);w,h=(b[0]-a[0])*scale,(b[1]-a[1])*scale
            c.setFillColor(HexColor('#c7d6ce') if not re_chip(p['name']) else GREEN);c.setStrokeColor(GRAY);c.rect(x,y,w,h,fill=1,stroke=1)
    for title,x,y in [('USB-C',-54,34),('SD',49,-13),('U9',-42,-63),('SW1',48,61),('SW2',-40,-38),('SW3',-30,-38),('SW4',45,-32),('SW5',45,-64),('SW6',45,-48)]:
        px,py=pos(x,y)
        if title=='USB-C':g.txt(px-13,py,title,9,True,align='right')
        elif title=='SD':g.txt(px+24,py,title,9,True)
        else:g.txt(px,py+15,title,8,True,align='center')
    if hide:
        for ref,x,y in [('J2',40,20),('J5',9,-24),('J6',20,59),('J7',-47,-3),('J8',-48,-15)]:
            px,py=pos(x,y);g.txt(px,py+16,ref,10,True,align='center')
        for title,x,y in [('CHARGE / USB',-28,31),('3.3 V / 5 V',-13,-11),('POWER CONTROL',33,66),('GAUGE U11',35,1)]:g.txt(*pos(x,y),title,8,True,align='center')
    # Actual module antenna faces the bottom edge; draw the keepout as an indication only.
    px,py=pos(-51,-81.75);c.setStrokeColor(AMBER);c.setDash(3,2);c.rect(px,py,18*scale,6*scale,fill=0,stroke=1);c.setDash()
    g.txt(322,138,'110 mm board width',11,True,align='center');g.line([(cx-55*scale,150),(cx+55*scale,150)],GRAY)
    g.txt(42,706,'TOP END',10,True,GREEN);g.txt(42,687,'+Y',9,color=GRAY)
    g.txt(42,116,'XY drawing follows the current 3D model. Not a drill or copper plot.',9,color=GRAY)
    return pos

def re_chip(name):return name.startswith('U') and name[1:2].isdigit() or name.startswith('Q1_')

def physical_pages(g):
    g.begin('Board map: what faces upward','View from above, with the recorder lying flat on a table. References match the circuit sheets later in this PDF.')
    model_plan(g)
    y=704
    blocks=[('MICROPHONES M1-M4','The four small microphones sit on the round XVF3800 board. Their acoustic openings and the screen face the same upward direction. The round board is not a speaker.'),
            ('USB-C J1: LEFT EDGE','The existing model puts the charging/programming connector on the left edge. A cable enters horizontally. Keep the opening and plug clearance clear of the microphone grille.'),
            ('CARD J4: RIGHT EDGE','The microSD card slides out through the right side. Leave space for the card, fingertip and push-push travel in the enclosure.'),
            ('SPEAKER: LEFT SIDE','The measured oval speaker faces outward through a side grille, below the USB-C area. Neither the table nor the back cover should cover its sound opening.'),
            ('BATTERY: UNDER THE MAIN BOARD','The 91 x 59 x 5 mm pouch is beneath insulating support. Allow retention, wire clearance and pack tolerance without compressing the pouch.'),
            ('DO NOT MOVE THE FOUR SENSORS INDIVIDUALLY','This purchased module fixes the microphone spacing. Keep the screen and solid case ribs away from the four acoustic openings. Loose microphones would require a different design.')]
    for title,body in blocks:
        g.txt(632,y,title,12,True,GREEN);y=g.para(632,y-22,body,505,11,16)-22
    g.finish()

    g.begin('Under the array: main-board component locations','Audio module and display removed in this view. Positions are nominal envelopes, not approved footprints.')
    model_plan(g,True)
    rows=[['J1','USB-C, left edge','-53, +30'],['J2','Battery + NTC, upper right','+40, +20'],['J3','UART service pads','Unplaced'],['J4','microSD socket, right edge','+49, -13'],['J5','Display harness, below array','+9, -24'],['J6','Audio logic harness, upper right','+20, +59'],['J7 / J8','Amplifier in / speaker out, left','-47,-3 / -48,-15'],['U1 / U2','Charger / USB-C current detector','-30,+11 / -43,+13'],['U5 / U6','Power controller / load switch','+38,+60 / +34,+48'],['U7 / U8','3.3 V / 5 V converters','-19,+11 / -7,+11'],['U9','ESP32-S3 module, lower left','-42, -69'],['U10 / U11','USB isolation / battery gauge','-38,-24 / +35,+8'],['U3 / U4 / U12 / Q1','USB suspend/current logic','See model envelopes'],['SW1','Power, upper right','+48, +61'],['SW2 / SW3','BOOT / RESET, lower left','-40,-38 / -30,-38'],['SW4 / SW6 / SW5','Volume + / Record / Volume -','+45,-32 / -48 / -64']]
    y=g.table(608,712,[108,265,165],['Ref','What / where','Centre X,Y (mm)'],rows,9,27)
    y=g.para(608,y-28,'Origin: main-board centre. +X is right; +Y is toward the microphones. All values describe the current CAD placement study.',530,11,16)
    g.para(608,y-18,'U9 is rotated 180 degrees relative to the pin map on the following pages: its antenna faces the bottom edge. Final antenna keepout, connector key orientation, passives and mounting holes must be checked after footprint selection.',530,11,16,AMBER)
    g.finish()

def power_tree(g):
    g.begin('Power distribution and system interconnect','Arrows show power or signal flow. All grounds join the board ground system; keep switching and speaker currents away from the microphone interface.')
    g.box(42,612,180,88,'J1 USB-C',['5 V input','USB data to U10 / U9'])
    g.box(297,612,190,88,'F1 + D1 / U1',['Input protection + BQ24074','Charger and load sharing'])
    g.arrow([(222,657),(297,657)],'5 V')
    g.box(297,458,190,85,'J2 BATTERY',['Protected 1S, 4.2 V charge','PACK+, GND, 10k NTC'])
    g.arrow([(357,612),(357,543)],'charge');g.arrow([(422,543),(422,612)],'supply')
    g.box(579,612,185,88,'U6 SYSTEM SWITCH',['SYS_RAW -> SYS_SW','Controlled by U5 EN'])
    g.arrow([(487,657),(579,657)],'SYS_RAW')
    g.box(862,636,260,64,'U7: 3.3 V',['ESP32, microSD, display, logic'])
    g.box(862,540,260,64,'U8: 5 V',['XVF3800 module + amplifier'])
    g.arrow([(764,667),(862,667)]);g.arrow([(796,667),(796,572),(862,572)]);g.dot(796,667)
    g.box(580,425,184,105,'U5 POWER BUTTON',['SW1 -> PB pin 2','INT pin 5 -> GPIO17','KILL pin 8 <- GPIO18'])
    g.arrow([(671,530),(671,612)],'EN / ON')
    g.box(862,390,260,104,'U9 ESP32-S3',['I2S <-> J6 audio module','SPI -> J5 display; SDMMC -> J4','GPIO18 releases system power'])
    g.arrow([(764,461),(862,461)],'interrupt');g.arrow([(862,418),(764,418),(740,425)],'shutdown')
    g.box(42,390,186,130,'U2 + LOGIC',['CC1 / CC2 detect source','Default: 100 mA input','>=1.5 A advertised:','1.30 A nominal limit'])
    g.line([(135,612),(135,520)],BLUE);g.arrow([(228,452),(259,452),(259,624),(297,624)])
    g.box(297,305,190,82,'U11 GAUGE',['Battery-powered monitor','I2C to U9; address 0x36'])
    g.arrow([(390,458),(390,387)],'BAT_PLUS')
    g.txt(42,265,'RAIL BUDGETS',13,True,GREEN)
    g.table(42,247,[235,230,290,345],['Rail','Recording / peak','Purpose','Important limit'],[
      ['V3V3','0.33 A / 0.85 A','Digital logic and storage','3.3 V logic; do not connect to 5 V'],
      ['V5_AUDIO','0.30 A / 0.871 A','Mic DSP and speaker amplifier','Budget assumes <=2 W speaker output'],
      ['BAT_PLUS','0.80 A / 3.07 A estimated','Pack discharge incl. path losses','>=4 A pack/harness target; verify rating'],
      ['SYS_RAW','Battery-dependent / ~4.4 V on USB','Before main power switch','Charger and control remain on when off']],9.5,28)
    g.para(42,90,'Electrical details and all bypass components are defined in the complete net sheets. Current-source detection is not USB-PD negotiation. The USB socket is not a USB microphone host port in this revision.',1090,11,16,AMBER)
    g.finish()

def esp_pinmap(g):
    g.begin('ESP32 module: physical pad map','U9 ESP32-S3-WROOM-1-N16R8. Top view of the module, antenna upward. The module is rotated 180 degrees in the board placement.')
    c=g.c;x,y,w,h=402,245,320,435
    c.setFillColor(PALE);c.setStrokeColor(GREEN);c.rect(x,y,w,h,fill=1,stroke=1)
    c.setFillColor(HexColor('#eee5cf'));c.rect(x,y+h-78,w,78,fill=1,stroke=1)
    g.txt(x+w/2,y+h-33,'ANTENNA / KEEP CLEAR',14,True,AMBER,align='center')
    g.txt(x+w/2,y+h-56,'No copper, battery or metal in RF keepout',10,color=AMBER,align='center')
    g.txt(x+w/2,y+233,'U9 / ESP32-S3',17,True,GREEN,align='center')
    g.txt(x+w/2,y+207,'18 x 25.5 mm module',11,align='center')
    c.setFillColor(HexColor('#d0b77b'));c.rect(x+115,y+99,90,67,fill=1,stroke=1)
    g.txt(x+w/2,y+137,'PAD 41',13,True,align='center');g.txt(x+w/2,y+117,'GND exposed pad',10,align='center')
    for side,nums in [('L',range(1,15)),('R',range(40,26,-1))]:
        for i,n in enumerate(nums):
            yy=578-i*23.2;xx=x if side=='L' else x+w;d=-1 if side=='L' else 1
            q=PIN['U9'][str(n)];net=q['net'] or 'UNUSED / RESERVE'
            c.setFillColor(HexColor('#c6aa60'));c.rect(xx-8 if side=='L' else xx,yy-4,8,8,fill=1,stroke=0)
            g.line([(xx,yy),(xx+d*26,yy)],GRAY)
            g.txt(xx+d*33,yy-3,f'{n:02d}  {q["name"]}  /  {net}',9.5,align='right' if side=='L' else 'left')
    for i,n in enumerate(range(15,27)):
        xx=x+14+i*26.5;q=PIN['U9'][str(n)]
        c.setFillColor(HexColor('#c6aa60'));c.rect(xx-4,y-8,8,8,fill=1,stroke=0)
        g.line([(xx,y),(xx,y-23)],GRAY)
        c.saveState();c.translate(xx+3,y-32);c.rotate(90);g.txt(0,0,f'{n} / {q["name"]}',9,align='right');c.restoreState()
    g.para(42,119,'Pad number is the physical solder pad; GPIO is the programmable signal name. Example: module pad 8 is GPIO15 (I2C SCL), not GPIO8. Check the table before wiring.',1100,12,18)
    g.para(42,74,'Source: Espressif module datasheet, Pin Layout and Pin Definitions. GPIO35-37 are reserved for this N16R8 memory configuration. GPIO0 is the BOOT strap. This drawing is not a footprint.',1100,10,15,GRAY)
    g.finish()

def route_for(net,ref='U9'):
    if not net:return 'Leave unused / reserve'
    if net=='GND':return 'Ground plane'
    if net=='V3V3':return 'U7 3.3 V / local bypass'
    dest=[]
    for p in PARTS:
        if p['ref']==ref or not (p['ref'].startswith('J') or p['ref'].startswith('U') or p['ref'].startswith('SW') or p['ref']=='Q1'):continue
        for q in p['pins']:
            if q['net']==net:dest.append(p['ref']+'.'+q['number'])
    special={'VOL_UP':'R51 -> SW4; R52 / C62','VOL_DOWN':'R53 -> SW5; R54 / C63','RECORD_N':'R55 -> SW6; R56 / C64','SD_CLK':'R40 -> J4.5','MCU_USB_DP':'R32 -> U10.1','MCU_USB_DM':'R33 -> U10.2'}
    return special.get(net,', '.join(dest))

def gpio_tables(g):
    g.begin('ESP32 pad-to-function wiring schedule','Physical module pad, GPIO name, assigned net and destination. These are custom-board assignments; existing touchscreen firmware uses a different profile.')
    values=[]
    for pin in BYREF['U9']['pins']:
        values.append([pin['number'],pin['name'],pin['net'] or 'NC',route_for(pin['net'])])
    for x,rows in [(42,values[:21]),(621,values[21:])]:
        g.table(x,709,[35,72,146,280],['Pad','GPIO / pin','Net name','Connects to'],rows,9,25)
    g.para(42,124,'USB and SD clocks have series resistors: connect to the named MCU-side net, not directly across the resistor. GPIO18 must behave as open drain for orderly power-off. GPIO4 controls USB suspend through Q1/U12.',1090,11,17)
    g.para(42,71,'Firmware must reserve GPIO35-37, preserve strap behaviour, choose the correct I2S clock role and map every button from this schedule. Signal direction is configured by firmware; a matching label alone does not establish it.',1090,10,15,GRAY)
    g.finish()

def connector_pages(g):
    g.begin('Connector pinouts: audio, screen and battery','All J2 / J5 / J6 assignments below are carrier-side definitions. Connector orientation, key and module-side mating pin numbers are NOT released.')
    rows=[]
    dirs={1:'5 V power out',2:'Ground',3:'ESP -> DSP',4:'Ground',5:'ESP -> DSP',6:'Ground',7:'DSP -> ESP',8:'ESP -> DSP',9:'Bidirectional',10:'ESP -> DSP / gauge',11:'ESP -> DSP',12:'Ground'}
    for q in BYREF['J6']['pins']:
        n=int(q['number']);rows.append([n,q['name'],q['net'],dirs[n]])
    g.txt(42,709,'J6 / FOUR-MIC MODULE HARNESS',13,True,GREEN)
    g.table(42,689,[35,85,175,215],['Pin','Function','Net','Direction / level'],rows,9.5,29)
    g.para(42,275,'BCLK, WS, data, reset and I2C use 3.3 V logic. Only J6 pin 1 is the 5 V supply. The array has its own four microphones; this is not four separate mic inputs.',510,11,17)
    g.para(42,189,'Drawn as a keyed 2x6 logical interface. Do not use a guessed ribbon-cable pin order: the exact connector and Seeed module contact mapping must be checked together.',510,11,17,AMBER)
    g.txt(624,709,'J5 / SPI SCREEN MODULE',13,True,GREEN)
    vals=[]
    for q in BYREF['J5']['pins']:vals.append([q['number'],q['name'],q['net'],route_for(q['net'],'J5')])
    yy=g.table(624,689,[35,85,115,267],['Pin','Function','Net','Controller / supply'],vals,9,27)
    g.para(624,yy-18,'Requires a 3.3 V-compatible module with a backlight driver. BL is a control signal, not a direct high-current LED feed.',500,10,15)
    g.txt(624,365,'J2 / PROTECTED BATTERY + TEMPERATURE',13,True,GREEN)
    g.table(624,345,[35,110,125,232],['Pin','Function','Net','Rating / note'],[
      ['1','PACK+','BAT_PLUS','Protected 1S; 4.2 V charge'],['2','PACK-','GND','Ground return; >=4 A path target'],['3','NTC','BAT_NTC','Compatible 10k thermistor to PACK-']],9.5,29)
    g.para(624,207,'Battery capacity does not prove discharge current. The old two-wire pack is not electrically approved for this three-wire charging/NTC arrangement.',500,11,17,AMBER)
    g.txt(42,99,'PIN-1 CONVENTION',11,True,GREEN)
    g.para(42,78,'A final assembly drawing must show each connector from a named viewing direction and identify pin 1 with a triangle or square pad. These tables do not claim an existing plug is wired in this order.',1090,10,15)
    g.finish()

    g.begin('Connector pinouts: USB, SD, service and speaker','USB names identify standard receptacle contacts; SD names identify card contacts. Translate these to the exact socket footprint before routing.')
    g.txt(42,709,'J1 / USB-C USB 2.0',13,True,GREEN)
    g.table(42,689,[115,100,292],['Contacts','Net','Connection'],[
      ['A4 A9 B4 B9','VBUS_5V','5 V input -> F1 -> USB_PROTECTED'],['A1 A12 B1 B12','GND','Ground'],['A5','CC1','U2.1 + D3.1'],['B5','CC2','U2.2 + D3.2'],['A6 B6','USB_DP','U10.8 + D4.1'],['A7 B7','USB_DM','U10.7 + D4.2'],['A8 B8','NC','SBU unused'],['Shield / S1','GND','Exact shell pad count depends on socket']],9.5,28)
    g.txt(42,411,'J3 / SERVICE PADS',13,True,GREEN)
    g.table(42,391,[40,100,367],['Pad','Net','Use'],[
      ['1','GND','Debugger ground'],['2','UART_TX','U9 pad 37 / GPIO43 -> adapter RX'],['3','UART_RX','U9 pad 36 / GPIO44 <- adapter TX'],['4','MCU_EN','Reset / enable'],['5','BOOT_N','GPIO0 boot strap'],['6','V3V3','Voltage reference only; do not supply power']],9.5,27)
    g.para(42,190,'Use 3.3 V UART levels. A USB-UART adapter must not power the switched-off board through its TX line or VREF. Service-pad location is still unplaced.',500,10,15,AMBER)
    g.txt(624,709,'J4 / microSD CARD CONTACTS',13,True,GREEN)
    g.table(624,689,[40,80,113,269],['Pin','Card','Net','ESP32 destination'],[
      [q['number'],q['name'],q['net'],route_for(q['net'],'J4') if q['net']!='SD_CLK_CARD' else 'R40 -> GPIO38 / U9.31'] for q in BYREF['J4']['pins']],9.5,27)
    g.txt(624,390,'J7 / AMPLIFIER IN -> J8 / SPEAKER OUT',13,True,GREEN)
    g.table(624,369,[130,130,242],['Module-side input','Speaker output','Signal'],[['J7.1','J8.1','SPK_PLUS'],['J7.2','J8.2','SPK_MINUS']],10,29)
    g.para(624,250,'The module amplifier drives both speaker wires. Neither speaker terminal is ground. Target a documented 4-ohm speaker and limit output to the assumed 2 W until thermal and current tests pass.',500,11,17,AMBER)
    g.para(624,169,'Card-detect and multiple shield pads depend on the selected SD socket. They are not interchangeable with the eight card contacts. The speaker harness must match the actual module connector.',500,10,15)
    g.finish()

def button_page(g):
    g.begin('Button circuits and safe shutdown','Momentary switches connect to logic inputs. The user power button does not carry the battery load current.')
    g.txt(42,713,'VOLUME AND RECORD / STOP: THREE IDENTICAL INPUT CIRCUITS',13,True,GREEN)
    for i,(sw,rseries,rpull,cap,net,gpio,pad) in enumerate([('SW4','R51','R52','C62','VOL_UP',1,39),('SW5','R53','R54','C63','VOL_DOWN',2,38),('SW6','R55','R56','C64','RECORD_N',21,23)]):
        xx=52+i*375;yy=565;g.txt(xx,685,f'{sw}: {net}',12,True)
        g.txt(xx+165,663,'3.3 V',10,True);g.resistor(xx+165,651,xx+165,yy,rpull+' 10k');g.dot(xx+165,yy)
        g.line([(xx+165,yy),(xx+280,yy)]);g.txt(xx+280,yy+8,f'U9.{pad} / GPIO{gpio}',9,align='right')
        g.resistor(xx+40,yy,xx+165,yy,rseries+' 1k');g.switch(xx+40,yy,sw)
        g.capacitor(xx+165,yy,cap+' 100nF')
    g.para(42,447,'Press = LOW. Current while held is about 0.30 mA; pin voltage is about 0.30 V. Firmware must debounce the input. Use the same net labels shown in the pad schedule.',1090,11,16)
    g.txt(42,391,'BOOT / RESET',13,True,GREEN)
    for xx,label,net,r,cap,pad in [(90,'SW2 BOOT','BOOT_N','R31',None,27),(355,'SW3 RESET','MCU_EN','R30','C40',3)]:
        yy=264;g.txt(xx,363,'3.3 V',10);g.resistor(xx,350,xx,yy,r+' 10k');g.dot(xx,yy)
        g.line([(xx,yy),(xx+170,yy)]);g.txt(xx+170,yy+8,f'{net} / U9.{pad}',9,align='right');g.switch(xx,yy,label)
        if cap:g.capacitor(xx+135,yy,cap+' 1uF')
    g.box(642,240,475,139,'SW1 POWER / LTC2954 U5',[
      'SW1 shorts U5 pin 2 PB to GND; use the internal button input circuitry.',
      'U5 pin 5 INT -> U9 pad 10 / GPIO17. R11 pulls INT to 3.3 V.',
      'U5 pin 8 KILL <- U9 pad 11 / GPIO18, open drain. R12 pulls it to switched 3.3 V.',
      'U5 pin 6 EN -> U6 pin 3 ON; R10 pulls EN to SYS_RAW.'])
    g.para(642,214,'C11 47nF sets approximately 0.33 s start hold; C12 1uF sets approximately 6.48 s forced-off hold. Timings include the datasheet fixed delays and remain subject to tolerance.',475,10,15)
    g.box(42,71,1075,75,'SHUTDOWN ORDER',[
      'Power press -> finish recording -> finalize and flush WAV -> persist upload state -> mute -> GPIO18 LOW -> main rails off.',
      'Forced off can interrupt writes. Charging/control/gauge stay powered; this is not a total battery disconnect.'])
    g.finish()

def regulator_page(g):
    g.begin('Regulator wiring: two copies of this circuit','Drawn once for clarity; the table gives U7 and U8 component references. Every pin is also listed in the complete net sheets.')
    # IC with explicit physical pin numbers. Supply/output bypass drawn adjacent.
    p=g.pinbox(440,342,240,310,'U7',[(12,247),(13,222),(14,180),(1,131),(15,98),(6,65),(4,27)],[(11,247),(9,211),(7,162),(8,137),(5,80),(3,45),(10,14)])
    g.line([(140,589),p['12']]);g.txt(140,604,'SYS_SW',12,True)
    g.line([(360,589),(360,564),p['13']]);g.dot(360,589)
    g.resistor(315,522,415,522,'R22 10k');g.line([(315,522),(315,589)]);g.dot(315,589)
    g.capacitor(160,589,'C20 10uF');g.capacitor(265,589,'C21 10uF')
    for n in ['1','15','6','4']:
        x,y=p[n];g.line([(x,y),(385,y)]);g.ground(385,y)
    # Inductor links L1/L2 with the conventional coil representation.
    g.line([p['11'],(752,589)]);g.line([p['9'],(752,553)])
    g.line([(752,589),(785,589),(785,580)])
    c=g.c;c.setStrokeColor(GREEN)
    for k in range(3):c.arc(779,568-k*7,791,580-k*7,90,-180)
    g.line([(785,559),(785,553),(752,553)]);g.txt(805,577,'L1 1.5uH',10,True)
    g.txt(805,560,'U8 uses L2',9,color=GRAY)
    g.line([p['7'],(1030,504)]);g.txt(1030,519,'REGULATED OUTPUT',12,True,align='right')
    g.line([p['8'],(734,479),(734,504)]);g.dot(734,504)
    g.capacitor(840,504,'C23 10uF');g.capacitor(998,504,'C24-26: 3 x 22uF')
    # Feedback separate from power-bank ground symbols.
    g.line([(1060,504),(1060,451)]);g.line([(1030,504),(1060,504)])
    g.resistor(1060,451,1060,391,'R20');g.dot(1060,391)
    g.line([p['5'],(1028,422),(1028,391),(1060,391)])
    g.resistor(1060,391,1060,321,'R21');g.ground(1060,321)
    g.line([p['3'],(749,387),(749,315)]);g.capacitor(749,315,'C22 100nF / VAUX')
    g.line([p['10'],(714,356),(714,323)]);g.ground(714,323)
    g.txt(75,378,'Pin 2 PG: NC',10);g.txt(75,356,'PS/SYNC = GND: forced PWM',10)
    g.txt(75,334,'VSEL = GND; FB2 = GND',10)
    g.txt(42,248,'INSTANCE VALUES',13,True,GREEN)
    g.table(42,230,[90,115,140,190,170,215,180],['IC','Rail','Inductor','Feedback top / bottom','Enable resistor','Input / VAUX caps','Output capacitors'],[
      ['U7','3.3 V','L1 1.5uH','R20 470k / R21 150k','R22 10k','C20 C21 / C22','C23 + C24 C25 C26'],
      ['U8','5 V','L2 1.5uH','R24 680k / R25 130k','R26 10k','C30 C31 / C32','C33 + C34 C35 C36']],9,31)
    g.para(42,115,'Feedback resistors: 0.1%. Use the selected part datasheet layout, short switching loops and appropriate effective ceramic capacitance. U7/U8 are 15-pad VQFN-HR packages, not generic QFN16.',1090,11,16)
    g.para(42,80,'OPEN: computed peak-load right-half-plane zeros are below the vendor guideline. The values shown are draft calculations; loop stability and load-step performance must be resolved before manufacture.',1090,11,16,AMBER)
    g.finish()

def charge_page(g):
    g.begin('USB current selection and battery charging','Connected functional schematic. The complete component sheets include every physical pin, bypass capacitor, protection device and unused pin.')
    g.box(42,593,175,102,'J1 USB-C',['CC1 -> U2.1','CC2 -> U2.2','VBUS -> F1 -> U1.13'])
    g.box(279,593,210,102,'U2 TUSB320LAI',['Sink mode: PORT / EN_N = GND','ADDR = NC: GPIO interface','OUT1 = CC_LOW_CURRENT'])
    g.arrow([(217,643),(279,643)])
    g.box(545,598,170,92,'U3 INVERTER',['OUT1 LOW -> HIGH','HIGH_CURRENT_OK'])
    g.arrow([(489,643),(545,643)])
    g.box(792,598,137,92,'U4 OR',['A: high current','B: suspend'])
    g.arrow([(715,643),(792,643)])
    g.box(989,580,160,119,'U1 BQ24074',['EN2 pin 5 <- U4','EN1 pin 6 <- U12','CE pin 4 = GND','OUT 10/11: SYS_RAW'])
    g.arrow([(929,643),(989,643)])
    g.box(42,400,215,100,'U9 GPIO4',['USB_SUSPEND','R5 47k gate pull-down','3.3 V GPIO -> Q1 gate'])
    g.box(327,400,210,100,'Q1 + R8',['Q1 source -> GND','Drain -> 100k -> SYS_RAW','Inverts / translates voltage'])
    g.box(606,400,213,100,'U12 INVERTER',['Q1 drain -> input','Output CHG_SUSPEND','SYS_RAW logic supply'])
    g.arrow([(257,449),(327,449)]);g.arrow([(537,449),(606,449)])
    g.arrow([(819,449),(871,449),(871,598)]);g.arrow([(871,449),(959,449),(959,611),(989,611)]);g.dot(871,449)
    g.txt(895,429,'CHG_SUSPEND to both EN1 and U4',9,color=BLUE)
    g.table(42,346,[130,130,95,95,530],['Source mode','GPIO4 suspend','EN1','EN2','BQ24074 input policy'],[
      ['Default / absent','0','0','0','USB100: 100 mA mode'],['Advertised >=1.5 A','0','0','1','ILIM resistor: 1.30 A nominal (1.40 A upper estimate)'],['Any','1','1','1','USB input suspended; battery may still supply SYS_RAW']],10,30)
    g.para(42,190,'U1 battery pins 2/3 -> J2.1; ground -> J2.2; TS pin 1 -> J2.3 compatible 10k NTC to pack ground. R2 1.78k from ISET pin 16 to ground sets about 0.50 A charging. R1 1.24k from ILIM pin 12 to ground sets the advertised-source input limit.',1090,11,17)
    g.para(42,110,'TUSB320LAI supplies CC sink termination: do not add parallel external Rd resistors. R3 is 900k from VBUS to U2 VBUS_DET. USB data follows J1 -> U10 isolation -> R32/R33 -> U9 GPIO20/19. No USB microphone-host support is implemented by this circuit.',1090,11,17)
    g.finish()

def audio_page(g):
    g.begin('Audio signal path and microphone expectations','Four physical microphones feed the purchased DSP module. Its processed channels are not four automatically identified people.')
    for i in range(4):g.box(42+i*264,627,236,62,f'M{i+1} / ON MODULE',['Fixed spacing; upward acoustic opening'])
    g.box(347,464,452,111,'XVF3800 MODULE',[
      'On-module DSP: beamforming, noise/echo processing and voice capture.',
      'I2S capture -> J6.7 -> U9 pad 6 / GPIO6.',
      'Clock BCLK from GPIO5, WS from GPIO7; verify exact firmware role.'])
    for i in range(4):g.arrow([(160+i*264,627),(160+i*264,605),(396+i*102,605),(396+i*102,575)])
    g.box(42,279,310,112,'U9 -> STORAGE / UPLOAD',[
      'Use the conference output for meeting capture after listening tests.',
      'Write the complete WAV to microSD, then upload with session metadata.'])
    g.arrow([(420,464),(420,426),(197,426),(197,391)])
    g.box(459,279,310,112,'U9 -> MODULE PLAYBACK',[
      'GPIO8 / U9.12 -> J6.8 -> DSP audio input.',
      'Echo cancellation needs the correct playback reference and tuning.'])
    g.arrow([(614,391),(614,464)])
    g.box(875,279,260,112,'MODULE AMP -> SPEAKER',[
      'Module output -> J7 -> J8 -> side-facing speaker.',
      'BTL output: neither lead is ground.'])
    g.arrow([(799,512),(1005,512),(1005,391)])
    g.txt(42,227,'EXPECTED QUALITY AND ACCEPTANCE TEST',13,True,GREEN)
    g.para(42,202,'The manufacturer advertises 360-degree capture up to 5 m and onboard acoustic processing. That supports testing this module for meetings, but is not proof of clear speech in your enclosure, a noisy cafe or a reverberant room. A 3-5 m capture distance remains a target.',1090,11,17)
    g.para(42,139,'Before a custom PCB order: record the same passage at 1 m, 3 m and 5 m; rotate the source around the case; include fan noise and two people alternating or overlapping. Listen to the saved WAV and compare transcript omissions, clipping and speaker separation against the existing board.',1090,11,17)
    g.para(42,76,'Standard I2S firmware documents channel 0 as Conference and channel 1 as ASR. Other firmware images route channels differently. Source: Seeed XVF3800 introduction / firmware guide (linked in references).',1090,10,15,GRAY)
    g.finish()

def cost_page(g):
    g.begin('Prototype cost: budget before requesting quotes','MYR planning estimate for about five custom prototypes. Prices checked 22 September 2026; only the explicitly marked retail anchors are observed prices.')
    rows=[['Four-mic module','299','299','Observed Cytron listing, with enclosure; verify exact variant'],['ESP32-S3 module','25','45','Estimate; supplier and exact N16R8 part still to be quoted'],['Small screen','32','60','RM32 local display price anchor; final module not selected'],['Power, USB, SD socket, buttons, passives','120','240','Estimate from circuit complexity; excludes ESP32 above'],['Protected battery + NTC','45','90','Estimate; correct discharge rating / harness required'],['Speaker','10','25','Estimate; reuse existing only after rating check'],['microSD card','25','45','Estimate; selected reputable card'],['PCB fabrication, assembly, initial checks','250','600','Allocation per unit in a small batch; not a vendor quote'],['Printed case, cables, screws and supports','80','180','Estimate; case design and print method change cost']]
    g.table(42,710,[345,82,82,591],['Item','Low RM','High RM','Basis / exclusions'],rows,10,30)
    g.txt(42,377,'ESTIMATED BUILD COST: RM886-1,584 PER PROTOTYPE',17,True,GREEN)
    g.para(42,350,'Use roughly RM900-1,600 each for initial planning. This is not a procurement-ready BOM total. Shipping, tax, rejected parts, rework and extra PCB revisions are excluded.',1090,11,17)
    g.box(42,194,526,104,'ONE-TIME ENGINEERING ALLOWANCE',[
      'Provisional RM5,000-15,000 for schematic review, layout and prototype bring-up. This is our planning allowance, not a Malaysian supplier quote.',
      'Major firmware work, acoustic tuning, certification and production tooling are additional.'])
    g.box(604,194,533,104,'FIVE-UNIT FIRST BUILD',[
      'Hardware allowance: approximately RM4,500-8,000.',
      'With the engineering allowance: roughly RM9,500-23,000 before exclusions. Request itemized 2-unit and 5-unit quotations.',
      'Test the RM299 audio module before committing to the custom board.'])
    g.txt(42,159,'PRICE ANCHORS / MALAYSIAN QUOTATION ROUTES',11,True,GREEN)
    links=[('Cytron: microphone module RM299','https://my.cytron.io/p-respeaker-xmos-xvf3800-with-case'),('Cytron: 1.3-inch display example RM32','https://my.cytron.io/c-lcd/bestsellers'),('Nexus Avenue: PCB layout, prototype fabrication and assembly','https://nexusavenue.com.my/pcb-fab-and-assy/'),('LKL Sunrise: circuit design, layout and assembly in Malaysia','https://www.lklsunrise.com.my/index.php?controller=cms&id_cms=11')]
    y=137
    for name,url in links:
        g.txt(42,y,name,10,color=BLUE);g.c.linkURL(url,(42,y-3,750,y+12),relative=0);y-=19
    g.finish()

def add_detail_pages(c,begin):
    g=Guide(c,begin)
    physical_pages(g)
    power_tree(g)
    esp_pinmap(g)
    gpio_tables(g)
    connector_pages(g)
    button_page(g)
    regulator_page(g)
    charge_page(g)
    audio_page(g)
    cost_page(g)
