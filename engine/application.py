"""Host-independent application tools. Optical Core never imports storage or IO."""
from catalogue import catalogue_summaries, catalogue_material
from material_edit import prepare_material
from models import validate
from optics import calculate_spectrum, calculate_rt
from analysis import analyze_spectrum
from importers.tfd import parse_tfd, decode_tfd
from repository import storage_action, import_legacy_database
from workspace import configured_workspace, copy_workspace


def calculate(project):
    result=calculate_spectrum(project)
    result['analysis']=analyze_spectrum(result,project.get('analysis_bands'))
    result['analysis_bands']=project.get('analysis_bands',{})
    result['reference_point']=calculate_rt(project,project['settings']['reference_nm'])
    return result


def dispatch(request, workspace=None):
    action=request['action']
    if action=='decode_tfd':
        values=request['bytes']
        if not isinstance(values,list) or len(values)>2_000_000 or any(type(v) is not int or not 0<=v<=255 for v in values):raise ValueError('文件字节无效或过大')
        return decode_tfd(bytes(values))
    if action=='library_list':
        workspace=workspace or configured_workspace()
        stored=storage_action(workspace,request)
        custom=stored['materials']
        removed=set(stored['removed'])
        names={m['name'] for m in custom}
        return {'materials':custom+[m for m in catalogue_summaries() if m['name'] not in names and m['name'] not in removed]}
    if action=='materials_validate':
        items=request['materials']
        if not isinstance(items,list) or not 1<=len(items)<=300:raise ValueError('一次校验 1–300 种材料')
        return {'materials':[prepare_material(m) for m in items]}
    if action=='material_validate':return {'material':prepare_material(request['material'])}
    if action=='catalogue_list':return {'materials':catalogue_summaries()}
    if action=='catalogue_get':return {'material':catalogue_material(request['name'])}
    if action=='optimize':
        from optimization import optimize
        return optimize(request['project'],request['variables'],request.get('max_evaluations',12000),options=request.get('options'))
    if action=='agent':
        from agent import run_agent
        return run_agent(request['project'],request['prompt'],request['config'],request.get('history'))
    if action=='calculate':return calculate(request['project'])
    if action=='calculate_rt':return calculate_rt(request['project'],request['wavelength_nm'],request.get('polarization'))
    if action=='analyze':return analyze_spectrum(request['spectrum'],request.get('bands'))
    if action=='export_project':
        if request.get('format')=='tfd':
            from exporters.tfd import export_tfd
            return export_tfd(request['project'])
        if request.get('format','json')!='json':raise ValueError('不支持的保存格式')
        import json
        project=validate(request['project'])
        return {'project':project,'format':'json','content':json.dumps(project,ensure_ascii=False,allow_nan=False,indent=2)+'\n','encoding':'utf-8','warnings':[]}
    if action=='validate':return {'project':validate(request['project'])}
    if action=='import_tfd':
        project=parse_tfd(request['text'],request['template'],request.get('name',''),request.get('encoding','unicode'))
        mismatches=[n for n in project['import_info']['notes'] if '原厚度反推' in n or '可能使用了不同材料数据' in n]
        warning='TFD 已导入正面/背面膜系和计算环境；组系数已计入厚度。'
        if mismatches:warning+=f'注意：{len(mismatches)} 层的原 QWOT 与当前材料换算不一致，计算保留原物理厚度；请在项目窗口查看逐层材料差异。'
        else:warning+='完整来源和未导入设置见项目窗口的导入记录。'
        return {'project':project,'warning':warning}
    if action=='workspace_copy':
        import os
        target=os.environ.get('TFC_WORKSPACE_ROOT')
        if not target:raise ValueError('迁入操作需要宿主指定目标目录')
        return copy_workspace(request['source'], target)
    workspace=workspace or configured_workspace()
    if action=='workspace_info':return {'workspace':workspace.info()}
    if action=='workspace_import_legacy':
        import os
        source=os.environ.get('TFC_LEGACY_DATABASE')
        if not source:raise ValueError('此运行环境没有指定旧版数据库；可使用 JSON 导入')
        return import_legacy_database(workspace,source)
    return storage_action(workspace,request)
