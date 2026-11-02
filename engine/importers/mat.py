"""Strict, non-executing reader for the TFCalc MAT formats present in the source.

No recovery by guessing truncated numbers, clamping negative k or dropping rows.
All source files receive a catalogue record, including quarantine entries.
"""
import hashlib
import math
import re
from pathlib import PurePosixPath
import numpy as np
from materials import optical_constants


def decode(raw):
    for encoding in ('utf-8-sig', 'gb18030', 'cp1252'):
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            pass
    return raw.decode('latin1'), 'latin1'


def parse_mat(raw, relative_path):
    text, encoding = decode(raw)
    path = PurePosixPath(relative_path)
    records = [line.split('*') for line in re.split(r'[\r\n]+', text) if line]
    get = lambda key: [r[1:-1] if r[-1] == '' else r[1:] for r in records if r[0] == key]
    comments = ['*'.join(r) for r in get('COMMENT')]
    m = dict(name=f'TFC/{path.parent}/{path.stem}', display_name=path.stem,
             n=1.0, k=0.0, color='#6488a6', role='film' if path.parent.name == 'MATERIAL' else 'substrate' if path.parent.name in ('SUBSTRAT', 'SCHOTT') else 'all',
             source='TFCalc · '+relative_path, collection=path.parent.name,
             provenance={'path':relative_path, 'sha256':hashlib.sha256(raw).hexdigest(), 'encoding':encoding, 'comments':comments},
             status='ready', issues=[])
    try:
        if not get('VERSION') or get('VERSION')[0] != ['1']:
            raise ValueError('缺少或不支持的 VERSION')
        if not any(r[0] == 'EOF' for r in records):
            m['issues'].append('源文件缺少 EOF；已逐行核对点数和数值')
        fmt = get('FORMAT')[0]
        if fmt[0] == '1':
            m['model'] = 'tabulated'
            rows = get('DATA1'); count = int(get('POINTS')[0][0])
            if not count or count != len(rows):
                raise ValueError(f'声明 {count} 个点，实际 {len(rows)} 个点')
            if any(len(r) != 4 or int(r[0]) != i+1 for i, r in enumerate(rows)):
                raise ValueError('数据行不完整或点序号不连续')
            samples = [[float(v) for v in r[1:]] for r in rows]
            # Sorting is specified by TFCalc. Equal duplicates must agree.
            samples.sort(key=lambda r:r[0]); clean=[]
            for r in samples:
                if clean and r[0] == clean[-1][0]:
                    if r != clean[-1]: raise ValueError('同一波长存在相互冲突的 n/k')
                    continue
                clean.append(r)
            m['samples'] = clean; m['range_nm'] = [clean[0][0], clean[-1][0]]
            m['point_count'] = count
            optical_constants(m, np.asarray([r[0] for r in clean]))
            m['range_policy'] = 'endpoint'
        elif fmt[0] == '2':
            m['model']='tfcalc-formula'
            m['range_nm'] = [float(v) for v in fmt[3:5]]
            rows = get('DATA2')
            if len(rows) != 3 or any(len(r) != 4 or int(r[0]) != i+1 for i,r in enumerate(rows)):
                raise ValueError('色散系数不完整')
            m['formula']={'n_type':int(fmt[1]), 'k_type':int(fmt[2]),
                          'coefficients':[float(v) for r in rows[:2] for v in r[1:]],
                          'k_coefficients':[float(v) for v in rows[2][1:]], 'wavelength_unit':'um'}
            lo, hi = m['range_nm']
            if not (0 < lo < hi and math.isfinite(hi)):raise ValueError('色散范围无效')
            try:
                optical_constants(m, np.linspace(lo, hi, 10001))
            except ValueError:
                m['issues'].append('原声明范围内部分波长的公式无物理解；计算时逐波长检查并拒绝无效结果')
        else:
            raise ValueError('不支持的 MAT 格式')
        lo,hi=m['range_nm']; ref=min(max(550,lo),hi)
        n,k=optical_constants(m,np.array([ref]));m['n']=float(n[0]);m['k']=float(k[0]);m['preview_nm']=ref
        preview=np.linspace(lo,hi,48) if lo != hi else np.array([lo])
        try:
            n,k=optical_constants(m,preview)
        except ValueError:
            preview=np.linspace(max(lo,ref-25),min(hi,ref+25),48)
            n,k=optical_constants(m,preview)
        m['preview']=[[float(w),float(a),float(b)] for w,a,b in zip(preview,n,k)]
    except (ValueError, KeyError, IndexError, OverflowError) as e:
        m['status']='quarantined';m['issues'].append(str(e));m['raw_records']=text
    return m
