import copy,json,subprocess,sys,unittest
from pathlib import Path
from test_engine import fixture,engine
ROOT=Path(__file__).resolve().parents[2]
class CalculationServiceTests(unittest.TestCase):
    def test_warm_service_is_stateless_equivalent_and_rejects_storage(self):
        p=engine.validate(fixture());p['layers'][0]['group']=2;p['group_factors']={'2':1.25}
        q=copy.deepcopy(p);q['settings']['angle_deg']=35
        requests=[{'action':'calculate','project':p},{'action':'calculate','project':q},{'action':'save','project':p},{'action':'calculate','project':p}]
        proc=subprocess.run([sys.executable,str(ROOT/'engine/main.py'),'--serve-calculation'],input='\n'.join(json.dumps(r) for r in requests)+'\n',text=True,encoding="utf-8",capture_output=True,timeout=30,check=True)
        results=[json.loads(line) for line in proc.stdout.splitlines()]
        self.assertEqual(len(results),4)
        self.assertEqual(results[0],engine.calculate(p));self.assertEqual(results[1],engine.calculate(q));self.assertEqual(results[3],results[0]);self.assertIn('error',results[2])
        for field,value in [('group',1.5),('group',-1),('group',True)]:
            bad=copy.deepcopy(p);bad['layers'][0][field]=value
            with self.assertRaises(ValueError):engine.validate(bad)
        bad=copy.deepcopy(p);bad['group_factors']={'2':-1}
        with self.assertRaises(ValueError):engine.validate(bad)
