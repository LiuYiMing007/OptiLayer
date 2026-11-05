"""Exercise real bundled frontend -> Tauri IPC -> child renderer on both platforms."""
from pathlib import Path
import json, platform, subprocess, hashlib
root=Path(__file__).resolve().parents[1]
system=platform.system()
host=root/('release/TFC.app/Contents/MacOS/tfc-for-mac' if system=='Darwin' else 'release/Windows/TFC/TFC.exe')
def hashes():
    return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for d in ('Workspace','.tfc') for p in (root/d).rglob('*') if p.is_file()}
before=hashes()
p=subprocess.run([str(host),'--window-ipc-self-test'],capture_output=True,text=True,encoding='utf-8',timeout=80)
assert p.returncode==0,p.stdout+p.stderr
report=json.loads(p.stdout.strip())
expected={d['id'] for d in json.loads((root/'src/tools/windows.json').read_text(encoding='utf-8'))}
assert report['all_pass'] and set(report['main_button_ipc'])==expected and set(report['menu_command_ipc'])==expected,report
assert report['catalogue_without_workspace'] and report['material_and_substrate_editors'],report
assert report['environment_controls_shared_state'] and report['back_layer_controls_shared_state'] and report['interactive_controls_shared_state'],report
assert report['shared_project_rendered'] and report['close_hide_reopen'] and not report['workspace_used'],report
assert before==hashes(),'window IPC check touched Workspace/layout'
report.update(version=json.loads((root/'package.json').read_text())['version'],limits='Real frontend IPC and React tool rendering; does not simulate physical mouse clicks on native OS menus or validate display scaling.')
checks=root/'release/checks';checks.mkdir(parents=True,exist_ok=True)
(checks/'window-ipc.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(root/f'docs/v{report["version"]}-{system.lower()}-window-ipc-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
