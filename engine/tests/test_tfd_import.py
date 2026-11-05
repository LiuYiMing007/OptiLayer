"""Synthetic format regressions; no user's experimental TFD is committed."""
import copy
import unittest
from test_engine import fixture,engine
from importers.tfd import inspect_tfd, parse_tfd, decode_tfd
from catalogue import catalogue_material


def text(material='SIO2', substrate='K9', exit_medium='K9', group='1.250000'):
    return f'''VERSION*1*\nCONFIG*0*4*0*0*0*Y*Y*N*\nENVIRON*400*700*1*550*15*AIR*{substrate}*\nENVIRON3*1*{exit_medium}*WHITE*IDEAL*1*N*0*N*\nGROUPS*1*\nGROUP*1*{group}*N*N*0*0*\nLAYERS*1*\nLAYER*1*{material}*0.5*100*0*1*Y*N*0*N*N*Y*\nLAYERS2*0*\nVARMATS*0*\nMIXMATS*0*\nTRDATA6*0*T*A*400*700*10*15*\nEOF*'''


class RealTFDAdapterTests(unittest.TestCase):
    def test_real_materials_and_group_factor_preserve_physical_meaning(self):
        template=fixture();template['analysis_bands']={'passband':{'start_nm':400,'end_nm':500}}
        p=parse_tfd(text(),template,'synthetic.tfd')
        self.assertEqual(p['layers'][0]['thickness_nm'],125)
        self.assertEqual(p['layers'][0]['material'],'TFC/MATERIAL/SIO2')
        self.assertEqual(p['settings']['substrate_material'],'TFC/SUBSTRAT/K9')
        self.assertEqual(p['materials'][0]['samples'],catalogue_material('TFC/MATERIAL/SIO2')['samples'])
        self.assertNotIn('analysis_bands',p)
        self.assertEqual(p['name'],'synthetic')
        self.assertEqual(p['import_info']['source_layers'][0]['physical_nm'],100)

    def test_role_namespaces_select_substrate_bf33_not_same_name_film(self):
        p=parse_tfd(text(substrate='BF33',exit_medium='BF33'),fixture())
        self.assertEqual(p['settings']['substrate_material'],'TFC/SUBSTRAT/BF33')
        self.assertNotEqual(catalogue_material('TFC/SUBSTRAT/BF33')['samples'],catalogue_material('TFC/MATERIAL/BF33')['samples'])

    def test_missing_material_is_not_hidden_by_supported_backside_environment(self):
        original=fixture();before=copy.deepcopy(original)
        source=text(material='100',exit_medium='AIR').replace('LAYERS2*0*','LAYERS2*1*\nLAYER2*1*SIO2*1*100*0*1*')
        r=inspect_tfd(source,original)
        self.assertEqual({i['code'] for i in r['issues']},{'material'})
        self.assertIsNone(r['project']);self.assertEqual(original,before)

    def test_zero_group_and_zero_thickness_are_preserved(self):
        p=parse_tfd(text(group='0'),fixture());self.assertEqual(p['layers'][0]['thickness_nm'],0)
        p=parse_tfd(text().replace('*100*0*1*','*0*0*1*'),fixture());self.assertEqual(p['layers'][0]['thickness_nm'],0)

    def test_strict_chinese_decoding_preserves_names_and_rejects_invalid_bytes(self):
        source=text()+'\nCOMMENTS*镀膜基底*'
        d=decode_tfd(source.encode('gb18030'));self.assertEqual(d['encoding'],'gb18030');self.assertEqual(d['content'],source)
        self.assertEqual(decode_tfd(source.encode('utf-8-sig'))['content'],source)
        with self.assertRaises(ValueError):decode_tfd(b'\xff')
        with self.assertRaises(ValueError):decode_tfd(b'VERSION\x00')

    def test_invalid_groups_unknown_units_and_special_materials_not_silently_ignored(self):
        for source in [text().replace('GROUPS*1','GROUPS*2'),text().replace('CONFIG*0','CONFIG*1'),text().replace('MIXMATS*0','MIXMATS*1'),text().replace('GROUP*1*1.250000','GROUP*1*-1')]:
            with self.assertRaises(ValueError):parse_tfd(source,fixture())

    def test_polarization_and_template_independence(self):
        p=parse_tfd(text().replace('TRDATA6*0*T*A*','TRDATA6*0*T*P*'),fixture())
        self.assertEqual(p['settings']['polarization'],'p')
        result=engine.calculate(p);self.assertEqual(len(result['wavelength_nm']),301)
        with self.assertRaises(ValueError):parse_tfd(text().replace('TRDATA6*0*T*A*','TRDATA6*0*T*D*'),fixture())

    def test_decoding_action_validates_byte_payload_without_workspace(self):
        self.assertEqual(engine.dispatch({'action':'decode_tfd','bytes':list(text().encode())})['content'],text())
        for payload in [[True],[-1],[256],['3']]:
            with self.assertRaises(ValueError):engine.dispatch({'action':'decode_tfd','bytes':payload})

    def test_finite_exit_and_back_layers_preserve_environment(self):
        source=text(exit_medium='AIR').replace('LAYERS2*0*','LAYERS2*1*\nLAYER2*1*SIO2*1*80*0*1*')
        p=parse_tfd(source,fixture())
        self.assertEqual(p['settings']['substrate_model'],'incoherent')
        self.assertEqual(p['settings']['exit_material'],'TFC/SUBSTRAT/AIR')
        self.assertEqual(p['settings']['substrate_thickness_mm'],1)
        self.assertEqual(p['back_layers'][0]['thickness_nm'],100)
        self.assertTrue(all(x['side'] in ('front','back') for x in p['import_info']['source_layers']))
        self.assertIn('多次反射',engine.calculate(p)['model'])
        backwards=parse_tfd(source.replace('*WHITE*IDEAL*1*','*WHITE*IDEAL*2*'),fixture())
        self.assertEqual(backwards['settings']['first_surface'],'back')
        self.assertIn('背面照射',engine.calculate(backwards)['model'])
        with self.assertRaises(ValueError):parse_tfd(source.replace('*WHITE*IDEAL*1*','*D65*IDEAL*1*'),fixture())
