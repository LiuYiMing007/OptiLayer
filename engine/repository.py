"""SQLite authoritative storage; UTF-8 JSON files are portable recovery exports."""
import json
from pathlib import Path
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from models import BUILTIN_MATERIALS, validate, validate_material
from workspace import atomic_json
from catalogue import catalogue, catalogue_summaries
from file_exports import named_export, export_catalogue, file_label

SCHEMA_VERSION = 4


def remove_library_record(workspace, conn, material):
    """Logical deletion is portable; a full recoverable record stays outside active folders."""
    name = material['name']
    import hashlib
    backup = workspace.manifest['directories']['materials']+'/deleted/'+hashlib.sha256(name.encode()).hexdigest()[:16]+'.material.json'
    atomic_json(workspace.resolve(backup), material)
    row = conn.execute("SELECT relative_path FROM file_exports WHERE kind='material' AND item_key=?", (name,)).fetchone()
    if row:
        path = workspace.resolve(row[0])
        if path.exists():
            try:
                if json.loads(path.read_text(encoding='utf-8')) == material:
                    path.unlink()
            except (ValueError, OSError): pass  # Never erase a hand-edited file.
    conn.execute('INSERT OR REPLACE INTO removed_materials VALUES (?,?)', (name, json.dumps(material, ensure_ascii=False)))
    conn.execute('DELETE FROM materials WHERE name=?', (name,))
    conn.execute("DELETE FROM file_exports WHERE kind='material' AND item_key=?", (name,))


def connect_db(workspace):
    path = workspace.directory('database')/'workspace.sqlite3'
    conn = sqlite3.connect(path, timeout=10)
    version = conn.execute('PRAGMA user_version').fetchone()[0]
    if version > SCHEMA_VERSION:
        conn.close()
        raise ValueError('数据库版本高于当前软件支持版本，未降级或修改数据库')
    # Rollback journal keeps normal closed workspaces portable; no WAL sidecars.
    conn.execute('PRAGMA journal_mode=DELETE')
    conn.execute('PRAGMA synchronous=FULL')
    conn.execute('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, document TEXT NOT NULL, updated_at TEXT NOT NULL)')
    conn.execute('CREATE TABLE IF NOT EXISTS materials (name TEXT PRIMARY KEY, document TEXT NOT NULL, updated_at TEXT NOT NULL)')
    conn.execute('CREATE TABLE IF NOT EXISTS spectra (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, relative_path TEXT NOT NULL, created_at TEXT NOT NULL)')
    conn.execute('CREATE TABLE IF NOT EXISTS file_exports (kind TEXT NOT NULL, item_key TEXT NOT NULL, relative_path TEXT NOT NULL UNIQUE, PRIMARY KEY(kind,item_key))')
    conn.execute('CREATE TABLE IF NOT EXISTS removed_materials (name TEXT PRIMARY KEY, document TEXT NOT NULL)')
    # Remove only the four unchanged demonstration records from the shared library.
    # Project snapshots and user-edited variants remain intact.
    if version < 4:
        for material in BUILTIN_MATERIALS:
            row = conn.execute('SELECT document FROM materials WHERE name=?', (material['name'],)).fetchone()
            if row and json.loads(row[0]) == material:
                remove_library_record(workspace, conn, material)

    conn.execute(f'PRAGMA user_version={SCHEMA_VERSION}')
    conn.commit()
    # A discoverable, portable reference export. Never overwrite files users have.
    catalogue_file=workspace.resolve(workspace.manifest['directories']['materials']+'/catalogue/TFCalc-0.2.0.original.json')
    if not catalogue_file.exists():
        try:
            atomic_json(catalogue_file,catalogue())
        except OSError:
            pass  # Database operations remain usable on export failure.
    try:
        export_catalogue(workspace, catalogue()['materials'])
        # Existing projects acquire readable exports lazily without changing their IDs.
        for key, name, document in conn.execute("SELECT id,name,document FROM projects WHERE id NOT IN (SELECT item_key FROM file_exports WHERE kind='project')").fetchall():
            named_export(workspace, conn, 'project', key, workspace.manifest['directories']['projects'], name, '.tfc.json', json.loads(document))
        for key, document in conn.execute("SELECT name,document FROM materials" if version < 4 else "SELECT name,document FROM materials WHERE name NOT IN (SELECT item_key FROM file_exports WHERE kind='material')").fetchall():
            material = json.loads(document)
            category = 'substrates' if material.get('role') in ('substrate','medium') else 'films'
            named_export(workspace, conn, 'material', key, workspace.manifest['directories']['materials']+'/'+category, material.get('display_name') or key.split('/')[-1], '.material.json', material)
        conn.commit()
    except OSError:
        pass
    return conn


def project_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,127}', value):
        raise ValueError('项目 ID 必须为跨平台稳定标识，不能用作路径')
    if value.upper() in {'CON','PRN','AUX','NUL',*[f'COM{i}' for i in range(1,10)],*[f'LPT{i}' for i in range(1,10)]}:
        raise ValueError('项目 ID 不能使用 Windows 保留名称')
    return value


def storage_action(workspace, request):
    action = request['action']
    conn = connect_db(workspace)
    try:
        with conn:
            if action == 'library_list':
                return {'materials': [json.loads(row[0]) for row in conn.execute('SELECT document FROM materials ORDER BY name')], 'removed': [row[0] for row in conn.execute('SELECT name FROM removed_materials')]}
            if action == 'library_delete':
                name = request['name']
                row = conn.execute('SELECT document FROM materials WHERE name=?', (name,)).fetchone()
                material = json.loads(row[0]) if row else next((m for m in catalogue()['materials'] if m['name'] == name), None)
                if material is None: raise ValueError('材料已不存在，请刷新目录')
                expected = request.get('expected')
                if not row and material:
                    material = {k:v for k,v in material.items() if k not in ('preview','raw_records')}
                    current = next((m for m in catalogue_summaries() if m['name'] == name), None) if isinstance(expected, dict) and expected.get('catalogue_summary') else material
                else: current = material
                if expected != current: raise ValueError('材料已改变，请刷新后再删除')
                remove_library_record(workspace, conn, material)
                return {'deleted': True}
            if action == 'library_restore':
                row = conn.execute('SELECT document FROM removed_materials WHERE name=?', (request['name'],)).fetchone()
                if row is None: raise ValueError('没有可恢复的材料')
                material = json.loads(row[0])
                conn.execute('DELETE FROM removed_materials WHERE name=?', (material['name'],))
                conn.execute("INSERT OR IGNORE INTO materials VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))", (material['name'], row[0]))
                category = 'substrates' if material.get('role') in ('substrate','medium') else 'films'
                named_export(workspace, conn, 'material', material['name'], workspace.manifest['directories']['materials']+'/'+category, material.get('display_name') or material['name'], '.material.json', material)
                return {'restored': True}
            if action == 'library_save':
                materials = request['materials']
                if not isinstance(materials, list) or not 1 <= len(materials) <= 300:
                    raise ValueError('一次保存 1–300 种材料')
                for material in materials:
                    validate_material(material)
                    if material.get("catalogue_summary"): raise ValueError("不能保存目录摘要，请先读取完整材料数据")
                for material in materials:
                    conn.execute('DELETE FROM removed_materials WHERE name=?', (material['name'],))
                    conn.execute("INSERT INTO materials VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(name) DO UPDATE SET document=excluded.document, updated_at=excluded.updated_at", (material['name'], json.dumps(material, ensure_ascii=False, allow_nan=False)))
                conn.commit()
                warnings=[]
                for material in materials:
                    try:
                        category = 'substrates' if material.get('role') in ('substrate','medium') else 'films'
                        named_export(workspace, conn, 'material', material['name'], workspace.manifest['directories']['materials']+'/'+category, material.get('display_name') or material['name'].split('/')[-1], '.material.json', material)
                    except (OSError, ValueError) as error:
                        warnings.append(f'材料已入库，但恢复副本未写入：{error}')
                return {'saved': True, 'warnings': warnings}
            if action == 'save':
                p = validate(request['project'])
                key = project_id(p.get('id'))
                conn.execute("INSERT INTO projects VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO UPDATE SET name=excluded.name, document=excluded.document, updated_at=excluded.updated_at", (key, p['name'], json.dumps(p, ensure_ascii=False, allow_nan=False)))
                conn.commit()
                warnings=[]
                relative_path=None
                try:
                    relative_path=named_export(workspace, conn, 'project', key, workspace.manifest['directories']['projects'], p['name'], '.tfc.json', p)
                except OSError as error:
                    warnings.append(f'项目已入库，但恢复副本未写入：{error}')
                return {'saved': True, 'project': p, 'relative_path':relative_path, 'warnings': warnings}
            if action == 'list':
                return {'projects': [dict(zip(('id','name','updated_at','relative_path'), row)) for row in conn.execute("SELECT p.id,p.name,p.updated_at,f.relative_path FROM projects p LEFT JOIN file_exports f ON f.kind='project' AND f.item_key=p.id ORDER BY p.updated_at DESC")]}
            if action == 'load':
                row = conn.execute('SELECT document FROM projects WHERE id=?', (request['id'],)).fetchone()
                if row is None:
                    raise ValueError('项目不存在')
                return {'project': validate(json.loads(row[0]))}
            if action == 'spectrum_save':
                key=project_id(request['project_id'])
                stored=conn.execute('SELECT document FROM projects WHERE id=?',(key,)).fetchone()
                if stored is None:
                    raise ValueError('请先保存项目再保存光谱')
                spectrum=request['spectrum']
                def optical_input(p):
                    p=validate(p)
                    return {**{field:p[field] for field in ('settings','materials','layers','layer_order')},'back_layers':p.get('back_layers',[]),'response_data':p.get('response_data',{})}
                if optical_input(json.loads(stored[0])) != optical_input(spectrum['input_snapshot']):
                    raise ValueError('数据库项目已修改，未保存过期光谱')
                if validate(spectrum['input_snapshot']) != validate(request['project']):
                    raise ValueError('光谱输入与保存项目不一致，未保存过期光谱')
                spectrum_id=str(uuid.uuid4())
                relative=f"{workspace.manifest['directories']['spectra']}/{file_label(json.loads(stored[0])['name'])}--{key[:8]}/光谱-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.spectrum.json"
                atomic_json(workspace.resolve(relative), {'schema_version':1,'engine':'python-tmm-v1','units':workspace.manifest['units'],'result':spectrum})
                conn.execute("INSERT INTO spectra VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",(spectrum_id,key,relative))
                return {'saved':True,'relative_path':relative}
        raise ValueError('未知存储操作')
    finally:
        conn.close()


def import_legacy_database(workspace, source):
    """Copy, never move/overwrite. Source is picked by the trusted desktop host."""
    source=Path(source).resolve()
    target=workspace.directory('database')/'workspace.sqlite3'
    if not source.is_file() or source==target.resolve():
        raise ValueError('旧数据库不存在，或已是当前工作区数据库')
    if target.exists():
        c=sqlite3.connect(target)
        try:
            if c.execute('SELECT count(*) FROM projects').fetchone()[0] or c.execute('SELECT count(*) FROM spectra').fetchone()[0]:
                raise ValueError('目标工作区已有项目或光谱，请新建空工作区后迁移')
            # Do not replace a user's independently edited shared library.
            actual={r[0] for r in c.execute('SELECT document FROM materials')}
            expected={json.dumps(m,ensure_ascii=False) for m in BUILTIN_MATERIALS}
            if actual != expected:
                raise ValueError('目标材料库已有修改，请使用空工作区迁移')
        finally:c.close()
    original=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)
    try:
        version=original.execute('PRAGMA user_version').fetchone()[0]
        if version>2:raise ValueError('该数据库应通过完整 Workspace 打开，不支持作为旧版数据库迁移')
        docs=list(original.execute('SELECT document FROM projects'))
        for document, in docs:
            validated=validate(json.loads(document));project_id(validated['id'])
        backup=workspace.directory('database')/f'legacy-{uuid.uuid4()}.sqlite3'
        copied=sqlite3.connect(backup)
        try:original.backup(copied)
        finally:copied.close()
        # Migration target is known empty; backup source remains untouched.
        import os
        os.replace(backup,target)
    finally:original.close()
    conn=connect_db(workspace);conn.close()
    for document, in docs:
        p=validate(json.loads(document))
        atomic_json(workspace.directory('projects')/f'{project_id(p["id"])}.tfc.json',p)
    return {'imported_projects':len(docs),'workspace':workspace.info()}
