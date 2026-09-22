"""Package only authored outputs; exclude vendor PDFs, scratch logs and caches."""
from pathlib import Path
import shutil,zipfile,hashlib,json
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
OUT=REPO/'output/pcb/Fovea-B0'
PDF=REPO/'output/pdf/Fovea-B0-board-and-electrical-design.pdf'
shutil.copy2(ROOT/'README.md',OUT/'README.md')
shutil.copy2(PDF,OUT/PDF.name)
SOURCE=OUT/'source';SOURCE.mkdir(exist_ok=True)
for file in ROOT.iterdir():
    if file.suffix in ('.py','.html','.md'):shutil.copy2(file,SOURCE/file.name)
files=[p for p in OUT.rglob('*') if p.is_file() and p.suffix!='.blend1' and '__pycache__' not in p.parts and p.name!='SHA256SUMS.json']
sums={p.relative_to(OUT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
(OUT/'SHA256SUMS.json').write_text(json.dumps(sums,indent=2))
archive=OUT.parent/'Fovea-B0-design-package.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for p in files+[OUT/'SHA256SUMS.json']:z.write(p,'Fovea-B0/'+p.relative_to(OUT).as_posix())
with zipfile.ZipFile(archive) as z:assert z.testzip() is None
print(f'{archive}\n{archive.stat().st_size:,} bytes, {len(files)+1} files; ZIP integrity verified')
