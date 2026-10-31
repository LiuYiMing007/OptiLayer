"""Lossless coherent characteristic matrices, S/P and unpolarized incidence.

Physical thickness is the only thickness fed to the phase. Stored layers run
substrate -> incident medium; multiplication follows the reverse order.
For P, q=cos(theta)/n uses the tangential-H admittance convention. Its power
coefficients agree with the usual tangential-E convention; amplitude signs differ.
"""
import math
import numpy as np
from models import validate, number


def _polarized_rt(project, wavelengths, polarization):
    s = project['settings']
    n0, ns = float(s['incident_n']), float(s['substrate_n'])
    tangential = n0 * math.sin(math.radians(float(s['angle_deg'])))
    def cosine(n):
        return np.lib.scimath.sqrt(1-(tangential/n)**2)
    def admittance(n):
        return n*cosine(n) if polarization == 's' else cosine(n)/n
    a = np.ones(len(wavelengths), dtype=complex)
    b = np.zeros(len(wavelengths), dtype=complex)
    c, d = b.copy(), a.copy()
    materials = {m['name']: float(m['n']) for m in project['materials']}
    with np.errstate(over='raise', invalid='raise', divide='raise'):
        try:
            for layer in reversed(project['layers']):
                n = materials[layer['material']]
                cos_theta = cosine(n)
                phase_base = 2*np.pi*float(layer['thickness_nm'])/wavelengths
                delta = phase_base*n*cos_theta
                u = np.cos(delta)
                # Analytic limits at cos(theta)=0 prevent a 0/0 critical-angle bug.
                sinc = np.sinc(delta/np.pi)
                if polarization == 's':
                    upper = 1j*sinc*phase_base
                    lower = 1j*sinc*phase_base*n*n*cos_theta*cos_theta
                else:
                    upper = 1j*sinc*phase_base*n*n
                    lower = 1j*sinc*phase_base*cos_theta*cos_theta
                a, b, c, d = a*u+b*lower, a*upper+b*u, c*u+d*lower, c*upper+d*u
            q0, qs = admittance(n0), admittance(ns)
            denominator = q0*(a+b*qs)+c+d*qs
            reflection = np.abs((q0*(a+b*qs)-c-d*qs)/denominator)**2
            transmission = float(np.real(qs)/np.real(q0))*np.abs(2*q0/denominator)**2
        except FloatingPointError as error:
            raise ValueError('当前膜系超出矩阵法数值稳定范围，请检查膜厚和入射条件') from error
    if not np.all(np.isfinite(reflection)) or not np.all(np.isfinite(transmission)):
        raise ValueError('光谱包含非有限结果')
    return reflection, transmission


def calculate_spectrum(project):
    p = validate(project)
    s = p['settings']
    start, end, step = (float(s[k]) for k in ('start_nm','end_nm','step_nm'))
    wavelengths = start + np.arange(int(math.floor((end-start)/step+1e-9))+1)*step
    rs, ts = _polarized_rt(p, wavelengths, 's')
    rp, tp = _polarized_rt(p, wavelengths, 'p')
    pol = s['polarization']
    r, t = (rs, ts) if pol == 's' else (rp, tp) if pol == 'p' else ((rs+rp)/2, (ts+tp)/2)
    absorption = 1-r-t  # Raw residual. Never renormalize or clip R/T to hide errors.
    label = {'s':'S', 'p':'P', 'unpolarized':'非偏振 (S/P 平均)'}[pol]
    return {'wavelength_nm': wavelengths.tolist(), 'R_percent':(100*r).tolist(), 'T_percent':(100*t).tolist(),
            'A_percent':(100*absorption).tolist(), 'Rs_percent':(100*rs).tolist(), 'Rp_percent':(100*rp).tolist(),
            'Ts_percent':(100*ts).tolist(), 'Tp_percent':(100*tp).tolist(),
            'energy_error':np.abs(absorption).tolist(), 'max_energy_error':float(np.max(np.abs(absorption))),
            'model':f"{s['angle_deg']:g}° · {label} · 常数 n / k=0 · 不含基底背面", 'input_snapshot':p}


def calculate_rt(project, wavelength_nm, polarization=None):
    p = validate(project)
    wavelength = number(wavelength_nm, '波长', 1, 1e7)
    pol = polarization or p['settings']['polarization']
    if pol not in ('s','p','unpolarized'):
        raise ValueError('偏振无效')
    rs, ts = _polarized_rt(p, np.array([wavelength]), 's')
    rp, tp = _polarized_rt(p, np.array([wavelength]), 'p')
    r,t = (rs[0],ts[0]) if pol=='s' else (rp[0],tp[0]) if pol=='p' else ((rs[0]+rp[0])/2,(ts[0]+tp[0])/2)
    return {'wavelength_nm':wavelength,'R_percent':float(100*r),'T_percent':float(100*t),'A_percent':float(100*(1-r-t)),'energy_error':float(abs(1-r-t))}
