"""Check all discoverable data folders using packaged host and frozen engine."""
from pathlib import Path
import json,os,platform,subprocess,tempfile,shutil,base64
root=Path(__file__).resolve().parents[1]
system=platform.system()
host=root/('release/TFC.app/Contents/MacOS/tfc-for-mac' if system=='Darwin' else 'release/Windows/TFC/TFC.exe')
engine=root/('release/TFC.app/Contents/Resources/engine/tfc-engine' if system=='Darwin' else 'release/Windows/TFC/engine/tfc-engine.exe')
with tempfile.TemporaryDirectory(prefix='tfc-folder-check-') as temp:
    workspace=Path(temp)/'中文 固态盘'/'Workspace'
    def call(body,create=False):
        response=subprocess.run([str(engine),'--workspace',str(workspace)]+(['--create-workspace'] if create else []),input=json.dumps(body,ensure_ascii=False),encoding='utf-8',capture_output=True,check=True,timeout=45)
        value=json.loads(response.stdout);assert 'error' not in value,value;return value
    info=call({'action':'workspace_info'},True)['workspace']
    call({'action':'library_list'})
    project=json.loads((root/'docs/user-380nm-recovery.tfc.json').read_text(encoding='utf-8'))
    call({'action':'save','project':project})
    spectrum=call({'action':'calculate','project':project})
    call({'action':'spectrum_save','project_id':project['id'],'project':project,'spectrum':spectrum})
    moved=Path(temp)/'搬迁后'/'Workspace';moved.parent.mkdir();shutil.move(workspace,moved);workspace=moved
    response=subprocess.run([str(host),'--workspace-folder-check',str(workspace)],encoding='utf-8',capture_output=True,check=True,timeout=60)
    report=json.loads(response.stdout)
    assert report['all_pass'] and set(report['opened'])=={'root',*info['directories']},report
    for section,path in report['opened'].items():
        expected=workspace if section=='root' else workspace/info['directories'][section]
        assert Path(path).samefile(expected) and expected.is_dir(),section
    assert list((workspace/'projects').glob('*.json'))
    assert list((workspace/'spectra').rglob('*.json'))
    assert (workspace/'database/workspace.sqlite3').is_file()
    assert (workspace/'materials/catalogue/TFCalc-0.2.0.original.json').is_file()
    assert call({'action':'calculate','project':call({'action':'load','id':project['id']})['project']})==spectrum
    explorer_confirmed = None
    if system == 'Windows':
        expected=[str((workspace if section=='root' else workspace/info['directories'][section]).resolve()).rstrip('\\').lower() for section in report['opened']]
        script=r'''$ErrorActionPreference='Stop'
[string[]]$expected=(ConvertFrom-Json -InputObject $env:TFC_FOLDER_CHECK_EXPECTED)
$shell=New-Object -ComObject Shell.Application
$deadline=[DateTime]::UtcNow.AddSeconds(20)
$windows=@();$paths=@()
do {
 $windows=@($shell.Windows() | Where-Object {try {[IO.Path]::GetFileName($_.FullName) -ieq 'explorer.exe'} catch {$false}})
 $paths=@($windows | ForEach-Object {try {([uri]$_.LocationURL).LocalPath.TrimEnd('\').ToLowerInvariant()} catch {}})
 $matched=@($expected | Where-Object {$paths -contains $_})
 if($matched.Count -eq $expected.Count){break}
 Start-Sleep -Milliseconds 200
} while([DateTime]::UtcNow -lt $deadline)
@{confirmed=$matched.Count;expected=$expected.Count;observed_windows=$windows.Count;observed_paths=$paths;expected_paths=$expected} | ConvertTo-Json -Compress
foreach($window in $windows){try {if($expected -contains ([uri]$window.LocationURL).LocalPath.TrimEnd('\').ToLowerInvariant()){$window.Quit()}}catch{}}
'''
        env=os.environ.copy();env['TFC_FOLDER_CHECK_EXPECTED']=json.dumps(expected,ensure_ascii=False)
        process=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-EncodedCommand',base64.b64encode(script.encode('utf-16-le')).decode('ascii')],env=env,capture_output=True,encoding='utf-8',check=True,timeout=35)
        observation=json.loads(process.stdout)
        assert observation['expected']==8,observation
        # Explorer expands Windows 8.3 names. Match directory identity, not spelling.
        for target in expected:
            assert any(Path(candidate).is_dir() and Path(candidate).samefile(target) for candidate in observation['observed_paths']),observation
        explorer_confirmed=True

report={'all_pass':True,'platform':system,'directories':sorted(report['opened']),'existing_folders_after_move':True,'production_file_manager_opener_called':True,'explorer_window_paths_confirmed':explorer_confirmed,'saved_project_spectrum_database_catalogue_visible':True,'reloaded_spectrum_exact':True,'limits':'Actual directory opener launch and on-disk artifacts; does not prove physical Explorer mouse interaction, display scaling, or a physical SSD drive-letter change.'}
checks=root/'release/checks';checks.mkdir(parents=True,exist_ok=True)
(checks/'workspace-folders.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
