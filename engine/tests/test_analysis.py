import unittest
import numpy as np
from test_engine import engine
from analysis import analyze_spectrum


def spectrum(x,t):
    return {'wavelength_nm':list(x),'T_percent':list(t),'R_percent':list(100-np.array(t))}


class AnalysisTests(unittest.TestCase):
    def test_linear_edge_and_integrated_band(self):
        s=spectrum([400,420,440,460,480,500],[0,20,40,60,80,100])
        result=analyze_spectrum(s,{'passband':{'start_nm':425,'end_nm':475}})
        self.assertAlmostEqual(result['crossings']['50'][0]['wavelength_nm'],450)
        self.assertAlmostEqual(result['edges'][0]['width_nm'],80)
        self.assertAlmostEqual(result['edges'][0]['slope_percent_per_nm'],1)
        self.assertAlmostEqual(result['passband_T']['mean_percent'],50)

    def test_flat_high_transmission_has_no_cutoff_or_peaks(self):
        r=analyze_spectrum(spectrum([330,380,450],[99.5,99.9,99.6]))
        self.assertEqual(r['crossings']['50'],[])
        self.assertEqual(r['edges'],[])
        self.assertEqual(len(r['T']['peaks']),1)

    def test_plateau_at_threshold_counted_once(self):
        r=analyze_spectrum(spectrum([400,410,420,430,440],[0,50,50,50,100]))
        self.assertEqual(len(r['crossings']['50']),1)
        self.assertEqual(r['crossings']['50'][0]['wavelength_nm'],420)

    def test_multiple_edges_and_out_of_range_band(self):
        s=spectrum([400,420,440,460,480],[0,100,100,100,0])
        r=analyze_spectrum(s,{'stopband':{'start_nm':300,'end_nm':400}})
        self.assertEqual(len(r['edges']),2)
        self.assertEqual(len(r['crossings']['50']),2)
        self.assertIn('error',r['stopband_T'])

    def test_nonmonotonic_branches_not_joined(self):
        r=analyze_spectrum(spectrum([400,410,420,430,440],[0,60,30,95,100]))
        self.assertEqual(r['edges'],[])

    def test_irregular_sampling_integral_and_invalid_spectrum(self):
        r=analyze_spectrum(spectrum([400,401,500],[0,1,100]))
        self.assertAlmostEqual(r['T']['mean_percent'],50)
        with self.assertRaises(ValueError):analyze_spectrum(spectrum([400,400],[0,100]))
