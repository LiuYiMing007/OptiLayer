"""Thickness fitting and process-drift diagnostics; Optical Core stays authoritative."""
import copy
import time
import numpy as np
from scipy.optimize import least_squares
from models import validate, number
from optics import calculate_spectrum, _polarized_rt, active_materials, material_notes


def optimize(project, variables, max_evaluations=12000, time_limit=60, options=None):
    p = validate(copy.deepcopy(project)); options = options or {}
    if not isinstance(variables, list) or not 1 <= len(variables) <= 256:
        raise ValueError('请选择 1–256 个膜层作为优化变量')
    budget = int(number(max_evaluations, '计算预算', 10, 30000))
    duration = number(options.get('seconds', time_limit), '运行时间', 0, 120)
    strength = number(options.get('regularization', 0.1 if options else 0), '偏差约束', 0, 10)
    parameterization = options.get('parameterization', 'layer')
    mode = options.get('mode', 'fit')
    if mode not in ('fit', 'target') or parameterization not in ('layer', 'material', 'group', 'global'):
        raise ValueError('优化模式或变量类型无效')
    starts = int(number(options.get('starts', 3), '搜索起点数', 1, 5))
    points = p.get('target_points', [])
    if not 1 <= len(points) <= 10001:
        raise ValueError('需要 1–10001 个目标/实测点，请导入 CSV')
    s = p['settings']; roi = options.get('range_nm', [s['start_nm'], s['end_nm']])
    if not isinstance(roi, list) or len(roi) != 2:
        raise ValueError('拟合波段需要起止波长')
    lo = number(roi[0], '拟合波段起点', s['start_nm'], s['end_nm'])
    hi = number(roi[1], '拟合波段终点', lo, s['end_nm'], strict=True)
    selected_points = [q for q in points if lo <= q['wavelength_nm'] <= hi]
    if not selected_points:
        raise ValueError('拟合波段内没有数据点')
    # Use actual samples, never a smoothed or invented target. Large files use
    # an explicit uniform subset during search and all ROI points for reporting.
    indices = np.unique(np.linspace(0, len(selected_points)-1, min(2001, len(selected_points)), dtype=int))
    search_points = [selected_points[i] for i in indices]
    def observations(data):
        waves = np.array([q['wavelength_nm'] for q in data])
        wave_idx, channels, targets = [], [], []
        for i, q in enumerate(data):
            for channel in ('R', 'T'):
                if q.get(channel + '_percent') is not None:
                    wave_idx.append(i); channels.append(channel); targets.append(q[channel + '_percent'])
        if not targets: raise ValueError('数据需要 R 或 T 百分比')
        return waves, np.array(wave_idx), np.array(channels), np.array(targets)
    waves, wave_idx, channels, targets = observations(search_points)
    layers, lower, upper, nominal, seen, labels = [], [], [], [], set(), []
    for v in variables:
        side = v.get('side', 'front'); key = (side, v['id'])
        if side not in ('front', 'back') or key in seen: raise ValueError('优化膜层表面无效或重复')
        seen.add(key)
        face = p['layers'] if side == 'front' else p.get('back_layers', [])
        layer = next((l for l in face if l['id'] == v['id']), None)
        if layer is None: raise ValueError('优化膜层不存在')
        a = number(v['min_nm'], '最小厚度', 0, 1e6); b = number(v['max_nm'], '最大厚度', a, 1e6, strict=True)
        if not a <= layer['thickness_nm'] <= b: raise ValueError('当前厚度必须位于优化上下限内')
        layers.append(layer); lower.append(a); upper.append(b); nominal.append(layer['thickness_nm'])
        labels.append({'side': side, 'id': layer['id'], 'index': face.index(layer)+1, 'material': layer['material'], 'group': layer.get('group', 0)})
    nominal = np.array(nominal); lower = np.array(lower); upper = np.array(upper)
    # Percent coordinates give thin and thick layers comparable steps. Zero layers
    # retain a finite scale and may grow; they have no multiplicative compensation.
    scale = np.maximum(nominal, 1) / 100
    lower_x = (lower-nominal)/scale; upper_x = (upper-nominal)/scale
    started = time.monotonic(); evaluations = 0; history = []; best = np.zeros(len(layers)); best_cost = float('inf'); best_rmse = None
    status = 'converged'
    class StopFit(Exception): pass
    def spectrum_values(data_waves):
        # At exact normal incidence S and P intensities are identical. The same
        # production routine is used; no second optical formula is introduced.
        pol = s['polarization']
        if pol == 'unpolarized' and s['angle_deg'] != 0:
            rs, ts = _polarized_rt(p, data_waves, 's'); rp, tp = _polarized_rt(p, data_waves, 'p')
            return (rs+rp)*50, (ts+tp)*50
        r, t = _polarized_rt(p, data_waves, 's' if pol == 'unpolarized' else pol)
        return r*100, t*100
    def set_x(x):
        for layer, d in zip(layers, nominal + scale*x): layer['thickness_nm'] = float(d)
    def evaluate(x, record=True):
        nonlocal evaluations, best, best_cost, best_rmse
        if evaluations >= budget or (evaluations and time.monotonic()-started >= duration): raise StopFit()
        set_x(x); r, t = spectrum_values(waves)
        residual = np.where(channels == 'R', r[wave_idx], t[wave_idx])-targets
        if not np.all(np.isfinite(residual)): raise ValueError('优化产生非有限光谱，已停止')
        evaluations += 1
        reg = strength*x*np.sqrt(len(residual)/len(x))
        total = np.concatenate((residual, reg)) if strength else residual
        cost = float(np.mean(residual**2) + strength**2*np.mean(x*x))
        if record and cost < best_cost:
            best, best_cost, best_rmse = x.copy(), cost, float(np.sqrt(np.mean(residual**2)))
            history.append({'evaluation': evaluations, 'rmse': best_rmse, 'seconds': time.monotonic()-started})
        return total
    def grouping(kind):
        keys = [0 if kind == 'global' else l['material'] if kind == 'material' else (d['side'], l.get('group', 0)) if kind == 'group' and l.get('group', 0) else i for i, (l, d) in enumerate(zip(layers, labels))]
        unique = list(dict.fromkeys(keys))
        return np.array([unique.index(k) for k in keys])
    def solve(seed, kind, limit):
        nonlocal status
        group = grouping(kind); count = int(max(group))+1
        lows = np.array([max(lower_x[group == i]) for i in range(count)])
        highs = np.array([min(upper_x[group == i]) for i in range(count)])
        if np.any(lows >= highs): return
        x0 = np.array([np.mean(seed[group == i]) for i in range(count)]); x0 = np.clip(x0, lows, highs)
        # Explicit finite-difference Jacobian: derivative probes do not count as
        # accepted best designs. This also provides stable percent-sized steps.
        def fun(z): return evaluate(z[group])
        def jac(z):
            base = evaluate(z[group], False); columns = []
            for i in range(count):
                step = min(0.001, highs[i]-z[i])
                if step < 1e-6: step = -min(0.001, z[i]-lows[i])
                shifted = z.copy(); shifted[i] += step
                columns.append((evaluate(shifted[group], False)-base)/step)
            return np.array(columns).T
        result = least_squares(fun, x0, jac=jac, bounds=(lows, highs), x_scale='jac', max_nfev=limit, ftol=1e-8, xtol=1e-7, gtol=1e-7)
        if not result.success: status = 'budget'
        evaluate(result.x[group])
    initial_residual = evaluate(best)
    initial_rmse = float(np.sqrt(np.mean(initial_residual[:len(targets)]**2)))
    seeds = [np.zeros(len(layers))]
    try:
        # Coarse shared drift first, then material drift, then the requested
        # layer/group variables. Shared prefit is used only for independent layers.
        if len(layers) > 2:
            a, b = max(lower_x), min(upper_x)
            if a < b:
                candidates = []
                for value in np.linspace(max(a, -8), min(b, 8), 17):
                    x = np.full(len(layers), value); e = evaluate(x)
                    candidates.append((float(np.mean(e*e)), x))
                seeds = [q[1] for q in sorted(candidates, key=lambda q:q[0])[:starts]]
            if parameterization == 'layer':
                for seed in seeds: solve(seed, 'material', 35)
        elif starts > 1:
            rng = np.random.default_rng(310)
            seeds.extend(np.clip(rng.normal(0, 1, len(layers)), lower_x, upper_x) for _ in range(starts-1))
        warm = best.copy()
        for i in range(starts):
            seed = warm if i == 0 else np.clip(warm + np.random.default_rng(310+i).normal(0, 0.8, len(layers)), lower_x, upper_x)
            if parameterization != 'layer': seed = seeds[min(i, len(seeds)-1)]
            solve(seed, parameterization, 100)
            warm = best.copy()
    except StopFit: status = 'budget'
    set_x(best)
    fit_waves, fit_idx, fit_channels, fit_targets = observations(selected_points)
    r, t = spectrum_values(fit_waves); final_residual = np.where(fit_channels == 'R', r[fit_idx], t[fit_idx])-fit_targets
    final_rmse = float(np.sqrt(np.mean(final_residual**2)))
    set_x(np.zeros(len(layers))); r0, t0 = spectrum_values(fit_waves)
    initial_rmse = float(np.sqrt(np.mean((np.where(fit_channels == 'R', r0[fit_idx], t0[fit_idx])-fit_targets)**2)))
    set_x(best)
    proposal = copy.deepcopy(project)
    for field in ('layers', 'back_layers'):
        for original, candidate in zip(proposal.get(field, []), p.get(field, [])): original['thickness_nm'] = candidate['thickness_nm']
    # Local sensitivity and numerical rank describe identifiability, not blame.
    derivative_columns = []; diagnostic_deadline = time.monotonic()+8
    for i in range(len(layers)):
        if time.monotonic() > diagnostic_deadline: break
        dx = 0.001; shifted = best.copy(); shifted[i] += dx
        set_x(shifted); rr, tt = spectrum_values(waves)
        set_x(best); rb, tb = spectrum_values(waves)
        derivative_columns.append((np.where(channels == 'R', rr[wave_idx]-rb[wave_idx], tt[wave_idx]-tb[wave_idx]))/dx)
    jacobian = np.array(derivative_columns).T
    singular = np.linalg.svd(jacobian, compute_uv=False) if derivative_columns else np.array([])
    rank = int(np.sum(singular > (singular[0]*1e-3 if len(singular) else 0)))
    diagnostics = []
    compensation = copy.deepcopy(project); compensation_ok = mode == 'fit' and bool(np.all(nominal > 0) and np.all(nominal+scale*best > 0))
    for i, (label, d, x) in enumerate(zip(labels, nominal, best)):
        fitted = float(d+scale[i]*x); correction = float(d*d/fitted) if d > 0 and fitted > 0 else None
        if correction is None or correction > 1e6: compensation_ok = False
        face = compensation['layers'] if label['side'] == 'front' else compensation.get('back_layers', [])
        if correction is not None and correction <= 1e6: next(l for l in face if l['id'] == label['id'])['thickness_nm'] = correction
        diagnostics.append({**label, 'nominal_nm': float(d), 'fitted_nm': fitted, 'delta_nm': fitted-float(d),
            'delta_percent': float(100*(fitted/d-1)) if d else None, 'compensation_nm': correction,
            'sensitivity_pp_per_percent': float(np.sqrt(np.mean(jacobian[:, i]**2))) if i < len(derivative_columns) else None,
            'at_bound': bool(abs(x-lower_x[i]) < 0.001 or abs(x-upper_x[i]) < 0.001)})
    set_x(best); fitted_spectrum = calculate_spectrum(p)
    warnings = material_notes(p, fit_waves)
    if rank < len(layers): warnings.append(f'局部灵敏度矩阵有效秩 {rank}/{len(layers)}；部分膜厚变化高度相关，单条光谱不能唯一定位实际层厚。')
    if any(d['at_bound'] for d in diagnostics): warnings.append('部分层达到厚度边界；请检查偏差范围、材料数据、测量条件及模型是否合适。')
    if len(derivative_columns) < len(layers): warnings.append('灵敏度诊断达到时间预算，仅完成部分膜层。')
    return {'project': proposal, 'spectrum': fitted_spectrum, 'nominal_spectrum': calculate_spectrum(project),
        'compensation_project': compensation if compensation_ok else None, 'diagnostics': diagnostics,
        'initial_rmse': initial_rmse, 'final_rmse': final_rmse, 'evaluations': evaluations, 'status': status,
        'elapsed_seconds': time.monotonic()-started, 'history': history[-200:], 'warnings': warnings,
        'fit_range_nm': [float(fit_waves.min()), float(fit_waves.max())], 'used_points': len(selected_points),
        'ignored_points': len(points)-len(selected_points), 'search_points': len(search_points), 'rank': rank,
        'diagnosed_variables': len(derivative_columns), 'variables': len(layers), 'mode': mode,
        'note': '固定材料与层序，按实际物理厚度拟合。层厚非唯一；灵敏度不是故障概率。补偿 d²/d拟合 仅在同类乘性偏差可重复时成立，不能修改已镀成品。'}
