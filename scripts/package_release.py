"""Package each native client inside the same portable project layout."""
from pathlib import Path
import hashlib
import json
import platform
import shutil
import subprocess
import tempfile
import zipfile
root = Path(__file__).resolve().parents[1]
version = json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
out = root/'release/assets'
out.mkdir(parents=True, exist_ok=True)
architecture = {'AMD64':'x64', 'x86_64':'x64', 'aarch64':'arm64'}.get(platform.machine(), platform.machine())
with tempfile.TemporaryDirectory(prefix='tfc-package-') as folder:
    project = Path(folder)/'TFC'
    project.mkdir()
    shutil.copy2(root/'tfc-project.json', project/'tfc-project.json')
    (project/'使用说明.txt').write_text(
        '将整个 TFC 文件夹放在固态 U 盘或其它可写位置。\n'
        'Mac 启动 macOS/TFC.app；Windows 启动 Windows/TFC.exe。\n'
        '默认数据在此文件夹内的 Workspace；位置设置在 .tfc，均需随项目一起保留。\n'
        '要在两种系统共用数据，可将两个下载包的 macOS、Windows 子目录合并到同一个 TFC 文件夹。\n'
        '升级仅替换程序子目录，不覆盖或删除 Workspace、Workspaces、.tfc。\n'
        '旧版数据请在工作区面板选择“迁入旧工作区（复制）”。\n'
        '关闭应用后搬迁整个文件夹并安全弹出磁盘；不能同时在两台电脑写入。\n', encoding='utf-8')
    for candidate in (root/'release/TFC.app' if platform.system()=='Darwin' else root/'release/Windows/TFC/engine').rglob('workspace.json'):
        raise SystemExit(f'User Workspace must not enter a release package: {candidate}')
    if platform.system() == 'Darwin':
        app = root/'release/TFC.app'
        if not app.is_dir(): raise SystemExit('Build and stage the native Mac app first')
        shutil.copytree(app, project/'macOS/TFC.app', symlinks=True)
        asset = out/f'TFC-{version}-macOS-{architecture}.zip'
        subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(project), str(asset)], check=True)
    elif platform.system() == 'Windows':
        app = root/'release/Windows/TFC'
        if not (app/'TFC.exe').is_file() or not (app/'engine/tfc-engine.exe').is_file():
            raise SystemExit('Build and stage the Windows client and engine first')
        (project/'Windows').mkdir()
        shutil.copy2(app/'TFC.exe', project/'Windows/TFC.exe')
        shutil.copytree(app/'engine', project/'Windows/engine')
        asset = out/f'TFC-{version}-Windows-{architecture}-portable.zip'
        with zipfile.ZipFile(asset, 'w', zipfile.ZIP_DEFLATED) as archive:
            for file in sorted(project.rglob('*')):
                if file.is_file(): archive.write(file, 'TFC/'+file.relative_to(project).as_posix())
    else: raise SystemExit('Release packaging supports macOS and Windows')
asset.with_suffix(asset.suffix+'.sha256').write_text(hashlib.sha256(asset.read_bytes()).hexdigest()+'  '+asset.name+'\n', encoding='utf-8')
print(asset)
