"""Project snapshots, legacy migration, and constant-index material models."""
import copy
import math
import uuid
import numpy as np
from materials import optical_constants

BUILTIN_MATERIALS = [
    {'name': 'TA2O5_REF', 'n': 2.1, 'k': 0, 'color': '#16a18f', 'role': 'film', 'model': 'constant', 'source': '合成验证常数；非真实镀膜材料色散'},
    {'name': 'SIO2_REF', 'n': 1.46, 'k': 0, 'color': '#829cdd', 'role': 'film', 'model': 'constant', 'source': '合成验证常数；非真实镀膜材料色散'},
    {'name': 'AIR', 'n': 1.0, 'k': 0, 'color': '#b7c9d7', 'role': 'medium', 'model': 'constant', 'source': '理想空气参考介质'},
    {'name': 'GLASS_REF', 'n': 1.52, 'k': 0, 'color': '#b29b77', 'role': 'substrate', 'model': 'constant', 'source': '玻璃参考常数 n=1.52；非 K9/BK7 厂商数据'},
]


def number(value, name, minimum=0, maximum=1e9, strict=False):
    if isinstance(value, bool):
        raise ValueError(f'{name}必须是数值')
    try:
        x = float(value)
    except (ValueError, TypeError):
        raise ValueError(f'{name}必须是数值') from None
    if not math.isfinite(x) or x < minimum or x > maximum or (strict and x == minimum):
        raise ValueError(f'{name}超出允许范围（{minimum}–{maximum}）')
    return x


def validate_material(material):
    if not isinstance(material, dict) or not isinstance(material.get('name'), str) or not material['name'].strip():
        raise ValueError('材料名称不能为空')
    if len(material['name']) > 100:
        raise ValueError('材料名称不能超过 100 个字符')
    number(material['n'], f"{material['name']} 折射率", 0, 20, strict=True)
    if material.get('catalogue_summary') or material.get('status') == 'quarantined':
        raise ValueError('材料目录摘要或待核查数据不能用于计算')
    number(material.get('k', 0), '消光系数', 0, 1e6)
    model = material.get('model', 'constant')
    if model == 'tabulated':
        samples = material.get('samples', [])
        if not isinstance(samples, list) or not 1 <= len(samples) <= 10001:
            raise ValueError('材料表需要 1–10001 个点')
        optical_constants(material, np.asarray([r[0] for r in samples]))
    elif model == 'tfcalc-formula':
        f = material.get('formula', {})
        if f.get('n_type') not in (1,4,5,6) or f.get('k_type') not in (1,2):
            raise ValueError('不支持的色散公式')
        for key, count in [('coefficients',6), ('k_coefficients',3)]:
            a = f.get(key)
            if not isinstance(a,list) or len(a)!=count or any(not isinstance(x,(int,float)) or not math.isfinite(x) for x in a):
                raise ValueError('色散系数无效')
        bounds = material.get('range_nm', [])
        if len(bounds)!=2 or not 0 < bounds[0] < bounds[1] <= 1e7:
            raise ValueError('色散范围无效')
        optical_constants(material,np.array([material.get('preview_nm', min(max(550,bounds[0]),bounds[1]))]))
    elif model != 'constant':
        raise ValueError('未知材料模型')
    if material.get('role', 'all') not in ('film', 'substrate', 'medium', 'all'):
        raise ValueError('材料用途无效')
    return material


def normalize_project(project):
    """Migrate old n-only boundaries to named material snapshots without changing n."""
    p = copy.deepcopy(project)
    if not isinstance(p, dict) or p.get('schema_version') not in (1,2):
        raise ValueError('不支持的项目格式，需要 schema_version = 1 或 2')
    if not isinstance(p.get('materials'), list):
        raise ValueError('项目缺少材料列表')
    s = p['settings']
    s.setdefault('polarization', 'unpolarized')
    s.setdefault('angle_deg', 0)
    for m in p['materials']:
        m.setdefault('k', 0)
        m.setdefault('color', '#8399aa')
        m.setdefault('role', 'film')
        m.setdefault('model', 'constant')
        m.setdefault('source', '旧项目常数快照，来源未指定')
    for kind, default_name, role in [('incident', 'AIR', 'medium'), ('substrate', 'GLASS_REF', 'substrate')]:
        number(s[f'{kind}_n'], f'{kind} 折射率', 0, 20, strict=True)
        key = f'{kind}_material'
        if not s.get(key):
            n = s[f'{kind}_n']
            name = default_name if n == (1 if kind == 'incident' else 1.52) else f'自定义{kind}_{n}'
            by_name = {m['name']: m for m in p['materials']}
            if name in by_name and by_name[name]['n'] != n:
                name += f'_{uuid.uuid4().hex[:8]}'
            if name not in by_name:
                base = next((copy.deepcopy(m) for m in BUILTIN_MATERIALS if m['name'] == name), None)
                p['materials'].append(base or {'name': name, 'n': n, 'k': 0, 'color': '#b29b77', 'role': role, 'model': 'constant', 'source': '从旧项目边界折射率迁移'})
            s[key] = name
        material = next((m for m in p['materials'] if m['name'] == s[key]), None)
        if material is None:
            raise ValueError(f'{kind} 所选材料不存在')
        s[f'{kind}_n'] = float(optical_constants(material, np.array([s['reference_nm']]))[0][0])
    # v2 prevents older clients from silently treating finite/back-side designs
    # as the v1 semi-infinite model. Plain legacy projects remain v1.
    if (s.get('substrate_model','semi_infinite') != 'semi_infinite' or p.get('back_layers') or s.get('first_surface','front') == 'back' or s.get('illuminant','WHITE') != 'WHITE' or s.get('detector','IDEAL') != 'IDEAL' or p.get('response_data')):
        p['schema_version'] = 2
    return p


def validate(project):
    p = normalize_project(project)
    if not isinstance(p.get('name'), str) or not p['name'].strip() or len(p['name']) > 200:
        raise ValueError('项目名称需要 1–200 个字符')
    s = p['settings']
    number(s.get('angle_deg', 0), '入射角', 0, 89.9)
    if s['polarization'] not in ('s', 'p', 'unpolarized'):
        raise ValueError('偏振必须为 s、p 或 unpolarized')
    start = number(s['start_nm'], '起始波长', 1, 1e7)
    end = number(s['end_nm'], '终止波长', start, 1e7, strict=True)
    step = number(s['step_nm'], '波长步长', 0, end-start, strict=True)
    if (end-start)/step > 10000:
        raise ValueError('采样点不能超过 10001，请增大步长')
    number(s['reference_nm'], '参考波长', 1, 1e7)
    for key in ('incident_n', 'substrate_n'):
        number(s[key], key, 0, 20, strict=True)
    if not p['materials'] or len(p['materials']) > 300:
        raise ValueError('材料数量必须为 1–300')
    names = set()
    for m in p['materials']:
        validate_material(m)
        if m['name'] in names:
            raise ValueError('材料名称不能重复')
        names.add(m['name'])
    mode = s.get('substrate_model', 'semi_infinite')
    if mode not in ('semi_infinite','incoherent','coherent'):
        raise ValueError('基底模型必须为半无限、非相干或相干')
    if s.get('first_surface','front') not in ('front','back'):
        raise ValueError('第一表面必须为 front 或 back')
    exit_name = s.get('exit_material',s['substrate_material'])
    if exit_name not in names:
        raise ValueError('出射介质材料不存在')
    if mode != 'semi_infinite':
        number(s.get('substrate_thickness_mm'), '基底厚度 mm', 0, 1e5, strict=True)
    elif exit_name != s['substrate_material'] or p.get('back_layers'):
        raise ValueError('半无限基底不含背面；独立出射介质或背面膜层需要有限厚基底模型')
    responses=p.get('response_data') or {}
    if not isinstance(responses,dict):raise ValueError('响应数据格式无效')
    distributions=responses.get('distributions',[])
    if not isinstance(distributions,list) or len(distributions)>100:raise ValueError('分布记录数量无效')
    distribution_names=set()
    for record in distributions:
        import re
        name=record.get('name','')
        if not re.fullmatch(r'[A-Z0-9_-]{1,8}',name) or name=='EQUAL' or name in distribution_names:raise ValueError('分布名称无效或重复')
        distribution_names.add(name);samples=record.get('samples',[])
        if not isinstance(samples,list) or not 1<=len(samples)<=1001:raise ValueError('分布需要1–1001个数据点')
        previous=-1;positive=False
        for row in samples:
            if not isinstance(row,list) or len(row)!=2:raise ValueError('分布需要角度和强度两列')
            angle=number(row[0],'分布角度',0,90);intensity=number(row[1],'分布强度',0,100)
            if angle<=previous:raise ValueError('分布角度须递增且不重复')
            previous=angle;positive=positive or intensity>0
        if not positive:raise ValueError('分布强度不能全部为0')
    ids = set()
    for side, layers in [('正面',p['layers']), ('背面',p.get('back_layers',[]))]:
        if not isinstance(layers,list) or len(layers)>500:
            raise ValueError(f'{side}膜层数量不能超过 500')
        for i, layer in enumerate(layers):
            if not isinstance(layer.get('id'), str) or layer['id'] in ids:
                raise ValueError('膜层 ID 缺失或重复')
            ids.add(layer['id'])
            if layer['material'] not in names:
                raise ValueError(f'{side}第 {i+1} 层的材料不存在')
            group=layer.get('group',0)
            if type(group) is not int or not 0<=group<=999:raise ValueError('组号须为 0–999 的整数')
            number(layer['thickness_nm'],f'{side}第 {i+1} 层厚度',0,1e6)
    factors=p.get('group_factors',{})
    if not isinstance(factors,dict) or len(factors)>999:raise ValueError('组系数格式无效')
    for key,value in factors.items():
        if not isinstance(key,str) or not key.isdecimal() or str(int(key))!=key or not 1<=int(key)<=999:raise ValueError('组系数编号无效')
        number(value,'组系数',0,1e6)
    from responses import validate_responses
    validate_responses(p)
    targets = p.get('target_points')
    if targets is not None:
        if not isinstance(targets, list) or not 2 <= len(targets) <= 10001:
            raise ValueError('目标曲线需要 2–10001 个点')
        previous = 0
        for target in targets:
            wavelength = number(target['wavelength_nm'], '目标波长', previous, 1e7, strict=True)
            previous = wavelength
            if not any(key in target for key in ('R_percent', 'T_percent')):
                raise ValueError('目标曲线缺少 R/T 百分数')
            for key in ('R_percent', 'T_percent'):
                if key in target:
                    number(target[key], '目标光谱百分数', 0, 100)
    bands = p.get('analysis_bands', {})
    if not isinstance(bands, dict):
        raise ValueError('波段分析设置无效')
    for band in bands.values():
        start = number(band['start_nm'], '分析波段起点', 1, 1e7)
        number(band['end_nm'], '分析波段终点', start, 1e7, strict=True)
    if p.get('layer_order') != 'substrate_to_air':
        raise ValueError('项目层序必须为 substrate_to_air')
    return p
