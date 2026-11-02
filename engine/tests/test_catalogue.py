import copy
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import numpy as np
import tmm
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from catalogue import catalogue, catalogue_material, catalogue_summaries
from materials import optical_constants
from importers.mat import parse_mat
from models import validate_material
from optics import calculate_spectrum, calculate_rt
from application import dispatch
from workspace import Workspace
from test_engine import fixture


class MaterialCatalogueTests(unittest.TestCase):
    def test_inventory_and_every_ready_snapshot(self):
        c=catalogue();self.assertEqual(c['counts'],{'MATERIAL':372,'SUBSTRAT':417,'SCHOTT':201,'SOPRA':221})
        self.assertEqual(len(c['materials']),1211)
        self.assertEqual(c['status_counts'],{'ready':1186,'quarantined':25})
        self.assertEqual(len({m['name'] for m in c['materials']}),1211)
        for m in c['materials']:
            with self.subTest(name=m['name']):
                self.assertNotIn('/Volumes/',json.dumps(m,ensure_ascii=False))
                self.assertEqual(len(m['provenance']['sha256']),64)
                if m['status']=='ready':validate_material(catalogue_material(m['name']))
                else:
                    with self.assertRaises(ValueError):catalogue_material(m['name'])
        for s in catalogue_summaries():
            self.assertNotIn('raw_records',s);self.assertNotIn('samples',s)
            with self.assertRaises(ValueError):validate_material(s)

    def test_strict_parser_does_not_repair_corruption_or_overwrite_names(self):
        raw=b'VERSION*1*\rFORMAT*1*\rPOINTS*2*\rDATA1*1*400*1.5*0*\rDATA1*2*600*1.6*0*\rEOF*\r'
        a=parse_mat(raw,'MATERIAL/TEST.MAT');b=parse_mat(raw,'SUBSTRAT/TEST.MAT')
        self.assertEqual(a['status'],'ready');self.assertNotEqual(a['name'],b['name'])
        self.assertEqual(a['provenance']['sha256'],hashlib.sha256(raw).hexdigest())
        self.assertEqual(parse_mat(raw.replace(b'POINTS*2',b'POINTS*3'),'MATERIAL/BAD.MAT')['status'],'quarantined')
        self.assertEqual(parse_mat(raw.replace(b'1.6*0*',b'1.6*-0.01*'),'MATERIAL/GAIN.MAT')['status'],'quarantined')
        self.assertEqual(parse_mat(raw.replace(b'1.6*0*',b'1.6xx*0*'),'MATERIAL/CORRUPT.MAT')['status'],'quarantined')
        self.assertTrue(np.allclose(optical_constants(a,np.array([300,500,700]))[0],[1.5,1.55,1.6]))

    def test_known_glass_and_all_formula_types(self):
        bk7=catalogue_material('TFC/SCHOTT/BK7')
        n,k=optical_constants(bk7,np.array([587.6]));self.assertAlmostEqual(n[0],1.5168,places=4);self.assertEqual(k[0],0)
        cauchy=catalogue_material('TFC/SUBSTRAT/12');n,_=optical_constants(cauchy,np.array([550]))
        self.assertAlmostEqual(n[0],1.79175926+.0121758785/.55**2+.0000135464689/.55**4,places=12)
        self.assertEqual(optical_constants(catalogue_material('TFC/SUBSTRAT/0'),np.array([550]))[0][0],1)
        optical_constants(catalogue_material('TFC/MATERIAL/1'),np.array([550]))
        with self.assertRaises(ValueError):optical_constants(cauchy,np.array([900]))
        # Original SF11 UV range includes a pole/non-real region. Keep coefficients,
        # allow its physically valid visible values, and reject invalid wavelengths.
        sf=catalogue_material('TFC/SCHOTT/SF11');self.assertGreater(optical_constants(sf,np.array([550]))[0][0],1)
        with self.assertRaises(ValueError):optical_constants(sf,np.array([245]))

    def test_scattering_vs_independent_tmm(self):
        for pol in ('s','p','unpolarized'):
            for angle in (0,45,75):
                for thickness in (0,20,200,100000):
                    p=fixture();silver=catalogue_material('TFC/SOPRA/AG');glass=catalogue_material('TFC/SCHOTT/BK7')
                    p['materials'] += [silver,glass];p['settings'].update(angle_deg=angle,polarization=pol,substrate_material=glass['name'])
                    p['layers']=[{'id':'silver','material':silver['name'],'thickness_nm':thickness}]
                    for w in (450,550,650):
                        result=calculate_rt(p,w);indices=[1]+[complex(*[v[0] for v in optical_constants(m,np.array([w]))]) for m in (silver,glass)]
                        expected=[tmm.coh_tmm(q,indices,[np.inf,thickness,np.inf],np.deg2rad(angle),w) for q in ('s','p')]
                        for channel in ('R','T'):
                            target=expected[0 if pol=='s' else 1][channel] if pol!='unpolarized' else sum(e[channel] for e in expected)/2
                            self.assertAlmostEqual(result[channel+'_percent'],100*target,places=8)
                        self.assertGreaterEqual(result['A_percent'],-1e-8)

    def test_absorbing_substrate_and_multilayer_reversal(self):
        for pol in ('s','p'):
            p=fixture();metal=catalogue_material('TFC/SOPRA/AG');dielectric=catalogue_material('TFC/SCHOTT/BK7')
            p['materials'] += [metal,dielectric];p['settings'].update(angle_deg=55,polarization=pol,substrate_material=metal['name'])
            p['layers']=[{'id':str(i),'material':m['name'],'thickness_nm':d} for i,(m,d) in enumerate([(dielectric,120),(metal,25),(dielectric,65)])]
            for w in (450,600):
                result=calculate_rt(p,w)
                ordered=[{'name':'AIR','n':1,'k':0,'model':'constant'},dielectric,metal,dielectric,metal]
                indices=[complex(*[v[0] for v in optical_constants(m,np.array([w]))]) for m in ordered]
                expected=tmm.coh_tmm(pol,indices,[np.inf,65,25,120,np.inf],np.deg2rad(55),w)
                for key in ('R','T'):self.assertAlmostEqual(result[key+'_percent'],100*expected[key],places=8)

    def test_self_contained_save_move_exact_recalculate(self):
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'old';ws=Workspace(source,create=True)
            p=fixture();a=catalogue_material('TFC/SOPRA/AG');g=catalogue_material('TFC/SCHOTT/BK7')
            p['materials'] += [a,g];p['settings']['substrate_material']=g['name'];p['layers'][0]['material']=a['name']
            before=dispatch({'action':'calculate','project':p});dispatch({'action':'save','project':p},ws)
            moved=Path(folder)/'new-drive'/'Workspace';shutil.copytree(source,moved);shutil.rmtree(source)
            loaded=dispatch({'action':'load','id':p['id']},Workspace(moved))['project']
            self.assertEqual(before,dispatch({'action':'calculate','project':loaded}))
            self.assertEqual(loaded['materials'][-2]['samples'],a['samples'])

    def test_table_endpoint_warning_and_absorption_semantics(self):
        p=fixture();m=catalogue_material('TFC/SOPRA/AG');p['materials'].append(m);p['layers'][0]['material']=m['name']
        p['settings'].update(start_nm=100,end_nm=200,step_nm=10)
        r=calculate_spectrum(p);self.assertTrue(r['absorbing']);self.assertEqual(r['energy_check'],'passivity_violation')
        self.assertTrue(r['warnings']);self.assertLess(r['max_energy_error'],1e-8)
        self.assertGreater(max(r['A_percent']),0)

if __name__=='__main__':unittest.main()
