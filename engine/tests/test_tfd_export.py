import copy,json,sys,tempfile,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from catalogue import catalogue_material
from models import validate,BUILTIN_MATERIALS
from application import dispatch,calculate
from importers.tfd import parse_tfd,decode_tfd
from exporters.tfd import export_tfd
from workspace import Workspace


def project():
    names=['TFC/SUBSTRAT/AIR','TFC/SUBSTRAT/GLASS','TFC/MATERIAL/TA2O5','TFC/MATERIAL/SIO2']
    p={'schema_version':1,'id':'tfd-export-test','name':'兼容膜系','layer_order':'substrate_to_air',
       'materials':[catalogue_material(n)for n in names],
       'settings':{'start_nm':400,'end_nm':700,'step_nm':2,'reference_nm':550,'angle_deg':30,'polarization':'p','incident_n':1,'substrate_n':1.52,'incident_material':names[0],'substrate_material':names[1]},
       'layers':[{'id':'one','material':names[2],'thickness_nm':123.1234567890123,'group':2},{'id':'two','material':names[3],'thickness_nm':47.890123456789,'group':0}],
       'group_factors':{'2':1.23456789}}
    return validate(p)

class TFDExportTests(unittest.TestCase):
    def test_real_records_round_trip_groups_polarization_and_rt(self):
        p=project();original=copy.deepcopy(p);out=export_tfd(p)
        self.assertTrue(out['content'].startswith('VERSION*1*\r\nCONFIG*'))
        self.assertNotEqual(out['content'][0],'{');self.assertEqual(bytes(out['bytes']).decode('gb18030'),out['content'])
        q=parse_tfd(out['content'],{'materials':BUILTIN_MATERIALS},'roundtrip.tfd')
        self.assertEqual(p,original);self.assertEqual(q['settings']['polarization'],'p')
        self.assertEqual(q['settings']['angle_deg'],30)
        np.testing.assert_allclose([l['thickness_nm']for l in q['layers']],[l['thickness_nm']for l in p['layers']],rtol=0,atol=3e-14)
        a=calculate(p);b=calculate(q)
        np.testing.assert_allclose(a['R_percent'],b['R_percent'],rtol=0,atol=1e-10)
        np.testing.assert_allclose(a['T_percent'],b['T_percent'],rtol=0,atol=1e-10)
    def test_finite_rear_and_first_surface_are_preserved(self):
        p=project();p['settings'].update(substrate_model='incoherent',substrate_thickness_mm=1.2,exit_material=p['settings']['incident_material'],first_surface='back')
        p['back_layers']=[dict(id='rear',material=p['layers'][1]['material'],thickness_nm=72.10987654321,group=2)]
        q=parse_tfd(export_tfd(p)['content'],{'materials':BUILTIN_MATERIALS})
        self.assertEqual(q['settings']['first_surface'],'back');self.assertEqual(len(q['back_layers']),1)
        np.testing.assert_allclose(calculate(p)['T_percent'],calculate(q)['T_percent'],atol=1e-10,rtol=0)
    def test_changed_same_name_material_is_never_silently_substituted(self):
        p=project();p['materials'][2]['samples'][0][1]+=.02
        with self.assertRaisesRegex(ValueError,'n/k 数据与原版'):export_tfd(p)
    def test_nonrepresentable_project_is_rejected_without_saving(self):
        p=project();p['settings'].update(substrate_model='coherent',substrate_thickness_mm=1,exit_material=p['settings']['incident_material'])
        with self.assertRaisesRegex(ValueError,'相干'):export_tfd(p)
        with tempfile.TemporaryDirectory()as folder:
            w=Workspace(Path(folder)/'Workspace',create=True)
            with self.assertRaises(ValueError):dispatch({'action':'save','project':p,'format':'tfd'},workspace=w)
            self.assertEqual(dispatch({'action':'list'},workspace=w)['projects'],[])
            self.assertFalse(list(w.directory('projects').glob('*.tfd')))
    def test_workspace_named_tfd_and_json_fallback_keep_exact_database_snapshot(self):
        with tempfile.TemporaryDirectory()as folder:
            w=Workspace(Path(folder)/'Workspace',create=True);p=project()
            r=dispatch({'action':'save','project':p,'format':'tfd'},workspace=w)
            self.assertTrue(r['relative_path'].endswith('兼容膜系.tfd'))
            saved=w.resolve(r['relative_path']).read_bytes()
            q=parse_tfd(decode_tfd(saved)['content'],{'materials':BUILTIN_MATERIALS})
            self.assertEqual(len(q['layers']),2)
            self.assertEqual(dispatch({'action':'load','id':p['id']},workspace=w)['project'],validate(p))
            p['response_data']={'distributions':[{'name':'ANGULAR','samples':[[0,100],[30,50]]}]}
            with self.assertRaisesRegex(ValueError,'完整项目 JSON'):export_tfd(p)
            r=dispatch({'action':'save','project':p,'format':'json'},workspace=w)
            self.assertEqual(json.loads(w.resolve(r['relative_path']).read_text(encoding='utf-8'))['response_data'],p['response_data'])
    def test_unknown_original_records_survive_while_known_fields_update(self):
        p=project();text=export_tfd(p)['content'].replace('COMMENTS*0*','CUSTOM-RECORD*UNCHANGED*\r\nCOMMENTS*0*')
        q=parse_tfd(text,{'materials':BUILTIN_MATERIALS});q['layers'][0]['thickness_nm']+=1
        out=export_tfd(q)['content'];self.assertIn('CUSTOM-RECORD*UNCHANGED*',out)
        r=parse_tfd(out,{'materials':BUILTIN_MATERIALS})
        self.assertAlmostEqual(r['layers'][0]['thickness_nm'],q['layers'][0]['thickness_nm'],places=12)
