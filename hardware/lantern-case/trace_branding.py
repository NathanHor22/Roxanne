"""Trace the supplied logo's alpha silhouette into dimension-independent paths.

This preserves the supplied mark, including its tapered strokes. The PNG/WebP
colour is not used: its white artwork has a transparent background.
"""
from pathlib import Path
from collections import defaultdict
import json
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parent
image=Image.open(ROOT/'branding/fovea-logo.webp').convert('RGBA')
mask=np.asarray(image.getchannel('A'))>=128
height,width=mask.shape
edges=defaultdict(list)
for y,x in np.argwhere(mask):
    x,y=int(x),int(y)
    if y==0 or not mask[y-1,x]: edges[(x,y)].append((x+1,y))
    if x==width-1 or not mask[y,x+1]: edges[(x+1,y)].append((x+1,y+1))
    if y==height-1 or not mask[y+1,x]: edges[(x+1,y+1)].append((x,y+1))
    if x==0 or not mask[y,x-1]: edges[(x,y+1)].append((x,y))

def simplify(points,epsilon=1.2):
    points=np.asarray(points,dtype=float)
    if len(points)<=2: return points.tolist()
    delta=points[-1]-points[0]
    if np.linalg.norm(delta)<1e-8:
        distances=np.linalg.norm(points-points[0],axis=1)
    else:
        d=points-points[0]
        distances=np.abs(delta[0]*d[:,1]-delta[1]*d[:,0])/np.linalg.norm(delta)
    i=int(np.argmax(distances))
    if distances[i]<=epsilon: return points[[0,-1]].tolist()
    return simplify(points[:i+1],epsilon)[:-1]+simplify(points[i:],epsilon)

paths=[]
while edges:
    start=next(iter(edges)); p=start; path=[p]
    while True:
        candidates=edges[p]
        # At diagonal pixel contacts keep each silhouette on its own right turn.
        if len(candidates)>1 and len(path)>1:
            dx,dy=p[0]-path[-2][0],p[1]-path[-2][1]
            candidates.sort(key=lambda q: dx*(q[1]-p[1])-dy*(q[0]-p[0]))
        q=candidates.pop()
        if not candidates: del edges[p]
        path.append(q); p=q
        if p==start: break
    area=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(path,path[1:]))/2
    if abs(area)<12: continue  # Ignore sub-pixel compression flecks, not strokes.
    # Split the closed loop before applying an open-polyline simplifier.
    mid=len(path)//2
    points=simplify(path[:mid+1])[:-1]+simplify(path[mid:])[:-1]
    paths.append({'area_pixels':area,'points':points})

data={'source':'fovea-logo.webp','width_pixels':width,'height_pixels':height,
      'threshold_alpha':128,'simplification_pixels':1.2,'paths':paths}
(ROOT/'branding/logo-outline.json').write_text(json.dumps(data),encoding='utf-8')
svgpaths=''.join('<path d="M '+' L '.join(f'{x:g},{y:g}' for x,y in p['points'])+' Z"/>' for p in paths)
(ROOT/'branding/logo-outline.svg').write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}"><g fill="#111">{svgpaths}</g></svg>',encoding='utf-8')
print('Logo contours:',[(round(p['area_pixels']),len(p['points'])) for p in paths])
