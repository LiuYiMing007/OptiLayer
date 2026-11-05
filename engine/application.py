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
        custom=storage_action(workspace,request)['materials']
        names={m['name'] for m in custom}
        return {'materials':custom+[m for m in catalogue_summaries() if m['name'] not in names]}
    if action=='materials_validate':
        items=request['materials']
        if not isinstance(items,list) or not 1<=len(items)<=300:raise ValueError('一次校验 1–300 种材料')
        return {'materials':[prepare_material(m) for m in items]}
    if action=='material_validate':return {'material':prepare_material(request['material'])}
    if action=='catalogue_list':return {'materials':catalogue_summaries()}
    if action=='catalogue_get':return {'material':catalogue_material(request['name'])}
    if action=='calculate':return calculate(request['project'])
    if action=='calculate_rt':return calculate_rt(request['project'],request['wavelength_nm'],request.get('polarization'))
    if action=='analyze':return analyze_spectrum(request['spectrum'],request.get('bands'))
    if action=='validate':return {'project':validate(request['project'])}
    if action=='import_tfd':
        return {'project':parse_tfd(request['text'],request['template'],request.get('name',''),request.get('encoding','unicode')),'warning':'TFD 已导入正面/背面膜系和计算环境；组系数已计入厚度。完整来源和未导入设置见项目窗口的导入记录。'}
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
