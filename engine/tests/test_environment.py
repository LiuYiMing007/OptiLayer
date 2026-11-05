import copy
import unittest
import numpy as np
import tmm
from test_engine import fixture, engine
from models import validate
from materials import optical_constants
from finite_substrate import coherent_rt


def finite_project():
    p = validate(fixture()); p['layers'] = []
    p['materials'].append({'name':'BULK','n':1.5,'k':0,'role':'substrate','model':'constant','color':'#777777','source':'analytic test'})
    p['settings'].update(substrate_material='BULK',substrate_n=1.5,substrate_model='incoherent',substrate_thickness_mm=1,exit_material='AIR',first_surface='front',illuminant='WHITE',detector='IDEAL')
    p['settings']['start_nm']=400; p['settings']['end_nm']=700; p['settings']['step_nm']=10
    return p


def independent(p, wavelength, pol):
    s=p['settings']; by={m['name']:m for m in p['materials']}
    def n(name):
        real,k=optical_constants(by[name],np.array([wavelength]))
        return complex(real[0],k[0])
    front=list(reversed(p['layers']));back=p.get('back_layers',[])
    names=[s['incident_material']]+[l['material'] for l in front]+[s['substrate_material']]+[l['material'] for l in back]+[s['exit_material']]
    ds=[np.inf]+[l['thickness_nm'] for l in front]+[s['substrate_thickness_mm']*1e6]+[l['thickness_nm'] for l in back]+[np.inf]
    cs=['i']+['c']*len(front)+['i']+['c']*len(back)+['i']
    if s.get('first_surface')=='back': names.reverse(); ds.reverse(); cs.reverse()
    ns=[n(name) for name in names]
    if s['substrate_model']=='coherent':return tmm.coh_tmm(pol,ns,ds,np.deg2rad(s['angle_deg']),wavelength)
    return tmm.inc_tmm(pol,ns,ds,cs,np.deg2rad(s['angle_deg']),wavelength)


class EnvironmentTests(unittest.TestCase):
    def test_bare_glass_plate_and_single_interface_are_distinct(self):
        p=finite_project();result=engine.calculate(p)
        np.testing.assert_allclose(result['T_percent'],100*12/13,atol=1e-11)
        np.testing.assert_allclose(result['R_percent'],100/13,atol=1e-11)
        p['settings'].update(substrate_model='semi_infinite',exit_material='BULK')
        result=engine.calculate(p);np.testing.assert_allclose(result['T_percent'],96,atol=1e-11)

    def test_front_back_absorbing_coatings_and_bulk_match_independent_tmm(self):
        for model in ['incoherent','coherent']:
            for angle in [0,45,70]:
                for side in ['front','back']:
                    p=finite_project();p['settings'].update(substrate_model=model,substrate_thickness_mm=.003,angle_deg=angle,first_surface=side)
                    p['materials'][-1]['k']=.0002
                    p['materials'].append({'name':'ABS','n':2.1,'k':.15,'role':'film','model':'constant','color':'#777','source':'test'})
                    p['layers']=[{'id':'front','material':'ABS','thickness_nm':70}]
                    p['back_layers']=[{'id':'back1','material':'SIO2_REF','thickness_nm':85},{'id':'back2','material':'TA2O5_REF','thickness_nm':50}]
                    r=engine.calculate(p)
                    for i,w in enumerate(r['wavelength_nm']):
                        for pol in ['s','p']:
                            expected=independent(p,w,pol)
                            self.assertAlmostEqual(r['R'+pol+'_percent'][i],100*expected['R'],places=9)
                            self.assertAlmostEqual(r['T'+pol+'_percent'][i],100*expected['T'],places=9)
                    self.assertLess(r['max_energy_error'],1e-10)
                    ref=engine.calculate_rt(p,p['settings']['reference_nm'])
                    expected=independent(p,p['settings']['reference_nm'],'s');expected_p=independent(p,p['settings']['reference_nm'],'p')
                    self.assertAlmostEqual(ref['T_percent'],50*(expected['T']+expected_p['T']),places=9)

    def test_lossless_total_internal_reflection_and_critical_layer(self):
        p=finite_project();p['settings'].update(incident_material='BULK',incident_n=1.5,substrate_material='AIR',substrate_n=1,exit_material='BULK',angle_deg=60)
        r=engine.calculate(p);np.testing.assert_allclose(r['R_percent'],100,atol=1e-10);np.testing.assert_allclose(r['T_percent'],0,atol=1e-10)
        w=np.array([550.]);beta=np.array([1.+0j]);ns=[np.array([1.5+0j]),np.array([1.+0j]),np.array([1.8+0j])]
        for pol in ['s','p']:
            a,b=coherent_rt(ns,[100],beta,w,pol)
            self.assertTrue(np.isfinite(a).all() and np.isfinite(b).all());self.assertAlmostEqual(float(a[0]+b[0]),1,places=12)

    def test_opaque_bulk_has_no_artificial_transmission_floor(self):
        p=finite_project();p['materials'][-1]['k']=1
        r=engine.calculate(p);self.assertTrue(all(t==0 for t in r['T_percent']));self.assertGreater(min(r['A_percent']),0)

    def test_environment_validation_never_discards_unsupported_settings(self):
        for change in [dict(substrate_model='unknown'),dict(substrate_thickness_mm=0),dict(exit_material='MISSING'),dict(first_surface='wrong'),dict(illuminant='D65')]:
            p=finite_project();p['settings'].update(change)
            with self.assertRaises(ValueError):engine.calculate(p)
        p=finite_project();p['settings']['substrate_model']='semi_infinite'
        with self.assertRaises(ValueError):engine.calculate(p)
        p=finite_project();p['settings'].update(first_surface='back',exit_material='BULK');p['materials'][-1]['k']=.01
        with self.assertRaisesRegex(ValueError,'入射介质必须无吸收'):engine.calculate(p)

    def test_spectral_response_is_separate_from_physical_coefficients(self):
        p=finite_project();original=engine.calculate(p)
        p['response_data']={'illuminants':[{'name':'Lamp','samples':[[400,50],[700,100]]}], 'detectors':[{'name':'Sensor','samples':[[400,80],[700,40]]}]}
        p['settings'].update(illuminant='Lamp',detector='Sensor')
        r=engine.calculate(p)
        self.assertEqual(r['R_percent'],original['R_percent']);self.assertEqual(r['A_percent'],original['A_percent'])
        self.assertAlmostEqual(r['response_weight'][0],.4);self.assertAlmostEqual(r['response_weight'][-1],.4)
        self.assertAlmostEqual(r['weighted_T_percent'][0],original['T_percent'][0]*.4)
        p['response_data']['detectors'][0]['samples'][0][1]=101
        with self.assertRaises(ValueError):engine.calculate(p)

    def test_new_physics_uses_v2_without_changing_legacy_v1_documents(self):
        self.assertEqual(validate(fixture())['schema_version'],1)
        p=finite_project();self.assertEqual(validate(p)['schema_version'],2)
        p['schema_version']=3
        with self.assertRaises(ValueError):validate(p)
