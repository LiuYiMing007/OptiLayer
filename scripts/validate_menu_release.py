"""Native menu/window integration check, isolated from projects and the engine."""
from pathlib import Path
import argparse
import hashlib
import json
import platform
import subprocess

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
system = platform.system()
parser = argparse.ArgumentParser()
parser.add_argument('--host', type=Path)
args = parser.parse_args()
host = args.host or root / ('release/TFC.app/Contents/MacOS/tfc-for-mac' if system == 'Darwin' else 'release/Windows/TFC/TFC.exe')

def workspace_hashes():
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for folder in ('Workspace', '.tfc') for p in (root / folder).rglob('*') if p.is_file()}

before = workspace_hashes()
response = subprocess.run([str(host), '--menu-self-test'], capture_output=True, encoding='utf-8', timeout=60)
assert response.returncode == 0, response.stdout + response.stderr
report = json.loads(response.stdout.strip())
assert report['native_menu'] and report['command_routed_once_to_main'] and report['disabled_command_blocked']
assert report['native_enabled_and_checked_sync']
if system == 'Windows':
    assert report['windows_auxiliary_close_hide_restore'] and report['auxiliary_cannot_mutate_workspace']
assert workspace_hashes() == before, 'Native menu check changed Workspace or project settings'
report.update(version=version, limits='Native window lifecycle/state/routing checks; visual placement and interactive clicks on Windows need a real-device review.')
(root / f'docs/v{version}-{system.lower()}-menu-check.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
checks = root / 'release/checks'
checks.mkdir(parents=True, exist_ok=True)
(checks / 'native-menu.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
