"""Download public engineering references to task scratch storage."""
from pathlib import Path
import urllib.request
import concurrent.futures
import re
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'tmp' / 'pcb-references'
OUT.mkdir(parents=True, exist_ok=True)
REFS = {
    'bq24074': 'https://www.ti.com/lit/ds/symlink/bq24074.pdf',
    'ltc2954': 'https://www.analog.com/media/en/technical-documentation/data-sheets/2954fb.pdf',
    'tps63070': 'https://www.ti.com/lit/ds/symlink/tps63070.pdf',
    'load-switch': 'https://www.ti.com/lit/ds/symlink/tps22965.pdf',
    'usb-cc': 'https://www.ti.com/lit/ds/symlink/tusb320.pdf',
    'usb-cc-la': 'https://www.ti.com/lit/ds/symlink/tusb320lai.pdf',
    'inverter': 'https://www.ti.com/lit/ds/symlink/sn74lvc1g04.pdf',
    'esp32': 'https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf',
    'array-mechanical': 'https://files.seeedstudio.com/wiki/respeaker_xvf3800_usb/respeaker_xvf3800_2d_mechanical_drawing.pdf',
}

def download(item):
    name, url = item
    dst = OUT / (name + '.pdf')
    if not dst.exists():
        dst.write_bytes(urllib.request.urlopen(url, timeout=35).read())
    reader = PdfReader(dst)
    (OUT / (name + '.txt')).write_text('\n'.join(f'PAGE {i+1}\n' + (p.extract_text() or '') for i, p in enumerate(reader.pages)), encoding='utf-8')
    return name, len(reader.pages)

with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
    futures = [pool.submit(download, item) for item in REFS.items()]
    for future in concurrent.futures.as_completed(futures):
        try:
            print(future.result(), flush=True)
        except Exception as ex:
            print(str(ex), flush=True)

page = urllib.request.urlopen('https://wiki.seeedstudio.com/respeaker_xvf3800_introduction/', timeout=30).read().decode()
links = [h for h in re.findall(r'href=[\"\']([^\"\']+)', page) if '3d' in h.lower() or 'step' in h.lower()]
print(links)
(OUT / 'array-3d-links.txt').write_text('\n'.join(links), encoding='utf-8')
