"""TFCalc VERSION 1 text writer; no optical formula or material substitution.

TFD references external MATERIAL/SUBSTRAT records. Export only when those exact
records have the same optical data; a matching display name alone is insufficient.
"""
import copy
import json
import numpy as np
from catalogue import catalogue_material
from materials import optical_constants
from models import validate


def _optical_data(m):
    model=m.get('model','constant')
    if model=='constant':return ('flat',float(m['n']),float(m.get('k',0)))
    if model=='tabulated':
        samples=m['samples']
        if all(r[1:]==samples[0][1:] for r in samples):return ('flat',float(samples[0][1]),float(samples[0][2]))
        return ('table',tuple(tuple(float(v) for v in row) for row in samples))
    return ('formula',m.get('formula'),tuple(m.get('range_nm',[])))


def export_tfd(project):
    p=validate(project);s=p['settings'];materials={m['name']:m for m in p['materials']}
    if s.get('substrate_model','semi_infinite')=='coherent':
        raise ValueError('原版 TFCalc 块状基底没有相干干涉；请保存完整项目 JSON，或明确选择非相干模型后再导出 TFD')
    if s.get('illuminant','WHITE')!='WHITE' or s.get('detector','IDEAL')!='IDEAL':
        raise ValueError('自定义光源/探测器需要原版外部响应文件；尚未核验这些文件，不能假称已匹配。请保存完整项目 JSON')
    if p.get('response_data') or p.get('target_points') or p.get('analysis_bands'):
        raise ValueError('项目包含兼容 TFD 无法完整表达的新增响应/目标/波段配置；请保存完整项目 JSON，未丢弃这些数据')
    aliases={}
    def alias(key,role):
        cache=(key,role)
        if cache in aliases:return aliases[cache]
        m=materials[key];collection='MATERIAL' if role=='film' else 'SUBSTRAT'
        candidate=None
        prefix=f'TFC/{collection}/'
        if key.startswith(prefix):candidate=key[len(prefix):]
        path=m.get('provenance',{}).get('path','')
        if not candidate and path.startswith(collection+'/'):
            candidate=path.split('/',1)[1].rsplit('.',1)[0]
        if not candidate and key in ('AIR','GLASS_REF'):candidate='AIR' if key=='AIR' else 'GLASS'
        if not candidate:raise ValueError(f'材料 {m.get("display_name") or key} 没有可核验的原版 {collection} 对应记录；请保存完整项目 JSON')
        if any(c in candidate for c in '*\r\n/\\\x00'):raise ValueError('材料名包含 TFD 不允许的分隔符')
        original=catalogue_material(f'TFC/{collection}/{candidate}')
        if _optical_data(m)!=_optical_data(original):
            raise ValueError(f'材料 {m.get("display_name") or key} 的 n/k 数据与原版 {collection}/{candidate} 不同；不以同名记录替代。请保存完整项目 JSON')
        aliases[cache]=candidate;return candidate
    incident=alias(s['incident_material'],'incident');substrate=alias(s['substrate_material'],'substrate')
    exit_medium=alias(s.get('exit_material',s['substrate_material']),'exit')
    mode=s.get('substrate_model','semi_infinite')
    if mode=='incoherent' and exit_medium==substrate and not p.get('back_layers'):
        raise ValueError('原版出射介质等于基底且无背膜时解释为半无限基底；该有限基底环境不能无损写成兼容 TFD，请保存完整项目 JSON')
    def f(value):return format(float(value),'.17g')
    def record(kind,*values):return [kind,*[str(v)for v in values],'']
    source=p.get('import_info',{}).get('tfd_records',[])
    # Preserve unedited original analysis/target/configuration records, in order.
    source=copy.deepcopy(source) if isinstance(source,list) and all(isinstance(r,list) and all(isinstance(v,str)for v in r)for r in source) else []
    old={r[0]:r for r in source if r}
    if int(old.get('ENVIRNS',['ENVIRNS','1'])[1])!=1:raise ValueError('多环境 TFD 尚未建立可编辑数据模型，未丢弃其它环境；请保存完整项目 JSON')
    output=[]
    generated={
        'VERSION':[record('VERSION',1)],
        'CONFIG':[old.get('CONFIG',record('CONFIG',0,4,0,0,0,'N','Y','N'))],
        'ENVIRON':[record('ENVIRON',*[f(s[k])for k in ['start_nm','end_nm','step_nm','reference_nm','angle_deg']],incident,substrate)],
        'ENVIRON2':[old.get('ENVIRON2',record('ENVIRON2',0,30,1,550,'W'))],
        'ENVIRON3':[record('ENVIRON3',f(s.get('substrate_thickness_mm',1)),exit_medium,'WHITE','IDEAL',2 if s.get('first_surface')=='back' else 1,'N',0,'N')],
    }
    factors=dict(p.get('group_factors',{}));groups={l.get('group',0) for l in p['layers']+p.get('back_layers',[])}|{int(k)for k in factors}
    generated['GROUPS']=[record('GROUPS',sum(g>0 for g in groups))]
    old_groups={int(r[1]):r for r in source if r and r[0]=='GROUP' and len(r)>2}
    generated['GROUP']=[]
    for g in sorted(groups):
        if g<=0:continue
        row=copy.deepcopy(old_groups.get(g,record('GROUP',g,1,'N','N',0,0)))
        row[2]=f(factors.get(str(g),1));generated['GROUP'].append(row)
    original_layers={}
    for item in p.get('import_info',{}).get('source_layers',[]):
        if item.get('layer_id'):
            tag='LAYER2' if item.get('side')=='back' else 'LAYER'
            rows=[r for r in source if r and r[0]==tag]
            index=item.get('index',0)-1
            if 0<=index<len(rows):original_layers[item['layer_id']]=rows[index]

    for field,tag,count in [('layers','LAYER','LAYERS'),('back_layers','LAYER2','LAYERS2')]:
        layers=p.get(field,[]);generated[count]=[record(count,len(layers))];generated[tag]=[]
        for i,l in enumerate(layers,1):
            material=materials[l['material']];name=alias(l['material'],'film');group=l.get('group',0);factor=factors.get(str(group),1)
            d=l['thickness_nm']/factor if factor else 0
            if not factor and l['thickness_nm']!=0:raise ValueError('零组系数与非零实际膜厚不能同时写入 TFD')
            if not np.isfinite(d) or not 0<=d<=1e6:raise ValueError('TFD 组前膜厚超出原格式支持范围')
            n=float(optical_constants(material,np.array([s['reference_nm']]))[0][0]);q=4*d*n/s['reference_nm']
            row=copy.deepcopy(original_layers.get(l['id'],record(tag,i,name,f(q),f(d),0,group,'Y','N',0,'N','N','Y')))
            row[0:5]=[tag,str(i),name,f(q),f(d)];row[6]=str(group)
            generated[tag].append(row)
    if 'ENVIRON3' in old and len(old['ENVIRON3'])>=len(generated['ENVIRON3'][0]):
        row=copy.deepcopy(old['ENVIRON3']);row[1:6]=generated['ENVIRON3'][0][1:6];generated['ENVIRON3']=[row]
    generated['VARMATS']=[record('VARMATS',0)];generated['MIXMATS']=[record('MIXMATS',0)]
    if not source:generated['TARGETS']=[record('TARGETS',0,100,1,'0.00000100','0.100','V','N','Y','Y',0,'N',substrate,substrate,'N','N','','','','','','','N','N',1000,0,0,'N',0)]
    generated['ENVIRNS']=[record('ENVIRNS',1)]
    generated['ENVIRN']=[record('ENVIRN',1,incident,substrate,exit_medium,'WHITE','IDEAL',f(s.get('substrate_thickness_mm',1)),'','','',0,'')]
    polarization={'unpolarized':'A','s':'S','p':'P'}[s['polarization']]
    tr=old.get('TRDATA6',record('TRDATA6',0,'T',polarization,400,700,1,0,0,1,31,0,'Y',1,1,1,1,0))
    if len(tr)<9:raise ValueError('原 TRDATA6 记录不完整，未覆盖')
    tr[3:8]=[polarization,*[f(s[k])for k in ['start_nm','end_nm','step_nm','angle_deg']]]
    generated['TRDATA6']=[tr]
    # The single environment is the verified adapter's domain. Keep unrelated
    # records verbatim, but never leave stale layer/variable material entries.
    replace={'VERSION','CONFIG','ENVIRON','ENVIRON2','ENVIRON3','GROUPS','GROUP','LAYERS','LAYER','LAYERS2','LAYER2','VARMATS','MIXMATS','ENVIRNS','ENVIRN','TRDATA6'}
    for count,tag in [('GROUPS','GROUP'),('LAYERS','LAYER'),('LAYERS2','LAYER2'),('ENVIRNS','ENVIRN')]:
        generated[count].extend(generated[tag]);generated[tag]=[]
    emitted=set()
    for row in source:
        key=row[0] if row else ''
        if key=='EOF':continue
        if key=='COMMENTS':
            for remaining,rows in generated.items():
                if remaining not in emitted:output.extend(rows);emitted.add(remaining)
        if key in replace:
            if key not in emitted:output.extend(generated.get(key,[]));emitted.add(key)
        elif key not in ('VARMAT','MIXMAT'):output.append(row)
    for key,rows in generated.items():
        if key not in emitted:output.extend(rows)
    if not any(r[0]=='COMMENTS'for r in output):output.append(record('COMMENTS',0))
    output.append(record('EOF'))
    content='\r\n'.join('*'.join(row)for row in output)+'\r\n'
    data=content.encode('gb18030',errors='strict')
    if len(data)>2_000_000:raise ValueError('TFD 超过 2 MB，未写入文件')
    return {'project':p,'format':'tfd','content':content,'encoding':'gb18030','bytes':list(data),
            'warnings':['兼容 TFD 引用原版外部材料库；完整材料快照、项目标识及本软件分析数据仍保存在 Workspace 数据库/完整项目 JSON 中。']}
