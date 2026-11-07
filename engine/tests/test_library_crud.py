import copy
import json
from pathlib import Path
import shutil
import sqlite3
import tempfile
import unittest
from test_engine import fixture, engine
from workspace import Workspace
from repository import connect_db, storage_action
from models import BUILTIN_MATERIALS
from catalogue import catalogue_material


class LibraryCrudTests(unittest.TestCase):
    def test_create_edit_delete_restore_and_move_keeps_project_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            w = Workspace(Path(folder)/'原工作区', create=True)
            p = fixture()
            for role in ('film', 'substrate'):
                m = dict(name='USER/'+role, display_name='测试材料' if role == 'film' else '测试基底', role=role, n=1.73, k=0, model='constant', color='#123456', source='试验')
                engine.dispatch({'action':'library_save', 'materials':[m]}, w)
                category = 'substrates' if role == 'substrate' else 'films'
                path = w.directory('materials')/category/(m['display_name']+'.material.json')
                self.assertEqual(json.loads(path.read_text(encoding='utf-8')), m)
                self.assertIn(m, engine.dispatch({'action':'library_list'}, w)['materials'])
                original = copy.deepcopy(m)
                m['n'] = 1.8
                engine.dispatch({'action':'library_save', 'materials':[m]}, w)
                with self.assertRaisesRegex(ValueError, '材料已改变'):
                    engine.dispatch({'action':'library_delete', 'name':m['name'], 'expected':original}, w)
                p['materials'].append(m)
                engine.dispatch({'action':'save', 'project':p}, w)
                engine.dispatch({'action':'library_delete', 'name':m['name'], 'expected':m}, w)
                self.assertFalse(path.exists())
                self.assertNotIn(m['name'], [x['name'] for x in engine.dispatch({'action':'library_list'}, w)['materials']])
                self.assertEqual(engine.dispatch({'action':'load', 'id':p['id']}, w)['project']['materials'], p['materials'])
                engine.dispatch({'action':'library_restore', 'name':m['name']}, w)
                self.assertEqual(json.loads(path.read_text(encoding='utf-8')), m)
                engine.dispatch({'action':'library_delete', 'name':m['name'], 'expected':m}, w)
            new = Path(folder)/'SSD'/'Workspace';new.parent.mkdir();shutil.move(w.root, new);w = Workspace(new)
            names = [m['name'] for m in engine.dispatch({'action':'library_list'}, w)['materials']]
            self.assertNotIn('USER/film', names);self.assertNotIn('USER/substrate', names)
            engine.dispatch({'action':'library_restore', 'name':'USER/substrate'}, w)
            self.assertIn('USER/substrate', [m['name'] for m in engine.dispatch({'action':'library_list'}, w)['materials']])

    def test_catalogue_removal_survives_reopen_without_mutating_original(self):
        with tempfile.TemporaryDirectory() as folder:
            w = Workspace(folder, create=True)
            engine.dispatch({'action':'library_list'}, w)
            source = w.directory('materials')/'catalogue/TFCalc-0.2.0.original.json'
            before = source.read_bytes()
            m = catalogue_material('TFC/SOPRA/AG')
            engine.dispatch({'action':'library_delete','name':m['name'],'expected':m}, w)
            self.assertNotIn(m['name'], [x['name'] for x in engine.dispatch({'action':'library_list'}, Workspace(folder))['materials']])
            self.assertEqual(source.read_bytes(), before)
            engine.dispatch({'action':'library_restore','name':m['name']}, w)
            self.assertEqual(sum(x['name']==m['name'] for x in engine.dispatch({'action':'library_list'}, w)['materials']), 1)

    def test_upgrade_removes_only_unchanged_demo_records(self):
        with tempfile.TemporaryDirectory() as folder:
            w = Workspace(folder, create=True)
            conn = connect_db(w)
            for m in BUILTIN_MATERIALS:
                conn.execute('INSERT INTO materials VALUES (?,?,?)', (m['name'], json.dumps(m), 'old'))
            changed = dict(BUILTIN_MATERIALS[0], n=2.7)
            conn.execute('UPDATE materials SET document=? WHERE name=?', (json.dumps(changed), changed['name']))
            conn.execute('PRAGMA user_version=3');conn.commit();conn.close()
            listed = storage_action(w, {'action':'library_list'})['materials']
            self.assertEqual(listed, [changed])
            self.assertEqual(storage_action(w, {'action':'library_list'})['materials'], [changed])
            self.assertEqual(len(list((w.directory('materials')/'deleted').glob('*.json'))), 3)

    def test_hand_edited_export_is_not_deleted(self):
        with tempfile.TemporaryDirectory() as folder:
            w = Workspace(folder, create=True);m = dict(BUILTIN_MATERIALS[0], name='USER/test')
            storage_action(w, {'action':'library_save','materials':[m]})
            path = w.directory('materials')/'films/test.material.json';path.write_text('hand edited', encoding='utf-8')
            storage_action(w, {'action':'library_delete','name':m['name'],'expected':m})
            self.assertEqual(path.read_text(), 'hand edited')
