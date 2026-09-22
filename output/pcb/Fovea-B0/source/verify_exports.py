"""Structural export checks. Deliberately not a replacement for KiCad ERC/DRC."""
import json,re
from pathlib import Path
from collections import Counter
from design import OUT,PARTS

def parse(source):
    tokens=re.findall(r'"(?:\\.|[^"\\])*"|[()]|[^\s()]+',source)
    stack=[];root=None
    for t in tokens:
        if t=='(':
            item=[]
            if stack:stack[-1].append(item)
            else:
                assert root is None
                root=item
            stack.append(item)
        elif t==')':stack.pop()
        else:stack[-1].append(json.loads(t) if t.startswith('"') else t)
    assert not stack
    return root

def children(node,key):return [v for v in node if isinstance(v,list) and v and v[0]==key]
def one(node,key):
    found=children(node,key);assert len(found)==1,(node[0],key,len(found))
    return found[0]
def point(x,y):return round(float(x),3),round(float(y),3)

byref={p['ref']:p for p in PARTS};seen=[];checked=0
for file in (OUT/'schematics').glob('*.kicad_sch'):
    tree=parse(file.read_text());assert tree[0]=='kicad_sch'
    defs={v[1]:v for v in children(one(tree,'lib_symbols'),'symbol')}
    nc={point(*one(v,'at')[1:3]) for v in children(tree,'no_connect')}
    labels={point(*one(v,'at')[1:3]):v[1] for v in children(tree,'global_label')}
    wires={}
    for v in children(tree,'wire'):
        a,b=children(one(v,'pts'),'xy');a=point(*a[1:3]);b=point(*b[1:3])
        wires[a]=b;wires[b]=a
    for s in children(tree,'symbol'):
        ref=next(p[2] for p in children(s,'property') if p[1]=='Reference')
        expected={p['number']:p['net'] for p in byref[ref]['pins']}
        x,y=map(float,one(s,'at')[1:3])
        lib=defs[one(s,'lib_id')[1]]
        pins=[p for sub in children(lib,'symbol') for p in children(sub,'pin')]
        assert len(pins)==len(expected)
        for pin in pins:
            n=one(pin,'number')[1];px,py=map(float,one(pin,'at')[1:3]);pt=point(x+px,y-py)
            if expected[n] is None:assert pt in nc,(file.name,ref,n,'NC missing')
            else:assert labels.get(wires.get(pt))==expected[n],(file.name,ref,n,expected[n],pt)
            checked+=1
        seen.append(ref)
assert Counter(seen)==Counter(byref.keys())
root=parse((OUT/'schematics/Fovea-B0.kicad_sch').read_text())
for sheet in children(root,'sheet'):
    filename=next(p[2] for p in children(sheet,'property') if p[1]=='Sheetfile')
    assert (OUT/'schematics'/filename).is_file()
result={'instances_checked':len(seen),'pin_to_wire_or_NC_checks':checked,
        'hierarchical_files_exist':True,'scope':'Generated schematic structure and named net topology only; not native KiCad/ERC or electrical validity'}
(OUT/'export-structure-validation.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
