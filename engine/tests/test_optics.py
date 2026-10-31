import copy
import json
import math
from pathlib import Path
import unittest
import numpy as np
from tmm import coh_tmm
from test_engine import fixture,engine,ROOT


def independent(project,wavelength,pol):
    p=engine.validate(project)
    ns={m['name']:m['n'] for m in p['materials']}
    layers=list(reversed(p['layers']))
    return coh_tmm(pol,[p['settings']['incident_n']]+[ns[l['material']] for l in layers]+[p['settings']['substrate_n']],
                   [np.inf]+[l['thickness_nm'] for l in layers]+[np.inf],math.radians(p['settings']['angle_deg']),wavelength)


class OpticalValidationTests(unittest.TestCase):
    def test_single_quarter_wave_analytic(self):
        p=fixture();p['materials'][0]['n']=2.0
        p['settings'].pop('substrate_material',None);p['settings']['substrate_n']=1.5
        p['layers']=p['layers'][:1];p['layers'][0]['thickness_nm']=68.75
        r=engine.calculate_rt(p,550)
        expected=((1*1.5-2**2)/(1*1.5+2**2))**2*100
        self.assertAlmostEqual(r['R_percent'],expected,places=11)
        self.assertAlmostEqual(r['T_percent'],100-expected,places=11)

    def test_user_380nm_case_against_independent_engine(self):
        p=json.loads((ROOT/'fixtures/user-feedback/380nm-project.json').read_text(encoding='utf-8'))
        r=engine.calculate(p)
        for i,w in enumerate(r['wavelength_nm']):
            reference=independent(p,w,'s')
            self.assertAlmostEqual(r['R_percent'][i],100*reference['R'],places=10)
            self.assertAlmostEqual(r['T_percent'][i],100*reference['T'],places=10)
        self.assertGreater(r['T_percent'][50],99.9)

    def test_random_stacks_angles_and_polarizations(self):
        rng=np.random.default_rng(412)
        for angle in (0,30,56.309932,75):
            for pol in ('s','p','unpolarized'):
                p=fixture();p['settings'].update(angle_deg=angle,polarization=pol)
                for layer in p['layers']:layer['thickness_nm']=float(rng.uniform(1,300))
                r=engine.calculate(p)
                for i in (0,75,150,225,300):
                    ref_s=independent(p,r['wavelength_nm'][i],'s');ref_p=independent(p,r['wavelength_nm'][i],'p')
                    for key in ('R','T'):
                        expected=ref_s[key] if pol=='s' else ref_p[key] if pol=='p' else (ref_s[key]+ref_p[key])/2
                        self.assertAlmostEqual(r[f'{key}_percent'][i],expected*100,places=9)
                self.assertLess(r['max_energy_error'],1e-10)

    def test_brewster_and_total_internal_reflection(self):
        p=fixture();p['layers']=[];p['settings'].pop('substrate_material',None)
        p['settings'].update(substrate_n=1.5,angle_deg=math.degrees(math.atan(1.5)),polarization='p')
        self.assertLess(engine.calculate_rt(p,550)['R_percent'],1e-20)
        p['settings'].pop('incident_material',None);p['settings'].pop('substrate_material',None)
        p['settings'].update(incident_n=1.5,substrate_n=1.0,angle_deg=60)
        r=engine.calculate_rt(p,550)
        self.assertAlmostEqual(r['R_percent'],100,places=10)
        self.assertAlmostEqual(r['T_percent'],0,places=10)

    def test_critical_angle_inside_layer(self):
        p=fixture();p['settings'].pop('incident_material',None)
        p['settings'].update(incident_n=2,angle_deg=30)
        p['materials'][0]['n']=1.0
        p['layers']=p['layers'][:1]
        for pol in ('s','p'):
            p['settings']['polarization']=pol
            r=engine.calculate_rt(p,550)
            reference=independent(p,550,pol)
            # The independent implementation loses precision at a grazing internal angle.
            self.assertLess(abs(r['R_percent']-100*reference['R']),1e-5)
            self.assertLess(r['energy_error'],1e-10)

    def test_every_layer_and_current_input_affect_results(self):
        p=fixture();before=engine.calculate_rt(p,380)['R_percent']
        for i in range(4):
            modified=copy.deepcopy(p);modified['layers'][i]['thickness_nm']+=10
            self.assertNotAlmostEqual(before,engine.calculate_rt(modified,380)['R_percent'],places=5)

    def test_legacy_migration_preserves_custom_boundaries(self):
        p=fixture();p['settings'].pop('incident_material',None);p['settings'].pop('substrate_material',None)
        p['settings'].update(incident_n=1.1,substrate_n=1.73)
        result=engine.validate(p)
        self.assertEqual(result['settings']['incident_n'],1.1)
        self.assertEqual(result['settings']['substrate_n'],1.73)
        self.assertIn(result['settings']['substrate_material'],[m['name'] for m in result['materials']])
