import json
from pathlib import Path
import shutil
import tempfile
import unittest
from test_engine import fixture,engine
from workspace import Workspace
from catalogue import catalogue_material
from material_edit import prepare_material
from repository import storage_action


class WorkbenchFixTests(unittest.TestCase):
    def test_catalogue_is_independent_of_workspace_failure(self):
        import os
        previous=os.environ.get('TFC_WORKSPACE_ROOT');os.environ['TFC_WORKSPACE_ROOT']='/missing/no-workspace'
        try:self.assertEqual(len(engine.dispatch({'action':'catalogue_list'})['materials']),1211)
        finally:
            if previous is None:os.environ.pop('TFC_WORKSPACE_ROOT',None)
            else:os.environ['TFC_WORKSPACE_ROOT']=previous

    def test_mac_finder_metadata_does_not_block_initial_workspace(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)/'Workspace';root.mkdir()
            for name in ('.DS_Store','._metadata','desktop.ini','Thumbs.db'):(root/name).write_text('metadata')
            self.assertTrue((Workspace(root,create=True).root/'workspace.json').exists())
            bad=Path(t)/'user-folder';bad.mkdir();(bad/'experiment.csv').write_text('do not overwrite')
            with self.assertRaises(ValueError):Workspace(bad,create=True)
            self.assertFalse((bad/'workspace.json').exists())

    def test_edit_tabulated_and_formula_without_flattening_data(self):
        m=catalogue_material('TFC/SOPRA/AG');m['name']='USER/silver';m['display_name']='编辑银';m['samples'][10][1]+=.01
        result=prepare_material(m);self.assertEqual(result['samples'],m['samples']);self.assertEqual(len(result['samples']),121)
        g=catalogue_material('TFC/SCHOTT/BK7');g['name']='USER/glass';g['range_nm']=[400,700];g['formula']['coefficients'][0]+=.01
        prepared=prepare_material(g);self.assertEqual(prepared['formula'],g['formula']);self.assertNotEqual(prepared['n'],catalogue_material('TFC/SCHOTT/BK7')['n'])
        bad=dict(m);bad['samples']=[[500,1.5,0],[400,1.5,0]]
        with self.assertRaises(ValueError):prepare_material(bad)

    def test_readable_files_catalogue_and_edited_project_survive_relocation(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)/'original';w=Workspace(root,create=True)
            m=catalogue_material('TFC/SOPRA/AG');m.update(name='USER/silver',display_name='银/工艺:A');m['samples'][5][2]+=.02;m=prepare_material(m)
            storage_action(w,{'action':'library_save','materials':[m]})
            files=list((root/'materials/films').glob('*.material.json'));self.assertEqual(len(files),1);self.assertIn('银_工艺_A',files[0].name)
            self.assertEqual(json.loads(files[0].read_text(encoding='utf-8')),m)
            c=root/'materials/catalogue/TFCalc-0.2.0.original.json';self.assertEqual(len(json.loads(c.read_text(encoding='utf-8'))['materials']),1211)
            p=fixture();p['materials'].append(m);p['layers'][0]['material']=m['name'];storage_action(w,{'action':'save','project':p});before=engine.calculate(p)
            moved=Path(t)/'new-drive';shutil.move(root,moved);w=Workspace(moved)
            loaded=storage_action(w,{'action':'load','id':p['id']})['project'];self.assertEqual(engine.calculate(loaded),before)
            # An existing catalogue export is never silently overwritten.
            c=moved/'materials/catalogue/TFCalc-0.2.0.original.json';c.write_text('user note',encoding='utf-8')
            storage_action(w,{'action':'list'});self.assertEqual(c.read_text(),'user note')
