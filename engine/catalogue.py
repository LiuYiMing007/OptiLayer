"""Read-only bundled catalogue. Projects embed selected full snapshots only."""
from functools import lru_cache
import copy
import json
from pathlib import Path


@lru_cache(maxsize=1)
def catalogue():
    return json.loads((Path(__file__).resolve().parent/'data'/'tfcalc-catalogue.json').read_text(encoding='utf-8'))


def catalogue_summaries():
    summaries=[]
    for m in catalogue()['materials']:
        item={k:v for k,v in m.items() if k not in ('samples','formula','raw_records','preview')}
        preview=m.get('preview',[])
        # Small inspection thumbnails; production calculations always fetch the
        # untouched full snapshot. Keep the shared multi-window projection lean.
        if preview:
            indices=sorted({round(i*(len(preview)-1)/11) for i in range(12)})
            item['preview']=[[float(f'{v:.7g}') for v in preview[i]] for i in indices]
        item['catalogue_summary']=True
        summaries.append(item)
    return summaries


def catalogue_material(name):
    material=next((m for m in catalogue()['materials'] if m['name']==name),None)
    if material is None:raise ValueError('目录中找不到该材料')
    if material['status']!='ready':raise ValueError('源数据待核查，不能用于计算：'+'；'.join(material['issues']))
    return copy.deepcopy({k:v for k,v in material.items() if k not in ('preview','raw_records')})
