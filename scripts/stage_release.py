"""Stage native Mac app or portable Windows directory. No cross-compilation."""
from pathlib import Path
import platform
import shutil
import tempfile
root=Path(__file__).resolve().parents[1]
platform_name=platform.system()
if platform_name=='Darwin':
    source=root/'src-tauri/target/release/bundle/macos/TFC.app'
    target=root/'release/TFC.app'
elif platform_name=='Windows':
    source=root/'src-tauri/target/release'
    target=root/'release/Windows/TFC'
else:raise SystemExit('Desktop release staging is currently supported on macOS and Windows')
target.parent.mkdir(parents=True,exist_ok=True)
previous=target.parent/'.previous'/target.name
previous.parent.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='.tfc-stage-',dir=target.parent) as folder:
    staged=Path(folder)/target.name
    if platform_name=='Darwin':
        if not source.is_dir():raise SystemExit('Build the Mac app first')
        shutil.copytree(source,staged,symlinks=True)
    else:
        staged.mkdir()
        shutil.copy2(source/'tfc-for-mac.exe',staged/'TFC.exe')
        shutil.copytree(root/'engine/dist/tfc-engine',staged/'engine')
    if previous.exists():shutil.rmtree(previous)
    if target.exists():target.rename(previous)
    try:staged.rename(target)
    except Exception:
        if previous.exists() and not target.exists():previous.rename(target)
        raise
print(f'Local release ready: {target}')
