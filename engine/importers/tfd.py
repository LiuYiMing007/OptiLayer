"""TFCalc front/back environment adapter. No optical formula is implemented here.

Supplied Manual: layer 1 touches substrate; physical d times group factor is
actual thickness. Front/back stacks and finite-substrate boundaries stay distinct.
"""
import copy
import hashlib
import uuid
import numpy as np
from catalogue import catalogue_material
from materials import optical_constants
from models import validate, number, BUILTIN_MATERIALS


def decode_tfd(data):
    if not isinstance(data, (bytes, bytearray)) or len(data)>2_000_000:
        raise ValueError('TFD 文件需要字节数据，不能超过 2 MB')
    for encoding in ('utf-8-sig','gb18030'):
        try:
            text=bytes(data).decode(encoding,errors='strict')
            if '\x00' in text:raise ValueError('TFD 含 NUL，不能按文本导入')
            return {'content':text,'encoding':encoding}
        except UnicodeDecodeError:
            pass
    raise ValueError('TFD 无法按 UTF-8 或 GB18030 无损解码，未替换当前项目')


def inspect_tfd(text, template, name='', encoding='unicode'):
    report={'project':None,'issues':[],'warnings':[],'materials':[]}
    def issue(code, message):report['issues'].append({'code':code,'message':message})
    try:
        if not isinstance(text,str) or '\x00' in text:raise ValueError('TFD 需要有效文本')
        records={}
        for line in text.lstrip('\ufeff').splitlines():
            if not line.strip():continue
            row=[v.strip() for v in line.split('*')]
            records.setdefault(row[0],[]).append(row)
        def one(kind, optional=False):
            rows=records.get(kind,[])
            if optional and not rows:return None
            if len(rows)!=1:raise ValueError(f'需要唯一的 {kind} 记录')
            return rows[0]
        version=one('VERSION',True)
        if version and version[1]!='1':issue('version','不支持的 TFD 版本')
        config=one('CONFIG',True)
        if config and config[1]!='0':issue('units','尚未验证该波长单位，不能假定为 nm')
        e=one('ENVIRON');declared=one('LAYERS');rows=records.get('LAYER',[])
        if len(e)<9 or len(rows)!=int(declared[1]):raise ValueError('TFD 环境字段不完整或膜层数量不匹配')
        for kind in ('VARMATS','MIXMATS'):
            if any(int(r[1])!=0 for r in records.get(kind,[])):
                issue('special_material',f'含 {kind} 自定义/混合材料，尚未解析其定义')
        e3=one('ENVIRON3',True)
        if e3:
            if len(e3)<6:raise ValueError('ENVIRON3 字段不完整')
            if e3[5] not in ('1','2'):issue('first_surface','第一表面字段必须为 1（Front）或 2（Back）')
            if e3[3]!='WHITE' or e3[4]!='IDEAL':issue('response_data','需要原文件光源/探测器的完整响应数据，不能自动替换为 WHITE/IDEAL')
        if not e3 and records.get('LAYER2'):
            issue('environment','背面膜系缺少 ENVIRON3 中的基底厚度和出射介质；不能默认补造有限基底环境')
        legacy=bool(rows) and all(len(r)>2 and r[2].endswith('_REF') for r in rows)
        snapshots={m['name']:m for m in template.get('materials',[])}
        resolved={};mapping=[]
        def resolve(raw, role):
            key=(role,raw)
            if key in resolved:return resolved[key]
            try:
                if raw.endswith('_REF') and raw in snapshots:
                    m=copy.deepcopy(snapshots[raw])
                elif legacy and role!='film' and raw in ('AIR','GLASS'):
                    key_name='AIR' if raw=='AIR' else 'GLASS_REF'
                    m=copy.deepcopy(next(m for m in BUILTIN_MATERIALS if m['name']==key_name))
                else:
                    collection='MATERIAL' if role=='film' else 'SUBSTRAT'
                    m=catalogue_material(f'TFC/{collection}/{raw}')
                resolved[key]=m;mapping.append({'role':role,'original':raw,'resolved':m['name']})
                return m
            except (ValueError,KeyError) as error:
                issue('material',f'{role} 材料“{raw}”无法从对应原始目录解析：{error}；不使用同名其它目录或默认材料替代')
                resolved[key]=None
                return None
        incident=resolve(e[6],'incident');substrate=resolve(e[7],'substrate')
        exit_medium=resolve(e3[2] if e3 else e[7],'exit')
        groups={}
        for g in records.get('GROUP',[]):
            if len(g)<3:raise ValueError('GROUP 字段不完整')
            key=int(g[1])
            if key in groups:raise ValueError('GROUP 编号重复')
            groups[key]=number(g[2],'膜层组系数',0,1e6)
        group_count=one('GROUPS',True)
        if group_count and int(group_count[1])!=len(groups):raise ValueError('GROUPS 数量不匹配')
        layers=[];back_layers=[];source_layers=[]
        rear_declared=one('LAYERS2',True)
        rear_rows=records.get('LAYER2',[])
        if len(rear_rows)!=(int(rear_declared[1]) if rear_declared else 0):
            raise ValueError('背面膜层数量与 LAYERS2 不匹配')
        for side, source, target in [('front',rows,layers),('back',rear_rows,back_layers)]:
            for i,row in enumerate(source):
                if len(row)<6 or int(row[1])!=i+1:raise ValueError(f'{side} 膜层编号必须从 1 连续递增，且厚度字段完整')
                m=resolve(row[2],'film');d=number(row[4],f'{side}第 {i+1} 层原始物理膜厚',0,1e6)
                group=int(row[6]) if len(row)>6 and row[6] else 1
                if groups and group not in groups:raise ValueError(f'{side}第 {i+1} 层引用不存在的组 {group}')
                factor=groups.get(group,1.0)
                source_layers.append({'side':side,'index':i+1,'material':row[2],'physical_nm':d,'group':group,'factor':factor})
                if m:target.append({'id':str(uuid.uuid4()),'material':m['name'],'thickness_nm':d*factor,'group':group})
        report['materials']=mapping
        if report['issues']:return report
        settings=dict(zip(['start_nm','end_nm','step_nm','reference_nm','angle_deg'],map(float,e[1:6])))
        plot=one('TRDATA6',True);polarization=plot[3] if plot and len(plot)>3 else 'A'
        if polarization not in ('A','S','P'):raise ValueError(f'不支持的光谱偏振 {polarization}')
        settings.update(substrate_model='incoherent' if back_layers or (e3 and e3[2]!=e[7]) else 'semi_infinite', substrate_thickness_mm=number(e3[1], '基底厚度 mm',0,1e5,strict=True) if e3 else 1.0, exit_material=exit_medium['name'], first_surface='back' if e3 and e3[5]=='2' else 'front', illuminant=e3[3] if e3 else 'WHITE', detector=e3[4] if e3 else 'IDEAL')
        settings['polarization']={'A':'unpolarized','S':'s','P':'p'}[polarization]
        for role,m in [('incident',incident),('substrate',substrate)]:
            n,k=optical_constants(m,np.array([settings['reference_nm']]))
            if role=='incident' and k[0]!=0:raise ValueError('入射介质有吸收，当前核心不支持；不将 k 改成零')
            settings[role+'_material']=m['name'];settings[role+'_n']=float(n[0])
        materials={m['name']:m for (role,_),m in resolved.items() if role=='film' and m}
        materials.update({m['name']:m for m in (incident,substrate,exit_medium)})
        notes=['采用原始物理厚度 × 膜层组系数；层序从基底到入射侧。',
               '材料使用 MATERIAL，入射/出射介质及基底使用 SUBSTRAT 的完整原始 n/k；未模糊匹配。',
               '正面、背面膜层分别保存为基底向外层序；有限厚基底采用非相干多次反射，与 TFCalc 块状基底假设一致。',
               '仅导入当前膜系和环境；未导入优化约束、目标曲线、照明/探测器加权及其它 TFCalc 分析设置。',
               '后续编辑采用本软件物理厚度规则，不模拟原 TFCalc 的光学厚度优先设置。']
        if encoding=='gb18030':notes.append('文件按 GB18030 严格解码，保留中文名称。')
        project={'schema_version':1,'id':str(uuid.uuid4()),'name':name.rsplit('.',1)[0] if name else '导入的膜系',
                 'layer_order':'substrate_to_air','group_factors':{str(g):f for g,f in groups.items() if g>0},'settings':settings,'materials':list(materials.values()),'layers':layers,
                 **({'back_layers':back_layers} if back_layers else {}),
                 'import_info':{'format':'TFCalc','file_name':name,'encoding':encoding,'text_sha256':hashlib.sha256(text.encode('utf-8')).hexdigest(),
                                'materials':mapping,'source_layers':source_layers,'notes':notes}}
        report['project']=validate(project);report['warnings']=notes
    except (ValueError,TypeError,IndexError,KeyError,OverflowError) as error:
        issue('structure_or_input',str(error))
    return report


def parse_tfd(text, template, name='', encoding='unicode'):
    report=inspect_tfd(text,template,name,encoding)
    if report['issues']:
        raise ValueError('TFD 未导入：'+'；'.join(i['message'] for i in report['issues']))
    return report['project']
