"""Illuminant intensity and detector efficiency; physical R/T/A stay unchanged."""
import numpy as np
from models import number


def validate_responses(project):
    data = project.get('response_data', {})
    if not isinstance(data, dict):
        raise ValueError('光源/探测器数据格式无效')
    for category, default in [('illuminants','WHITE'), ('detectors','IDEAL')]:
        rows = data.get(category, [])
        if not isinstance(rows, list) or len(rows) > 100:
            raise ValueError('每类光源/探测器最多 100 项')
        names = {default}
        for row in rows:
            if not isinstance(row,dict):raise ValueError('响应记录必须包含名称和光谱数据')
            name = row.get('name')
            if not isinstance(name, str) or not name.strip() or len(name)>100 or name in names:
                raise ValueError('光源/探测器名称为空、重复或覆盖内置参考')
            names.add(name)
            samples = row.get('samples')
            if not isinstance(samples,list) or not 2 <= len(samples) <= 10001:
                raise ValueError('光源/探测器需要 2–10001 个光谱数据点')
            previous = 0
            for sample in samples:
                if not isinstance(sample,list) or len(sample)!=2:
                    raise ValueError('响应光谱每行需要波长 nm 和相对强度/效率 %')
                previous = number(sample[0], '响应波长', previous, 1e7, strict=True)
                number(sample[1], '响应百分数', 0, 100 if category=='detectors' else 1e9)
        selected = project['settings'].get('illuminant' if category=='illuminants' else 'detector', default)
        if selected not in names:
            raise ValueError(f'缺少 {selected} 的完整响应数据；不能替换为 {default}')


def response_weights(project, wavelengths):
    weight = np.ones(len(wavelengths))
    for category, field, default in [('illuminants','illuminant','WHITE'),('detectors','detector','IDEAL')]:
        selected = project['settings'].get(field, default)
        if selected == default:
            continue
        row = next(r for r in project.get('response_data',{}).get(category,[]) if r['name']==selected)
        samples = np.asarray(row['samples'],float)
        # TFCalc uses linear interpolation with the nearest endpoint out of range.
        weight *= np.interp(wavelengths,samples[:,0],samples[:,1])/100
    return weight
