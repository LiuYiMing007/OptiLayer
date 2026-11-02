"""Pure wavelength-dependent optical constants; no catalogue, storage or UI IO.

TFCalc formulas: supplied Manual section 2 p33, wavelength in micrometres.
Positive k denotes absorption. The scattering implementation uses n+ik.
"""
import numpy as np


def optical_constants(material, wavelength_nm):
    w = np.asarray(wavelength_nm, dtype=float)
    model = material.get('model', 'constant')
    with np.errstate(all='raise'):
        try:
            if model == 'constant':
                n = np.full(w.shape, float(material['n']))
                k = np.full(w.shape, float(material.get('k', 0)))
            elif model == 'tabulated':
                samples = np.asarray(material['samples'], dtype=float)
                if samples.ndim != 2 or samples.shape[1] != 3 or not len(samples):
                    raise ValueError('光学常数表为空或列数无效')
                if not np.all(np.isfinite(samples)) or np.any(samples[:, 0] <= 0) or np.any(np.diff(samples[:, 0]) <= 0):
                    raise ValueError('光学常数表波长必须递增且不重复')
                # TFCalc section 2 p32 explicitly uses linear interpolation and
                # nearest endpoint outside the table (one-point tables constant).
                n = np.interp(w, samples[:, 0], samples[:, 1])
                k = np.interp(w, samples[:, 0], samples[:, 2])
            elif model == 'tfcalc-formula':
                f = material['formula']; lo, hi = material['range_nm']
                if np.any(w < lo) or np.any(w > hi):
                    raise ValueError(f'色散公式有效范围 {lo:g}–{hi:g} nm，请调整计算／参考波长')
                a = f['coefficients']; x = w / 1000; x2 = x*x
                kind = f['n_type']
                if kind == 1:
                    n = np.sqrt(a[0] + a[1]*x2/(x2-a[2]))
                elif kind == 4:
                    n = np.sqrt(1 + sum(a[i]*x2/(x2-a[i+1]) for i in (0, 2, 4)))
                elif kind == 5:
                    n = a[0] + a[1]/x2 + a[2]/(x2*x2)
                elif kind == 6:
                    n = np.full(w.shape, a[0]) if a[1] == 0 else a[0] + a[1]/(x-a[2])
                else:
                    raise ValueError('尚未确认的 TFCalc 色散公式编号')
                b = f['k_coefficients']
                if f['k_type'] == 1:
                    k = np.zeros(w.shape)
                elif f['k_type'] == 2:
                    k = 1/(n*(b[0]*x + b[1]/x + b[2]/x**3))
                else:
                    raise ValueError('尚未确认的 TFCalc 消光公式编号')
            else:
                raise ValueError('未知材料模型')
        except (FloatingPointError, KeyError, TypeError, IndexError) as e:
            raise ValueError(f"{material.get('name', '材料')} 光学常数无效：{e}") from e
    if not np.all(np.isfinite(n)) or not np.all(np.isfinite(k)) or np.any(n <= 0) or np.any(k < 0):
        raise ValueError(f"{material.get('name', '材料')} 含非正折射率、负 k 或非有限值；未修改原值")
    return n, k
