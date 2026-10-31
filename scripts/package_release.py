"""Package native clients as release assets without user data."""
from pathlib import Path
import hashlib
import json
import platform
import subprocess
import zipfile
root = Path(__file__).resolve().parents[1]
version = json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
out = root/'release/assets'
out.mkdir(parents=True, exist_ok=True)
if platform.system() == 'Darwin':
    app = root/'release/TFC.app'
    if not app.is_dir():
        raise SystemExit('Build and stage the native Mac app first')
    asset = out/f'TFC-{version}-macOS-{platform.machine()}.zip'
    subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(app), str(asset)], check=True)
elif platform.system() == 'Windows':
    app = root/'release/Windows/TFC'
    if not (app/'TFC.exe').is_file() or not (app/'engine/tfc-engine.exe').is_file():
        raise SystemExit('Build and stage the Windows client and engine first')
    asset = out/f'TFC-{version}-Windows-{platform.machine()}.zip'
    with zipfile.ZipFile(asset, 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(app.rglob('*')):
            if file.is_file(): archive.write(file, 'TFC/'+file.relative_to(app).as_posix())
else:
    raise SystemExit('Release packaging supports macOS and Windows')
asset.with_suffix(asset.suffix+'.sha256').write_text(hashlib.sha256(asset.read_bytes()).hexdigest()+'  '+asset.name+'\n', encoding='utf-8')
print(asset)
