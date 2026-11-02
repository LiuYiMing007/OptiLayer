"""Lossless coherent characteristic matrices, S/P and unpolarized incidence.

Physical thickness is the only thickness fed to the phase. Stored layers run
substrate -> incident medium; multiplication follows the reverse order.
For P, q=cos(theta)/n uses the tangential-H admittance convention. Its power
coefficients agree with the usual tangential-E convention; amplitude signs differ.
"""
import math
import numpy as np
from models import validate, number
from materials import optical_constants


def _constant_lossless_rt(project, wavelengths, polarization):
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


def active_materials(project):
    names={layer['material'] for layer in project['layers']}
    names.update(project['settings'][kind+'_material'] for kind in ('incident','substrate'))
    return [m for m in project['materials'] if m['name'] in names]


def _polarized_rt(project, wavelengths, polarization):
    active=active_materials(project)
    if all(m.get('model','constant')=='constant' and m.get('k',0)==0 for m in active):
        return _constant_lossless_rt(project,wavelengths,polarization)
    # Backward scattering recursion avoids exponentially growing transfer matrices
    # for thick/absorbing layers. No clipping, gain or silent material substitution.
    s=project['settings']; by_name={m['name']:m for m in active}
    def index(name):
        n,k=optical_constants(by_name[name],wavelengths)
        return n+1j*k
    n0=index(s['incident_material']); ns=index(s['substrate_material'])
    if np.any(n0.imag != 0):
        raise ValueError('当前入射介质必须无吸收；吸收膜层及基底受支持')
    indices=[n0]+[index(l['material']) for l in reversed(project['layers'])]+[ns]
    thickness=[l['thickness_nm'] for l in reversed(project['layers'])]
    tangential=n0*np.sin(np.deg2rad(s['angle_deg']))
    gamma=[np.lib.scimath.sqrt(n*n-tangential*tangential) for n in indices]
    # Forward branch: decay into passive matter, positive flux for lossless media.
    gamma=[np.where((g.imag < 0) | ((g.imag == 0)&(g.real < 0)), -g,g) for g in gamma]
    def interface(i):
        gi,gj=gamma[i],gamma[i+1];ni,nj=indices[i],indices[i+1]
        if polarization=='s':return (gi-gj)/(gi+gj), 2*gi/(gi+gj)
        den=nj*nj*gi+ni*ni*gj
        return (nj*nj*gi-ni*ni*gj)/den, 2*ni*nj*gi/den
    with np.errstate(over='raise',invalid='raise',divide='raise',under='ignore'):
        try:
            r,t=interface(len(indices)-2)
            for i in range(len(indices)-3,-1,-1):
                ri,ti=interface(i)
                phase=np.exp(2j*np.pi*gamma[i+1]*thickness[i]/wavelengths)
                denominator=1+ri*r*phase*phase
                t=ti*t*phase/denominator
                r=(ri+r*phase*phase)/denominator
            flux=gamma[-1].real if polarization=='s' else (ns*np.conj(gamma[-1]/ns)).real
            R=np.abs(r)**2;T=flux/gamma[0].real*np.abs(t)**2
        except FloatingPointError as e:
            raise ValueError('当前材料／入射条件在散射计算中产生奇点') from e
    if not np.all(np.isfinite(R)) or not np.all(np.isfinite(T)):
        raise ValueError('计算产生非有限光谱')
    return R,T


def material_notes(project,wavelengths):
    notes=[]
    for m in active_materials(project):
        if m.get('model')=='tabulated':
            lo,hi=m['range_nm']
            if np.min(wavelengths)<lo or np.max(wavelengths)>hi:
                notes.append(f"{m['name']}：表范围 {lo:g}–{hi:g} nm，范围外采用最近端点（TFCalc 规则）")
        notes.extend(f"{m['name']}：{issue}" for issue in m.get('issues',[]))
    return notes


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
    absorbing = any(np.any(optical_constants(m,wavelengths)[1] > 0) for m in active_materials(p))
    errors = np.maximum(-absorption, 0) if absorbing else np.abs(absorption)
    label = {'s':'S', 'p':'P', 'unpolarized':'非偏振 (S/P 平均)'}[pol]
    return {'wavelength_nm': wavelengths.tolist(), 'R_percent':(100*r).tolist(), 'T_percent':(100*t).tolist(),
            'A_percent':(100*absorption).tolist(), 'Rs_percent':(100*rs).tolist(), 'Rp_percent':(100*rp).tolist(),
            'Ts_percent':(100*ts).tolist(), 'Tp_percent':(100*tp).tolist(),
            'energy_error':errors.tolist(), 'max_energy_error':float(np.max(errors)),
            'absorbing':bool(absorbing), 'warnings':material_notes(p,wavelengths),
            'energy_check':'passivity_violation' if absorbing else 'lossless_residual',
            'model':f"{s['angle_deg']:g}° · {label} · {'色散 / 吸收 n,k' if any(m.get('model') != 'constant' or m.get('k',0) != 0 for m in active_materials(p)) else '常数 n / k=0'} · 半无限基底，不含背面", 'input_snapshot':p}


def calculate_rt(project, wavelength_nm, polarization=None):
    p = validate(project)
    wavelength = number(wavelength_nm, '波长', 1, 1e7)
    pol = polarization or p['settings']['polarization']
    if pol not in ('s','p','unpolarized'):
        raise ValueError('偏振无效')
    rs, ts = _polarized_rt(p, np.array([wavelength]), 's')
    rp, tp = _polarized_rt(p, np.array([wavelength]), 'p')
    r,t = (rs[0],ts[0]) if pol=='s' else (rp[0],tp[0]) if pol=='p' else ((rs[0]+rp[0])/2,(ts[0]+tp[0])/2)
    return {'wavelength_nm':wavelength,'R_percent':float(100*r),'T_percent':float(100*t),'A_percent':float(100*(1-r-t)),'energy_error':float(max(0,r+t-1) if any(np.any(optical_constants(m,np.array([wavelength]))[1]>0) for m in active_materials(p)) else abs(1-r-t))}
