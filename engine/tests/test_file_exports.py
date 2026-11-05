import json
import tempfile
from pathlib import Path
import unittest
from test_engine import fixture
from workspace import Workspace
from repository import storage_action

class FileExportsTests(unittest.TestCase):
    def test_named_projects_collisions_rename_and_individual_catalogue(self):
        with tempfile.TemporaryDirectory() as t:
            w = Workspace(t, create=True)
            p = fixture(); p['name'] = '长波通:395'
            storage_action(w, {'action':'save','project':p})
            root = w.directory('projects')
            file = root/'长波通_395.tfc.json'
            self.assertEqual(json.loads(file.read_text(encoding='utf-8'))['id'], p['id'])
            other = dict(p, id='another-project')
            storage_action(w, {'action':'save','project':other})
            storage_action(w, {'action':'save','project':other})
            self.assertTrue((root/'长波通_395 (2).tfc.json').is_file())
            self.assertFalse((root/'长波通_395 (3).tfc.json').exists())
            p['name'] = '改名'; storage_action(w, {'action':'save','project':p})
            self.assertFalse(file.exists()); self.assertTrue((root/'改名.tfc.json').exists())
            index = json.loads((w.directory('materials')/'catalogue/individual-files-v1.json').read_text(encoding='utf-8'))
            self.assertEqual(len(index['files']),1211)
            bk7 = next(m for m in index['files'] if m['name']=='TFC/SCHOTT/BK7')
            self.assertIn('substrates/', bk7['path'])
            record=json.loads((w.directory('materials')/bk7['path']).read_text(encoding='utf-8'))
            self.assertEqual(record['name'],'TFC/SCHOTT/BK7')

    def test_existing_user_file_is_not_overwritten_by_named_export(self):
        with tempfile.TemporaryDirectory() as t:
            w=Workspace(t,create=True); root=w.directory('projects')
            existing=root/'保留.tfc.json';existing.write_text('user file',encoding='utf-8')
            p=fixture();p['name']='保留';storage_action(w,{'action':'save','project':p})
            self.assertEqual(existing.read_text(encoding='utf-8'),'user file')
            self.assertTrue((root/'保留 (2).tfc.json').is_file())
