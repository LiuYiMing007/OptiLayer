"""Project snapshots, legacy migration, and constant-index material models."""
import copy
import math
import uuid

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
    if number(material.get('k', 0), '消光系数') != 0:
        raise ValueError('当前引擎只支持 k=0；吸收材料尚未实现')
    if material.get('model', 'constant') != 'constant':
        raise ValueError('当前只支持 constant 材料模型')
    if material.get('role', 'all') not in ('film', 'substrate', 'medium', 'all'):
        raise ValueError('材料用途无效')
    return material


def normalize_project(project):
    """Migrate old n-only boundaries to named material snapshots without changing n."""
    p = copy.deepcopy(project)
    if not isinstance(p, dict) or p.get('schema_version') != 1:
        raise ValueError('不支持的项目格式，需要 schema_version = 1')
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
        s[f'{kind}_n'] = material['n']
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
    layers = p['layers']
    if not isinstance(layers, list) or len(layers) > 500:
        raise ValueError('膜层数量不能超过 500')
    ids = set()
    for i, layer in enumerate(layers):
        if not isinstance(layer.get('id'), str) or layer['id'] in ids:
            raise ValueError('膜层 ID 缺失或重复')
        ids.add(layer['id'])
        if layer['material'] not in names:
            raise ValueError(f'第 {i+1} 层的材料不存在')
        number(layer['thickness_nm'], f'第 {i+1} 层厚度', 0, 1e6)
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
