"""Validate editable material snapshots without changing the Optical Core."""
import copy
import numpy as np
from models import validate_material
from materials import optical_constants


def prepare_material(material):
    m=copy.deepcopy(material)
    if m.get('catalogue_summary') or m.get('status')=='quarantined':
        raise ValueError('需要完整、可用的材料记录，不能编辑目录摘要或损坏数据')
    if m.get('model')=='tabulated':
        rows=m.get('samples')
        if not isinstance(rows,list) or not rows or any(not isinstance(r,list) or len(r)!=3 for r in rows):
            raise ValueError('每行需要波长 nm、n、k 三列')
        m['range_nm']=[rows[0][0],rows[-1][0]];m['point_count']=len(rows)
    if m.get('model','constant')!='constant':
        bounds=m.get('range_nm',[550,550]);ref=min(max(550,bounds[0]),bounds[1])
        n,k=optical_constants(m,np.array([ref]));m['n']=float(n[0]);m['k']=float(k[0]);m['preview_nm']=ref
    validate_material(m)
    if m.get('model')=='tfcalc-formula':
        optical_constants(m,np.linspace(*m['range_nm'],10001))
    if not isinstance(m.get('display_name',m['name']),str) or not m.get('display_name',m['name']).strip():
        raise ValueError('显示名称不能为空')
    if len(m.get('display_name',m['name']))>100:raise ValueError('显示名称不能超过 100 个字符')
    m.pop('preview',None);m.pop('duplicate_of',None);m.pop('optical_sha256',None)
    return m
