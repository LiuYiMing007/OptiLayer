"""Write reproducible optical validation evidence without modifying fixtures."""
import copy
import csv
import json
import math
from pathlib import Path
import sys
import numpy as np
from tmm import coh_tmm
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'engine'))
import main as engine
from models import BUILTIN_MATERIALS

template={'schema_version':1,'id':'validation','name':'验证','layer_order':'substrate_to_air','settings':{'incident_n':1,'substrate_n':1.52},'materials':copy.deepcopy(BUILTIN_MATERIALS),'layers':[]}
p=engine.parse_tfd((ROOT/'fixtures/reference/reference_4layer_550nm.tfd').read_text(),template)
result=engine.calculate(p)
with (ROOT/'fixtures/reference/reference_4layer_550nm_spectrum.csv').open(encoding='utf-8-sig') as f:expected=list(csv.DictReader(f))
checks=[]
def check(name,actual,expected,tolerance):
 error=abs(actual-expected)
 row={'test':name,'actual':float(actual),'expected':float(expected),'absolute_error':float(error),'tolerance':tolerance,'pass':bool(error<=tolerance)}
 checks.append(row)
 return row
bare=copy.deepcopy(p);bare['layers']=[]
b=engine.calculate_rt(bare,550)
check('裸基底 R (%)',b['R_percent'],100*((1-1.52)/(1+1.52))**2,1e-10)
check('裸基底 T (%)',b['T_percent'],100*(1-((1-1.52)/(1+1.52))**2),1e-10)
single=copy.deepcopy(p);single['materials'][0]['n']=2;single['layers']=single['layers'][:1];single['layers'][0]['thickness_nm']=68.75
single['settings'].pop('substrate_material',None);single['settings']['substrate_n']=1.5
s=engine.calculate_rt(single,550)
single_r=100*((1.5-4)/(1.5+4))**2
check('单层 QWOT=1，550 nm R (%)',s['R_percent'],single_r,1e-10)
check('单层 QWOT=1，550 nm T (%)',s['T_percent'],100-single_r,1e-10)
comparison=[]
for i,e in enumerate(expected):
 row={'wavelength_nm':result['wavelength_nm'][i]}
 for key in ('R_percent','T_percent'):
  actual=result[key][i];gold=float(e[key]);row.update({key:actual,f'expected_{key}':gold,f'error_{key}':abs(actual-gold)})
  if i%50==0:check(f"Golden {row['wavelength_nm']:g} nm {key}",actual,gold,1e-5)
 comparison.append(row)
max_golden=max(row[key] for row in comparison for key in ('error_R_percent','error_T_percent'))
check('Golden 全部 301 点最大误差（百分点）',max_golden,0,1e-5)
check('Golden max |R+T−1|',result['max_energy_error'],0,1e-10)
feedback=json.loads((ROOT/'fixtures/user-feedback/380nm-project.json').read_text())
f=engine.calculate(feedback)
reference_errors=[]
for case,label in [(feedback,'380nm 使用反馈'),(p,'四层膜系')]:
 for angle in ([0] if label.startswith('380') else [0,30,45,75]):
  case=copy.deepcopy(case);case['settings']['angle_deg']=angle
  normalized=engine.validate(case)
  ns={m['name']:m['n'] for m in normalized['materials']};layers=list(reversed(normalized['layers']))
  indices=[normalized['settings']['incident_n']]+[ns[l['material']] for l in layers]+[normalized['settings']['substrate_n']]
  thicknesses=[np.inf]+[l['thickness_nm'] for l in layers]+[np.inf]
  values=engine.calculate(case)
  errors=[]
  for i,w in enumerate(values['wavelength_nm']):
   for pol in ('s','p'):
    independent=coh_tmm(pol,indices,thicknesses,math.radians(angle),w)
    for key in ('R','T'):
     errors.append(abs(values[f'{key}{pol}_percent'][i]-100*independent[key]))
  reference_errors.append(check(f'{label} {angle}° S/P 独立实现最大误差（百分点）',max(errors),0,1e-8))
report={'date':'2026-10-30','checks':checks,'user_case_380nm':f['reference_point'],'golden_max_error_percentage_points':max_golden,'independent_reference':'sbyrnes321/tmm 0.2.0','all_pass':all(c['pass'] for c in checks)}
assert report['all_pass'],report
out=ROOT/'docs'
(out/'v0.1.1-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
with (out/'v0.1.1-golden-comparison.csv').open('w',newline='') as fcsv:
 writer=csv.DictWriter(fcsv,fieldnames=comparison[0].keys());writer.writeheader();writer.writerows(comparison)
lines=['# V0.1.1 光谱引擎验收','', '2026-10-30。以下值来自实际运行；未改动原始 Golden CSV，未裁剪、归一化 R/T。', '', '| 验证项 | 实际值 | 预期值 | 绝对误差 | 容差 | 结果 |', '|---|---:|---:|---:|---:|---|']
for c in checks:lines.append(f"| {c['test']} | {c['actual']:.12g} | {c['expected']:.12g} | {c['absolute_error']:.3g} | {c['tolerance']:.1g} | {'PASS' if c['pass'] else 'FAIL'} |")
lines+=['','## 使用反馈案例','',f"380 nm：T={f['reference_point']['T_percent']:.10f}%，R={f['reference_point']['R_percent']:.10f}%。与独立实现一致，高透过结果不应人为修正；使用自动纵轴和单独显示 T 查看细节。",'', '## 依据与边界','', '- 解析算例：裸界面 Fresnel，单层四分之一波膜。','- 原始 Golden 文件：fixtures/reference，301 点逐点比较见 v0.1.1-golden-comparison.csv。','- 独立实现：[sbyrnes321/tmm](https://github.com/sbyrnes321/tmm)，仅作为开发测试依赖，不被生产计算调用。','- 推导参考：[Steven J. Byrnes, Multilayer optical calculations](https://arxiv.org/abs/1603.02720)。','- 适用：常数实数 n，k=0；0–89.9°，S/P 和非偏振；单面相干膜；无基底背面。','- 暂未实现：吸收、色散数据、非相干厚基底和完整 TFCalc 文件兼容。','- A 为原始数值残差；不将微小负值修剪为零掩盖误差。','- 当前材料模型为可扩展的具名快照，REF 不代表真实薄膜/玻璃数据。','', '## 修改文件','', '- engine/models.py：具名材料、边界快照、旧项目迁移与校验。','- engine/optics.py：独立 TMM、S/P、Snell 角度和单波长接口。','- engine/analysis.py：峰谷、阈值、同分支边缘和积分波段均值。','- engine/main.py：工具接口、项目存储和共享材料库。','- engine/tests/：解析算例、Golden、独立实现、临界角及分析/存储测试。','- src/model.ts、src/NumericInput.tsx、src/LayerEditor.tsx：三种可编辑厚度及换算。','- src/CalculationSettings.tsx、src/MaterialLibrary.tsx：角度、偏振、材料/基底选择与扩充。','- src/SpectrumChart.tsx、src/SpectrumPanel.tsx：可缩放图表、自动纵轴、目标叠加和指标。','- src/App.tsx、src/types.ts、src/defaults.ts、src/styles.css：状态、数据模型与界面集成。','- tests/model.test.ts：厚度换算、基底边界同步、目标 CSV 校验。','- scripts/validate_engine.py：本报告及逐点数据的生成器。','']
(out/'V0.1.1-光谱引擎验收.md').write_text('\n'.join(lines))
print(json.dumps({'all_pass':report['all_pass'],'checks':len(checks),'golden_max_error_pp':max_golden,'user380':f['reference_point']},ensure_ascii=False))
