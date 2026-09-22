"""Package the case sources, review files and print files without vendor assets."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root=Path(__file__).resolve().parent
version='Lantern-case-v0.3'
target=root/f'{version}.zip'
sources=['README.md','PRINT_ORDER.txt','dimensions.json','requirements.txt',
         'build_case.py','render_preview.py','make_preview.py','preview-template.html','package_case.py','trace_branding.py']
with ZipFile(target,'w',ZIP_DEFLATED,compresslevel=9) as archive:
    for name in sources:
        archive.write(root/name,arcname=f'{version}/{name}')
    for file in sorted((root/'branding').iterdir()):
        if file.is_file():
            archive.write(file,arcname=f'{version}/branding/{file.name}')
    for file in sorted((root/'exports').iterdir()):
        if file.is_file() and file.suffix in {'.stl','.step','.blend','.png','.html','.json'}:
            archive.write(file,arcname=f'{version}/exports/{file.name}')
with ZipFile(target) as archive:
    assert archive.testzip() is None
    print(f'Packaged and verified {len(archive.namelist())} files, {target.stat().st_size:,} bytes')
print(target)
