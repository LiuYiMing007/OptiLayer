"""Sampled spectrum metrics. No optical computation or curve normalization."""
import numpy as np
from scipy.signal import find_peaks
from models import number


def crossings(x,y,level):
    found=[]
    i=0
    while i<len(x)-1:
        a,b=y[i]-level,y[i+1]-level
        if a*b<0:
            wavelength=x[i]+(x[i+1]-x[i])*(-a)/(b-a)
            found.append({'wavelength_nm':float(wavelength),'direction':'rising' if b>a else 'falling'})
        elif b==0:
            j=i+1
            while j+1<len(x) and y[j+1]==level:
                j+=1
            if a!=0 and j+1<len(x) and (y[j+1]-level)*a<0:
                found.append({'wavelength_nm':float((x[i+1]+x[j])/2),'direction':'rising' if a<0 else 'falling'})
            i=j
        i+=1
    return found


def band_mean(x,y,band):
    if not band:
        return None
    lo=number(band['start_nm'],'波段起点',1,1e7)
    hi=number(band['end_nm'],'波段终点',lo,1e7,strict=True)
    if lo<x[0] or hi>x[-1]:
        return {'error':'区间超出已计算光谱范围，请调整区间或重新计算'}
    inner=(x>lo)&(x<hi)
    xs=np.concatenate(([lo],x[inner],[hi]))
    ys=np.interp(xs,x,y)
    return {'start_nm':lo,'end_nm':hi,'mean_percent':float(np.trapezoid(ys,xs)/(hi-lo))}


def analyze_spectrum(spectrum,bands=None):
    x=np.asarray(spectrum['wavelength_nm'],dtype=float)
    r=np.asarray(spectrum['R_percent'],dtype=float)
    t=np.asarray(spectrum['T_percent'],dtype=float)
    if len(x)<2 or len(x)>10001 or x.shape!=r.shape or x.shape!=t.shape or not np.all(np.diff(x)>0) or not all(np.all(np.isfinite(a)) for a in (x,r,t)):
        raise ValueError('分析需要有限、等长、波长严格递增的光谱数组')
    def summary(y):
        low,high=int(np.argmin(y)),int(np.argmax(y))
        peaks,_=find_peaks(y,prominence=0.01)
        valleys,_=find_peaks(-y,prominence=0.01)
        point=lambda i:{'wavelength_nm':float(x[i]),'value_percent':float(y[i])}
        return {'min':point(low),'max':point(high),'mean_percent':float(np.trapezoid(y,x)/(x[-1]-x[0])),
                'peaks':[point(i) for i in peaks], 'valleys':[point(i) for i in valleys]}
    levels={str(level):crossings(x,t,level) for level in (10,50,90)}
    edges=[]
    for direction, first,last in [('rising','10','90'),('falling','90','10')]:
        for start in levels[first]:
            if start['direction']!=direction:continue
            candidates=[end for end in levels[last] if end['direction']==direction and end['wavelength_nm']>start['wavelength_nm']]
            if not candidates:continue
            end=candidates[0]
            lo,hi=start['wavelength_nm'],end['wavelength_nm']
            values=np.concatenate(([float(first)],t[(x>lo)&(x<hi)],[float(last)]))
            differences=np.diff(values)*(1 if direction=='rising' else -1)
            if np.any(differences < -1e-9):continue
            midpoint=next((p['wavelength_nm'] for p in levels['50'] if p['direction']==direction and lo<=p['wavelength_nm']<=hi),None)
            if midpoint is None:continue
            edges.append({'direction':direction,'start_nm':lo,'end_nm':hi,'cutoff_50_nm':midpoint,'width_nm':hi-lo,'slope_percent_per_nm':80/(hi-lo)})
    bands=bands or {}
    return {'T':summary(t),'R':summary(r),'crossings':levels,'edges':sorted(edges,key=lambda e:e['start_nm']),
            'passband_T':band_mean(x,t,bands.get('passband')),'stopband_T':band_mean(x,t,bands.get('stopband')),
            'stopband_R':band_mean(x,r,bands.get('stopband')),
            'note':'峰谷按采样值识别（显著度≥0.01 个百分点）；阈值线性插值；10–90% 边缘只配对同一单调分支。波段均值按波长积分。'}
