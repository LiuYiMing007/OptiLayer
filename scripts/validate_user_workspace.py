"""Validate only a COPY of transferred user data with the bundled runtime."""
import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
version = json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
platform_tag = platform.system().lower()
parser=argparse.ArgumentParser()
parser.add_argument('--source',type=Path,default=root.parent/'Workspace')
parser.add_argument('--compare-archives',action='store_true',help='Compare source archived R/T and S/P values with this platform')
parser.add_argument('--destination',type=Path,default=root/f'acceptance/{platform_tag}-{version}')
default_engine = root/('release/OptiLayer.app/Contents/Resources/engine/tfc-engine' if platform.system()=='Darwin' else 'release/Windows/OptiLayer/engine/tfc-engine.exe')
parser.add_argument('--engine',type=Path,default=default_engine)
parser.add_argument('--report',default=f'v{version}-{platform_tag}-user-workspace-check.json')
args=parser.parse_args()
source = args.source.resolve()
if not (source/'workspace.json').is_file():
    raise SystemExit('Source must be an existing Workspace')
base = args.destination.resolve()
if base == source or base.is_relative_to(source):
    raise SystemExit('Acceptance destination must be outside the source Workspace')
if Path(args.report).name != args.report or not args.report.endswith('.json'):
    raise SystemExit('Report must be a JSON filename')
base.mkdir(parents=True, exist_ok=True)
exe = args.engine.resolve()
def hashes(folder):
    return {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(folder.rglob('*')) if p.is_file()}
before = hashes(source)
workspace = base / '中文 空格' / 'Workspace副本'
if workspace.exists():
    raise SystemExit('Acceptance copy exists; retain evidence and choose a fresh destination')
shutil.copytree(source, workspace)
def call(request):
    env = os.environ.copy()
    for key in ('TFC_WORKSPACE_ROOT', 'TFC_CREATE_WORKSPACE', 'PYTHONHOME', 'PYTHONPATH'):
        env.pop(key, None)
    env['PATH'] = str(Path(os.environ['SystemRoot']) / 'System32') if os.name=='nt' else '/usr/bin:/bin'
    p = subprocess.run([str(exe), '--workspace', str(workspace)],
                       input=json.dumps(request, ensure_ascii=False), encoding='utf-8',
                       capture_output=True, check=True, env=env)
    value = json.loads(p.stdout)
    assert 'error' not in value, value
    return value
info = call({'action':'workspace_info'})
projects = call({'action':'list'})['projects']
assert projects, 'Expected transferred projects'
results = {}
artifacts = []
archive_comparisons = []
def optical_input(p):
    return {key:p[key] for key in ('settings','materials','layers','layer_order')}
for row in projects:
    p = call({'action':'load','id':row['id']})['project']
    result = call({'action':'calculate','project':p})
    if args.compare_archives:
        matches=[]
        for artifact_path in (source/info['workspace']['directories']['spectra']/p['id']).glob('*.spectrum.json'):
            archived=json.loads(artifact_path.read_text(encoding='utf-8'))['result']
            if optical_input(archived['input_snapshot']) == optical_input(result['input_snapshot']):
                matches.append(archived)
        assert matches, f'No matching archived input for {p["name"]}'
        errors=[]
        for archived in matches:
            for channel in ('wavelength_nm','R_percent','T_percent','A_percent','Rs_percent','Ts_percent','Rp_percent','Tp_percent'):
                assert len(archived[channel]) == len(result[channel])
                errors.extend(abs(a-b) for a,b in zip(archived[channel],result[channel]))
        maximum=max(errors)
        assert maximum <= 1e-8, f'Cross-platform spectrum mismatch: {maximum}'
        archive_comparisons.append({'project_id':p['id'],'name':p['name'],'matching_archives':len(matches),'max_absolute_error':maximum,'tolerance':1e-8})
    saved = call({'action':'save','project':p})
    assert saved['saved'] and not saved.get('warnings'), saved
    artifact = call({'action':'spectrum_save','project_id':p['id'],'project':p,'spectrum':result})
    artifacts.append(artifact['relative_path'])
    results[p['id']] = result
moved = base / '搬迁 SSD 模拟' / 'Workspace'
moved.parent.mkdir(parents=True, exist_ok=True)
shutil.move(workspace, moved)
workspace = moved
assert call({'action':'workspace_info'})['workspace']['id'] == info['workspace']['id']
for key, result in results.items():
    p = call({'action':'load','id':key})['project']
    assert call({'action':'calculate','project':p}) == result
for relative in artifacts:
    result = json.loads((workspace / relative).read_text(encoding='utf-8'))['result']
    assert result in results.values()
after = hashes(source)
assert before == after, 'Original data changed'
report = {'platform':f'{platform.system()} {platform.machine()}','version':version,'source':str(source),'original_sha256':before,
          'original_unchanged':True,'projects':projects,'saved_spectra':artifacts,
          'relocated_workspace':str(workspace),'exact_reproduction':True,
          'runtime_without_python_on_path':True,'source_archive_comparisons':archive_comparisons,
          'limits':'Packaged-engine and directory relocation checks only. Native UI, physical disconnection and drive-letter changes are separate checks.'}
(root/'docs'/args.report).write_text(
    json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'projects':len(projects),'original_unchanged':True,'exact_reproduction':True}))
