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
    project = Path(folder)/'OptiLayer'
    project.mkdir()
    shutil.copy2(root/'tfc-project.json', project/'tfc-project.json')
    (project/'README.txt').write_text(
        '将整个 OptiLayer 文件夹放在固态 U 盘或其它可写位置。\n'
        'Mac 启动 macOS/OptiLayer.app；Windows 启动 Windows/OptiLayer.exe。\n'
        '连接后数据保存在此文件夹内的 Workspace；位置设置在 .tfc，均需随项目一起保留。\n'
        '首次打开若未连接，请在数据位置中选择实际 OptiLayer 文件夹；膜系需保存后才写入 projects。\n'
        '首次连接后生成 Workspace/workspace.json 以及以下实际文件夹，界面“数据位置”均可打开。\n'
        'Workspace/projects：默认保存的 TFD 膜系（.tfd）；Workspace/spectra：保存的光谱。\n'
        'Workspace/materials/catalogue：原始膜层材料逐项文件；materials/substrates：基底与介质逐项文件。\n'
        'materials/custom 与 materials/substrates/custom：保存编辑后的材料和基底副本。\n'
        '项目默认使用名称命名的 .tfd，软件内部同时保留完整项目快照；选择 JSON 格式时保存 .tfc.json。\n'
        '每种材料/基底有独立 .material.json。外部编辑后请在软件中导入校验。\n'
        '有限基底、背膜或自定义响应使用项目格式 v2，Mac/Windows 两端都应使用支持此格式的新版程序。\n'
        'Workspace/database：SQLite 项目数据库；Workspace/imports：导入资料与原件归档。\n'
        'Workspace/exports：导出文件；Workspace/config：工作区配置。空目录用于后续文件，不代表丢失数据。\n'
        '要在两种系统共用数据，可将两个下载包的 macOS、Windows 子目录合并到同一个 OptiLayer 文件夹。\n'
        '升级仅替换程序子目录，不覆盖或删除 Workspace、Workspaces、.tfc。\n'
        '旧版数据请在工作区面板选择“迁入旧工作区（复制）”。\n'
        '关闭应用后搬迁整个文件夹并安全弹出磁盘；不能同时在两台电脑写入。\n', encoding='utf-8')
    for candidate in (root/'release/OptiLayer.app' if platform.system()=='Darwin' else root/'release/Windows/OptiLayer/engine').rglob('workspace.json'):
        raise SystemExit(f'User Workspace must not enter a release package: {candidate}')
    if platform.system() == 'Darwin':
        app = root/'release/OptiLayer.app'
        if not app.is_dir(): raise SystemExit('Build and stage the native Mac app first')
        shutil.copytree(app, project/'macOS/OptiLayer.app', symlinks=True)
        asset = out/f'OptiLayer-{version}-macOS-{architecture}.zip'
        subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(project), str(asset)], check=True)
    elif platform.system() == 'Windows':
        app = root/'release/Windows/OptiLayer'
        if not (app/'OptiLayer.exe').is_file() or not (app/'engine/tfc-engine.exe').is_file():
            raise SystemExit('Build and stage the Windows client and engine first')
        (project/'Windows').mkdir()
        shutil.copy2(app/'OptiLayer.exe', project/'Windows/OptiLayer.exe')
        shutil.copytree(app/'engine', project/'Windows/engine')
        asset = out/f'OptiLayer-{version}-Windows-{architecture}-portable.zip'
        with zipfile.ZipFile(asset, 'w', zipfile.ZIP_DEFLATED) as archive:
            for file in sorted(project.rglob('*')):
                if file.is_file(): archive.write(file, 'OptiLayer/'+file.relative_to(project).as_posix())
    else: raise SystemExit('Release packaging supports macOS and Windows')
asset.with_suffix(asset.suffix+'.sha256').write_text(hashlib.sha256(asset.read_bytes()).hexdigest()+'  '+asset.name+'\n', encoding='utf-8')
print(asset)
