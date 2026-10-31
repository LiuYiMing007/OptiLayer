import csv
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('tfc_engine', ROOT/'engine/main.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


def fixture():
    settings = json.loads((ROOT/'fixtures/reference/reference_settings.json').read_text(encoding='utf-8'))
    template = {'schema_version':1, 'id':'reference', 'name':'参考膜系', 'layer_order':'substrate_to_air',
                'settings': {'incident_n':1, 'substrate_n':1.52},
                'materials':[{'name':k, **v} for k,v in settings['materials'].items()], 'layers':[]}
    return engine.parse_tfd((ROOT/'fixtures/reference/reference_4layer_550nm.tfd').read_text(encoding='utf-8'), template)


class EngineTests(unittest.TestCase):
    def test_reference_all_301_samples(self):
        result = engine.calculate(fixture())
        with (ROOT/'fixtures/reference/reference_4layer_550nm_spectrum.csv').open(encoding='utf-8-sig') as f:
            rows = list(csv.DictReader(f))
        self.assertEqual(len(result['wavelength_nm']), 301)
        for i, row in enumerate(rows):
            self.assertEqual(result['wavelength_nm'][i], float(row['wavelength_nm']))
            for key in ('R_percent', 'T_percent'):
                self.assertLessEqual(abs(result[key][i]-float(row[key])), 1e-5)
        self.assertLess(result['max_energy_error'], 1e-12)

    def test_bare_interface_fresnel(self):
        p = fixture(); p['layers'] = []
        result = engine.calculate(p)
        expected = 100*((1-1.52)/(1+1.52))**2
        self.assertAlmostEqual(result['R_percent'][0], expected, places=10)

    def test_invalid_inputs(self):
        for key,value in [('step_nm',0),('end_nm',300),('angle_deg',90),('incident_n',-1),('start_nm',float('nan'))]:
            p=fixture(); p['settings'][key]=value
            with self.assertRaises(ValueError): engine.calculate(p)
        p=fixture(); p['materials'][0]['k']=0.01
        with self.assertRaises(ValueError): engine.calculate(p)
        p=fixture(); p['layers'][0]['material']='UNKNOWN'
        with self.assertRaises(ValueError): engine.calculate(p)

    def test_tfd_bad_count_and_unknown_material(self):
        text=(ROOT/'fixtures/reference/reference_4layer_550nm.tfd').read_text(encoding='utf-8')
        for bad in [text.replace('LAYERS*4*','LAYERS*3*'),text.replace('TA2O5_REF','UNKNOWN')]:
            with self.assertRaises(ValueError): engine.parse_tfd(bad, fixture())

    def test_sqlite_save_load_update(self):
        with tempfile.TemporaryDirectory() as folder:
            old=os.environ.get('TFC_WORKSPACE_ROOT'); os.environ['TFC_WORKSPACE_ROOT']=folder
            from workspace import Workspace
            Workspace(folder,create=True)
            try:
                p=fixture()
                engine.dispatch({'action':'save','project':p})
                p['layers'][0]['thickness_nm']=72
                engine.dispatch({'action':'save','project':p})
                loaded=engine.dispatch({'action':'load','id':p['id']})['project']
                self.assertEqual(loaded,engine.validate(p))
                self.assertEqual(len(engine.dispatch({'action':'list'})['projects']),1)
                self.assertEqual(engine.calculate(loaded),engine.calculate(p))
            finally:
                if old is None: os.environ.pop('TFC_WORKSPACE_ROOT',None)
                else: os.environ['TFC_WORKSPACE_ROOT']=old


class CatalogTests(unittest.TestCase):
    def test_shared_library_does_not_mutate_saved_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            old=os.environ.get('TFC_WORKSPACE_ROOT');os.environ['TFC_WORKSPACE_ROOT']=folder
            from workspace import Workspace
            Workspace(folder,create=True)
            try:
                p=fixture();engine.dispatch({'action':'save','project':p})
                m={'name':'CUSTOM_SUBSTRATE','n':1.73,'k':0,'role':'substrate','model':'constant','color':'#8899aa','source':'测试常数'}
                engine.dispatch({'action':'library_save','materials':[m]})
                listed=engine.dispatch({'action':'library_list'})['materials']
                self.assertIn(m,listed)
                replacement=dict(p['materials'][0],n=2.3)
                engine.dispatch({'action':'library_save','materials':[replacement]})
                loaded=engine.dispatch({'action':'load','id':p['id']})['project']
                self.assertEqual(loaded['materials'][0]['n'],2.1)
                p['materials'].append(m);p['settings']['substrate_material']=m['name']
                self.assertEqual(engine.validate(p)['settings']['substrate_n'],1.73)
            finally:
                if old is None:os.environ.pop('TFC_WORKSPACE_ROOT',None)
                else:os.environ['TFC_WORKSPACE_ROOT']=old

    def test_invalid_targets_rejected_before_ui_import(self):
        p=fixture();p['target_points']=[{'wavelength_nm':400,'T_percent':95},{'wavelength_nm':400,'T_percent':90}]
        with self.assertRaises(ValueError):engine.validate(p)
        p['target_points'][1]={'wavelength_nm':450,'T_percent':101}
        with self.assertRaises(ValueError):engine.validate(p)
