"""Exercise the actual packaged host's location decision after a project move."""
from pathlib import Path
import json
import os
import platform
import shutil
import subprocess
import tempfile
import zipfile
root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
os_name=platform.system()
pattern=f'TFC-{version}-macOS-*.zip' if os_name=='Darwin' else f'TFC-{version}-Windows-*.zip'
archives=list((root/'release/assets').glob(pattern))
if len(archives)!=1:raise SystemExit(f'Expected exactly one current portable archive: {pattern}')
with zipfile.ZipFile(archives[0]) as inspect:
    assert not any(set(Path(name).parts) & {'Workspace','Workspaces','.tfc'} for name in inspect.namelist()), 'Release must not contain private workspace data'
# Exclude inherited project/engine variables; start from an unrelated working directory.
env=os.environ.copy()
for key in ('TFC_WORKSPACE_ROOT','TFC_CREATE_WORKSPACE','PYTHONHOME','PYTHONPATH'):env.pop(key,None)
env['PATH']=str(Path(os.environ['SystemRoot'])/'System32') if os.name=='nt' else '/usr/bin:/bin'
with tempfile.TemporaryDirectory(prefix='tfc-portable-package-') as temporary:
    base=Path(temporary);unpacked=base/'旧位置';unpacked.mkdir()
    if os_name=='Darwin':subprocess.run(['ditto','-x','-k',str(archives[0]),str(unpacked)],check=True)
    else:
        with zipfile.ZipFile(archives[0]) as archive:archive.extractall(unpacked)
    project=unpacked/'TFC'
    def host():return project/('macOS/TFC.app/Contents/MacOS/tfc-for-mac' if os_name=='Darwin' else 'Windows/TFC.exe')
    def engine():return project/('macOS/TFC.app/Contents/Resources/engine/tfc-engine' if os_name=='Darwin' else 'Windows/engine/tfc-engine.exe')
    def location():
        response=subprocess.run([str(host()),'--workspace-location'],cwd=base,env=env,capture_output=True,encoding='utf-8',check=True)
        return json.loads(response.stdout)
    def call(payload,create=False):
        args=[str(engine()),'--workspace',str(project/'Workspace')]
        if create:args+=['--create-workspace']
        response=subprocess.run(args,input=json.dumps(payload,ensure_ascii=False),cwd=base,env=env,capture_output=True,encoding='utf-8',check=True)
        result=json.loads(response.stdout);assert 'error' not in result,result;return result
    initial=location()
    # Compare actual directory identity: Windows canonical paths may use a \\?\ prefix.
    assert Path(initial['project_root']).samefile(project)
    assert Path(initial['workspace_root']).name=='Workspace'
    assert Path(initial['workspace_root']).parent.samefile(project)
    assert initial['creation_allowed']
    call({'action':'workspace_info'},True)
    p=json.loads((root/'docs/user-380nm-recovery.tfc.json').read_text(encoding='utf-8'))
    call({'action':'save','project':p});result=call({'action':'calculate','project':p})
    call({'action':'spectrum_save','project_id':p['id'],'project':p,'spectrum':result})
    (project/'.tfc').mkdir()
    (project/'.tfc/workspace-selection.json').write_text(json.dumps({'schema_version':1,'workspace_relative':'Workspace'}),encoding='utf-8')
    moved=base/'新磁盘位置 中文 空格'/'TFC';moved.parent.mkdir();shutil.move(project,moved);project=moved
    reopened=location()
    assert Path(reopened['project_root']).samefile(project)
    assert Path(reopened['workspace_root']).samefile(project/'Workspace')
    assert not reopened['creation_allowed']
    loaded=call({'action':'load','id':p['id']})['project']
    assert call({'action':'calculate','project':loaded})==result
    # A missing remembered folder must remain missing, not be treated as a new workspace.
    shutil.move(project/'Workspace',base/'retained-workspace')
    assert not location()['creation_allowed']
    assert not (project/'Workspace').exists()
report={'version':version,'platform':os_name,'actual_host_location_check':True,'default_is_project_workspace':True,'independent_of_cwd_and_machine_preferences':True,'relative_selection_survives_project_move':True,'saved_spectrum_exactly_reproduced':True,'missing_saved_workspace_not_recreated':True,'limits':'Directory move with real native entry point; physical drive-letter reassignment, disconnect and native UI are separate checks.'}
(root/f'docs/v{version}-{os_name.lower()}-portable-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))

checks=root/'release/checks'
checks.mkdir(parents=True,exist_ok=True)
(checks/'portable-location.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
