"""Stage native Mac app or portable Windows directory. No cross-compilation."""
from pathlib import Path
import platform
import shutil
import uuid
from contextlib import contextmanager

@contextmanager
def staging_directory(parent):
    # Python 3.13 TemporaryDirectory uses a private Windows ACL. A release
    # moved out of it would remain unreadable by the actual desktop user.
    folder = parent / (".tfc-stage-" + uuid.uuid4().hex)
    folder.mkdir()
    try:
        yield folder
    finally:
        if folder.exists():
            assert folder.resolve().parent == parent.resolve()
            shutil.rmtree(folder)
root=Path(__file__).resolve().parents[1]
platform_name=platform.system()
if platform_name=='Darwin':
    source=root/'src-tauri/target/release/bundle/macos/OptiLayer.app'
    target=root/'release/OptiLayer.app'
elif platform_name=='Windows':
    source=root/'src-tauri/target/release'
    target=root/'release/Windows/OptiLayer'
else:raise SystemExit('Desktop release staging is currently supported on macOS and Windows')
target.parent.mkdir(parents=True,exist_ok=True)
previous=target.parent/'.previous'/target.name
previous.parent.mkdir(exist_ok=True)
with staging_directory(target.parent) as folder:
    staged=Path(folder)/target.name
    if platform_name=='Darwin':
        if not source.is_dir():raise SystemExit('Build the Mac app first')
        shutil.copytree(source,staged,symlinks=True)
    else:
        staged.mkdir()
        shutil.copy2(source/'tfc-for-mac.exe',staged/'OptiLayer.exe')
        shutil.copytree(root/'engine/dist/tfc-engine',staged/'engine')
    if previous.exists():shutil.rmtree(previous)
    if target.exists():target.rename(previous)
    try:staged.rename(target)
    except Exception:
        if previous.exists() and not target.exists():previous.rename(target)
        raise
print(f'Local release ready: {target}')
