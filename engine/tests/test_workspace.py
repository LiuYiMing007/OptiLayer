import ast
import copy
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import unittest
from test_engine import fixture,engine,ROOT
from workspace import Workspace,atomic_json
from repository import storage_action,import_legacy_database,connect_db


class WorkspaceTests(unittest.TestCase):
    def test_move_entire_workspace_and_reproduce_spectrum(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);original=base/'中文工作区';w=Workspace(original,create=True)
            p=fixture();p['name']='窄带膜系 / 特殊:名称';r=engine.calculate(p)
            storage_action(w,{'action':'save','project':p})
            storage_action(w,{'action':'library_save','materials':p['materials']})
            artifact=storage_action(w,{'action':'spectrum_save','project_id':p['id'],'project':p,'spectrum':r})
            for document in [original/'workspace.json',*original.joinpath('projects').glob('*.json'),*original.joinpath('materials').glob('*.json')]:
                self.assertNotIn(str(original),document.read_text(encoding='utf-8'))
            relocated=base/'模拟移动SSD'/'工作区';relocated.parent.mkdir();shutil.move(original,relocated)
            reopened=Workspace(relocated)
            loaded=storage_action(reopened,{'action':'load','id':p['id']})['project']
            self.assertEqual(engine.calculate(loaded),r)
            saved=json.loads(reopened.resolve(artifact['relative_path']).read_text(encoding='utf-8'))
            self.assertEqual(saved['result'],r)
            self.assertEqual(reopened.manifest['id'],w.manifest['id'])
            self.assertFalse(original.exists())
            self.assertTrue(list(reopened.directory('projects').glob('*.tfc.json')))

    def test_reject_absolute_windows_and_parent_references(self):
        with tempfile.TemporaryDirectory() as folder:
            w=Workspace(folder,create=True)
            for name in ['/tmp/x','../outside','projects/../../x','C:/Users/test/x','C:\\Users\\test\\x','//server/share','projects\\x']:
                with self.subTest(name=name),self.assertRaises(ValueError):w.resolve(name)

    def test_missing_drive_or_manifest_does_not_create_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            missing=Path(folder)/'detached-drive'
            with self.assertRaises(ValueError):Workspace(missing)
            self.assertFalse(missing.exists())

    def test_future_manifest_or_database_not_silently_downgraded(self):
        with tempfile.TemporaryDirectory() as folder:
            w=Workspace(folder,create=True)
            c=connect_db(w);c.execute('PRAGMA user_version=100');c.close()
            with self.assertRaises(ValueError):connect_db(w)
            c=sqlite3.connect(w.directory('database')/'workspace.sqlite3')
            self.assertEqual(c.execute('PRAGMA user_version').fetchone()[0],100);c.close()
            doc=w.manifest.copy();doc['schema_version']=100;atomic_json(w.root/'workspace.json',doc)
            before=(w.root/'workspace.json').read_bytes()
            with self.assertRaises(ValueError):Workspace(folder)
            self.assertEqual(before,(w.root/'workspace.json').read_bytes())

    def test_legacy_copy_preserves_source_and_refuses_populated_target(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);old=base/'old.sqlite3';p=fixture()
            c=sqlite3.connect(old);c.execute('CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,document TEXT,updated_at TEXT)')
            c.execute('INSERT INTO projects VALUES(?,?,?,?)',(p['id'],p['name'],json.dumps(p),'2026-10-30'))
            c.execute('PRAGMA user_version=1');c.commit();c.close()
            before=old.read_bytes();w=Workspace(base/'new',create=True)
            imported=import_legacy_database(w,old)
            self.assertEqual(imported['imported_projects'],1)
            self.assertEqual(old.read_bytes(),before)
            loaded=storage_action(w,{'action':'load','id':p['id']})['project']
            self.assertEqual(engine.calculate(loaded),engine.calculate(p))
            with self.assertRaises(ValueError):import_legacy_database(w,old)

    def test_stale_spectrum_cannot_be_attached_to_updated_project(self):
        with tempfile.TemporaryDirectory() as folder:
            w=Workspace(folder,create=True);p=fixture();r=engine.calculate(p)
            p['layers'][0]['thickness_nm']+=1;storage_action(w,{'action':'save','project':p})
            with self.assertRaises(ValueError):storage_action(w,{'action':'spectrum_save','project_id':p['id'],'project':r['input_snapshot'],'spectrum':r})

    def test_json_snapshot_failure_keeps_committed_database(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as folder:
            w=Workspace(folder,create=True);p=fixture()
            with patch('repository.atomic_json',side_effect=OSError('模拟只读或磁盘写入失败')):
                saved=storage_action(w,{'action':'save','project':p})
            self.assertTrue(saved['saved']);self.assertTrue(saved['warnings'])
            self.assertEqual(storage_action(w,{'action':'load','id':p['id']})['project'],engine.validate(p))

    def test_core_has_no_storage_imports_and_needs_no_workspace(self):
        for file in ['optics.py','analysis.py','models.py']:
            tree=ast.parse((ROOT/'engine'/file).read_text(encoding='utf-8'))
            imports=[n.module for n in ast.walk(tree) if isinstance(n,ast.ImportFrom)]
            self.assertFalse(set(imports)&{'workspace','repository','application','main','importers.tfd'})
        before=os.environ.pop('TFC_WORKSPACE_ROOT',None)
        try:self.assertEqual(len(engine.dispatch({'action':'calculate','project':fixture()})['wavelength_nm']),301)
        finally:
            if before is not None:os.environ['TFC_WORKSPACE_ROOT']=before
