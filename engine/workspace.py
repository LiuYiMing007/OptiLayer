"""Versioned, relocatable workspace. Absolute root is runtime context only."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import tempfile
import uuid

DIRECTORIES = ('projects', 'materials', 'spectra', 'database', 'imports', 'exports', 'config')
FORMAT = 'tfc-workspace'
VERSION = 1


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.tfc-', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8', newline='\n') as stream:
            json.dump(value, stream, ensure_ascii=False, allow_nan=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class Workspace:
    def __init__(self, root, create=False):
        self.root = Path(root).expanduser().resolve()
        manifest_path = self.root/'workspace.json'
        if not manifest_path.exists():
            if not create:
                raise ValueError('所选目录没有 workspace.json；请打开已有工作区或新建工作区')
            self.root.mkdir(parents=True, exist_ok=True)
            # Do not turn an unrelated populated folder into a workspace silently.
            if any(self.root.iterdir()):
                raise ValueError('新工作区需要空文件夹，请新建子文件夹后选择')
            manifest = {'format': FORMAT, 'schema_version': VERSION, 'id': str(uuid.uuid4()),
                        'name': self.root.name, 'created_at': datetime.now(timezone.utc).isoformat(),
                        'directories': {key: key for key in DIRECTORIES},
                        'units': {'wavelength': 'nm', 'physical_thickness': 'nm', 'spectrum': 'percent'}}
            atomic_json(manifest_path, manifest)
        self.manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        if self.manifest.get('format') != FORMAT or self.manifest.get('schema_version') != VERSION:
            raise ValueError('不支持的 Workspace 格式或版本；未修改该目录')
        if set(self.manifest.get('directories', {})) != set(DIRECTORIES):
            raise ValueError('Workspace 目录清单不完整')
        uuid.UUID(self.manifest['id'])
        if len(set(self.manifest['directories'].values())) != len(DIRECTORIES):
            raise ValueError('Workspace 各数据目录不能重叠')
        if self.manifest.get('units') != {'wavelength':'nm','physical_thickness':'nm','spectrum':'percent'}:
            raise ValueError('Workspace 物理量单位不受支持')
        for key in DIRECTORIES:
            self.directory(key).mkdir(parents=True, exist_ok=True)

    def resolve(self, relative):
        if not isinstance(relative, str) or not relative or '\\' in relative:
            raise ValueError('内部路径必须为非空 POSIX 相对路径')
        posix, windows = PurePosixPath(relative), PureWindowsPath(relative)
        if posix.is_absolute() or windows.drive or '..' in posix.parts:
            raise ValueError('Workspace 内部引用不能为绝对路径或包含上级目录')
        target = (self.root/posix).resolve()
        if not target.is_relative_to(self.root):
            raise ValueError('Workspace 内部引用不能指向目录外部')
        return target

    def directory(self, key):
        return self.resolve(self.manifest['directories'][key])

    def info(self):
        return {'id': self.manifest['id'], 'name': self.manifest['name'],
                'root': str(self.root), 'schema_version': VERSION,
                'directories': self.manifest['directories'], 'units': self.manifest['units']}


def configured_workspace():
    root = os.environ.get('TFC_WORKSPACE_ROOT')
    if not root:
        raise ValueError('未指定 Workspace；请在桌面端选择工作区，或使用 --workspace / TFC_WORKSPACE_ROOT')
    return Workspace(root, create=os.environ.get('TFC_CREATE_WORKSPACE') == '1')
