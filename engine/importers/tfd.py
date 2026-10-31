"""TFCalc reference-subset adapter; produces the shared project model."""
import json
import uuid
from models import validate

def parse_tfd(text, template):
    """Read the ENVIRON/LAYER subset. Other records are not round-tripped."""
    project = json.loads(json.dumps(template))
    lines = [line.strip().split('*') for line in text.lstrip('\ufeff').splitlines() if line.strip()]
    envs = [a for a in lines if a[0] == 'ENVIRON']
    declared = [a for a in lines if a[0] == 'LAYERS']
    rows = [a for a in lines if a[0] == 'LAYER']
    if len(envs) != 1 or len(declared) != 1:
        raise ValueError('需要唯一的 ENVIRON 和 LAYERS 记录；仅支持参考样例子集')
    e = envs[0]
    if len(e) < 9 or int(declared[0][1]) != len(rows):
        raise ValueError('TFD 环境字段不完整或膜层数量不匹配')
    if any(a[0] == 'LAYERS2' and int(a[1]) != 0 for a in lines):
        raise ValueError('暂不支持双面膜系')
    settings = project['settings']
    settings.update(dict(zip(['start_nm','end_nm','step_nm','reference_nm','angle_deg'], map(float, e[1:6]))))
    if e[6:8] != ['AIR', 'GLASS']:
        raise ValueError('此导入器仅支持 AIR / GLASS 参考环境')
    settings.update(incident_n=1.0, substrate_n=1.52)
    settings.pop('incident_material', None)
    settings.pop('substrate_material', None)
    project['layers'] = []
    for i, row in enumerate(rows):
        if len(row) < 6 or int(row[1]) != i+1:
            raise ValueError('膜层编号必须从 1 连续递增')
        project['layers'].append({'id': str(uuid.uuid4()), 'material': row[2], 'thickness_nm': float(row[4])})
    project['id'] = str(uuid.uuid4())
    project['name'] = '导入的参考膜系'
    return validate(project)


