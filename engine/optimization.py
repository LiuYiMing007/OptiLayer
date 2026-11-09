"""Bounded thickness fitting. Reuses the production Optical Core unchanged."""
import copy
import time
import numpy as np
from scipy.optimize import least_squares
from models import validate, number
from optics import calculate_spectrum, _polarized_rt


def optimize(project, variables, max_evaluations=120, time_limit=15):
    p = validate(copy.deepcopy(project))
    if not isinstance(variables, list) or not 1 <= len(variables) <= 30:
        raise ValueError('请选择 1–30 个膜层作为优化变量')
    budget = number(max_evaluations, '计算预算', 10, 500)
    points = p.get('target_points', [])
    if not points or len(points) > 500:
        raise ValueError('优化需要 1–500 个目标点，请先在目标曲线窗口导入 CSV')
    wavelengths, channels, targets = [], [], []
    for point in points:
        for channel in ('R', 'T'):
            value = point.get(channel + '_percent')
            if value is not None:
                wavelengths.append(point['wavelength_nm'])
                channels.append(channel)
                targets.append(value)
    if not targets:
        raise ValueError('目标需要 R 或 T 百分比')
    waves = np.array(wavelengths)
    s = p['settings']
    if np.any(waves < s['start_nm']) or np.any(waves > s['end_nm']):
        raise ValueError('目标波长须在当前计算范围内')
    layers, lower, upper, initial, seen = [], [], [], [], set()
    for v in variables:
        side = v.get('side', 'front')
        if side not in ('front', 'back'):
            raise ValueError('膜层表面无效')
        key = (side, v['id'])
        if key in seen:
            raise ValueError('优化膜层重复')
        seen.add(key)
        layer = next((l for l in (p['layers'] if side == 'front' else p.get('back_layers', [])) if l['id'] == v['id']), None)
        if layer is None:
            raise ValueError('优化膜层不存在')
        lo = number(v['min_nm'], '最小厚度', 0, 1e6)
        hi = number(v['max_nm'], '最大厚度', lo, 1e6, strict=True)
        if not lo <= layer['thickness_nm'] <= hi:
            raise ValueError('当前厚度必须位于优化上下限内')
        layers.append(layer); lower.append(lo); upper.append(hi); initial.append(layer['thickness_nm'])
    start = time.monotonic()
    best = np.array(initial, dtype=float)
    best_error = float('inf')
    evaluations = 0

    class StopFit(Exception):
        pass

    def residual(x):
        nonlocal best, best_error, evaluations
        if evaluations >= budget or (evaluations and time.monotonic() - start > time_limit):
            raise StopFit()
        for layer, value in zip(layers, x):
            layer['thickness_nm'] = float(value)
        pol = s['polarization']
        if pol == 'unpolarized':
            rs, ts = _polarized_rt(p, waves, 's')
            rp, tp = _polarized_rt(p, waves, 'p')
            r, t = (rs + rp) / 2, (ts + tp) / 2
        else:
            r, t = _polarized_rt(p, waves, pol)
        values = np.where(np.array(channels) == 'R', r, t) * 100 - targets
        if not np.all(np.isfinite(values)):
            raise ValueError('优化产生非有限光谱，已停止')
        evaluations += 1
        error = float(np.mean(values * values))
        if error < best_error:
            best, best_error = np.array(x), error
        return values

    initial_rmse = float(np.sqrt(np.mean(residual(best) ** 2)))
    status = 'converged'
    try:
        result = least_squares(residual, initial, bounds=(lower, upper), x_scale='jac', max_nfev=int(budget))
        if not result.success:
            status = 'budget'
    except StopFit:
        status = 'budget'
    for layer, value in zip(layers, best):
        layer['thickness_nm'] = float(value)
    p = validate(p)
    spectrum = calculate_spectrum(p)
    proposal = copy.deepcopy(project)
    for field in ('layers', 'back_layers'):
        for original, candidate in zip(proposal.get(field, []), p.get(field, [])):
            original['thickness_nm'] = candidate['thickness_nm']
    return {'project': proposal, 'spectrum': spectrum, 'initial_rmse': initial_rmse,
            'final_rmse': float(np.sqrt(best_error)), 'evaluations': evaluations, 'status': status,
            'elapsed_seconds': time.monotonic() - start,
            'note': '单一环境、固定材料与层序的局部膜厚优化；R/T 目标等权，误差单位为百分点。不保证全局最优；组系数不作为约束。'}
