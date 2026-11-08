"""Readable, individually importable exports; database remains authoritative."""
import hashlib
import json
import re
from pathlib import Path
from workspace import atomic_json


def file_label(value):
    label = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', str(value)).strip(' .')[:60] or '未命名'
    if label.split('.')[0].upper() in {'CON', 'PRN', 'AUX', 'NUL', *[f'COM{i}' for i in range(1, 10)], *[f'LPT{i}' for i in range(1, 10)]}:
        label = '_' + label
    return label


def named_export(workspace, conn, kind, key, folder, label, suffix, document, text=None):
    row = conn.execute('SELECT relative_path FROM file_exports WHERE kind=? AND item_key=?', (kind, key)).fetchone()
    old = row[0] if row else None
    base = f'{folder}/{file_label(label)}'
    relative = base + suffix
    if old and Path(old).parent.as_posix() == folder and (Path(old).name == file_label(label) + suffix or re.fullmatch(re.escape(file_label(label)) + r' \(\d+\)' + re.escape(suffix), Path(old).name)):
        relative = old
    # Case-fold collisions matter even when this workspace is currently on Linux.
    used = {r[0].casefold() for r in conn.execute('SELECT relative_path FROM file_exports WHERE NOT (kind=? AND item_key=?)', (kind, key))}
    number = 1
    while relative.casefold() in used or (workspace.resolve(relative).exists() and relative != old):
        number += 1
        relative = f'{base} ({number}){suffix}'
    if text is None:atomic_json(workspace.resolve(relative), document)
    else:
        import os,tempfile
        destination=workspace.resolve(relative);destination.parent.mkdir(parents=True,exist_ok=True)
        descriptor,temporary=tempfile.mkstemp(prefix='.tfc-',suffix='.tmp',dir=destination.parent)
        try:
            with os.fdopen(descriptor,'wb') as stream:
                stream.write(text.encode('gb18030'));stream.flush();os.fsync(stream.fileno())
            os.replace(temporary,destination)
        finally:
            if os.path.exists(temporary):os.unlink(temporary)
    conn.execute('INSERT INTO file_exports VALUES (?,?,?) ON CONFLICT(kind,item_key) DO UPDATE SET relative_path=excluded.relative_path', (kind, key, relative))
    if old and old != relative:
        # Delete only an unchanged export of this exact record, never a hand-edited file.
        previous = workspace.resolve(old)
        try:
            data = json.loads(previous.read_text(encoding='utf-8'))
            if data == document or (kind == 'project' and data.get('id') == document.get('id') and {k:v for k,v in data.items() if k != 'name'} == {k:v for k,v in document.items() if k != 'name'}):
                previous.unlink()
        except (OSError, ValueError):
            pass
    return relative


def export_catalogue(workspace, materials):
    root = workspace.directory('materials')
    marker = root/'catalogue'/'individual-files-v1.json'
    if marker.is_file():
        return
    files = []
    for material in materials:
        collection = file_label(material.get('collection') or 'TFCalc')
        category = 'substrates' if material.get('role') in ('substrate', 'medium') else 'catalogue'
        label = file_label(material.get('display_name') or material['name'].split('/')[-1])
        digest = hashlib.sha256(material['name'].encode('utf-8')).hexdigest()[:8]
        # A short identifier separates genuinely distinct records with the same label.
        relative = f'{category}/{collection}/{label}--{digest}.material.json'
        target = root/relative
        if not target.exists():
            atomic_json(target, material)
        files.append({'name': material['name'], 'path': relative})
    atomic_json(marker, {'format': 'tfc-individual-material-exports', 'files': files})
