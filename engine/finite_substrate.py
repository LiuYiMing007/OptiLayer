"""Coherent coatings and a finite bulk substrate, isolated from legacy optics.

The intensity sum follows Byrnes, arXiv:1603.02720 section 6. Coherent blocks
use scaled characteristic matrices (passive n+ik convention); no transmission
floor or clipping is applied. Stored front/back layers both run substrate-outward.
"""
import numpy as np
from materials import optical_constants


def forward_gamma(n, beta):
    g = np.lib.scimath.sqrt(n*n-beta*beta)
    return np.where((g.imag < 0) | ((g.imag == 0) & (g.real < 0)), -g, g)


def coherent_rt(indices, thickness, beta, wavelengths, polarization):
    gamma = [forward_gamma(n, beta) for n in indices]
    q = gamma if polarization == 's' else [g/(n*n) for g, n in zip(gamma, indices)]
    size = len(wavelengths)
    a = np.ones(size, complex); b = np.zeros(size, complex)
    c = b.copy(); d = a.copy(); log_amplitude = np.zeros(size)
    with np.errstate(over='raise', invalid='raise', divide='raise', under='ignore'):
        for j, physical in enumerate(thickness, 1):
            delta = 2*np.pi*physical*gamma[j]/wavelengths
            phase = np.exp(1j*delta)
            sine = (phase*phase-1)/(2j)
            cosine = (1+phase*phase)/2
            # scaled sin(delta)/q has an analytic limit at the critical angle.
            upper = np.empty(size, complex)
            nonzero = gamma[j] != 0
            np.divide(sine, q[j], out=upper, where=nonzero)
            factor = 1 if polarization == 's' else indices[j]*indices[j]
            limit = 2*np.pi*physical/wavelengths*factor
            upper = np.where(nonzero, upper, limit)
            lower = sine*q[j]
            upper *= -1j; lower *= -1j
            a, b, c, d = a*cosine+b*lower, a*upper+b*cosine, c*cosine+d*lower, c*upper+d*cosine
            norm = np.maximum.reduce([np.abs(a), np.abs(b), np.abs(c), np.abs(d), np.ones(size)])
            a /= norm; b /= norm; c /= norm; d /= norm
            log_amplitude -= delta.imag + np.log(norm)
        entrance, final = q[0], q[-1]
        denominator = entrance*(a+b*final)+c+d*final
        r = (entrance*(a+b*final)-c-d*final)/denominator
        t = 2*entrance/denominator
        R = np.abs(r)**2
        T = final.real/entrance.real*np.abs(t)**2*np.exp(2*log_amplitude)
    if not np.all(np.isfinite(R)) or not np.all(np.isfinite(T)):
        raise ValueError('有限基底计算产生非有限值，请检查材料、厚度和临界角条件')
    return R, T


def environment_rt(project, wavelengths, polarization):
    s = project['settings']; mode = s.get('substrate_model', 'semi_infinite')
    materials = {m['name']: m for m in project['materials']}
    def index(name):
        n, k = optical_constants(materials[name], wavelengths)
        return n+1j*k
    incident = index(s['incident_material']); substrate = index(s['substrate_material'])
    exit_index = index(s.get('exit_material', s['substrate_material']))
    front = list(reversed(project['layers'])); back = project.get('back_layers', [])
    first_back = s.get('first_surface', 'front') == 'back'
    if mode == 'semi_infinite':
        # Only called for reversed incidence; front legacy route remains untouched.
        indices = [substrate]+[index(l['material']) for l in project['layers']]+[incident]
        layers = project['layers']; entrance = substrate
    else:
        indices = [incident]+[index(l['material']) for l in front]+[substrate]+[index(l['material']) for l in back]+[exit_index]
        layers = front+[{'thickness_nm': float(s['substrate_thickness_mm'])*1e6}]+back
        entrance = incident
        if first_back:
            indices = list(reversed(indices)); layers = list(reversed(layers)); entrance = exit_index
    if np.any(entrance.imag != 0):
        raise ValueError('当前照射方向的入射介质必须无吸收；未将 k 改为零')
    beta = entrance*np.sin(np.deg2rad(float(s['angle_deg'])))
    if mode in ('semi_infinite', 'coherent'):
        return coherent_rt(indices, [l['thickness_nm'] for l in layers], beta, wavelengths, polarization)
    bulk_position = len(back)+1 if first_back else len(front)+1
    first_indices = indices[:bulk_position+1]; second_indices = indices[bulk_position:]
    first_d = [l['thickness_nm'] for l in layers[:bulk_position-1]]
    second_d = [l['thickness_nm'] for l in layers[bulk_position:]]
    rf, tf = coherent_rt(first_indices, first_d, beta, wavelengths, polarization)
    # A lossless evanescent bulk has no propagating intensity to sum incoherently.
    g = forward_gamma(substrate, beta)
    propagating = g.real > 0
    R = rf.copy(); T = np.zeros(len(wavelengths))
    if np.any(propagating):
        mask = propagating
        cut = lambda ns: [n[mask] for n in ns]
        rr, tr = coherent_rt(cut(list(reversed(first_indices))), list(reversed(first_d)), beta[mask], wavelengths[mask], polarization)
        rb, tb = coherent_rt(cut(second_indices), second_d, beta[mask], wavelengths[mask], polarization)
        attenuation = np.exp(-4*np.pi*float(s['substrate_thickness_mm'])*1e6*g[mask].imag/wavelengths[mask])
        denominator = 1-rr*rb*attenuation*attenuation
        if np.any(denominator <= 0):
            raise ValueError('非相干往返求和出现奇点，不能给出可靠光谱')
        R[mask] += tf[mask]*tr*rb*attenuation*attenuation/denominator
        T[mask] = tf[mask]*tb*attenuation/denominator
    if not np.all(np.isfinite(R)) or not np.all(np.isfinite(T)):
        raise ValueError('非相干基底计算产生非有限值')
    return R, T
