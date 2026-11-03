"""Migration keeps experimental originals and never overwrites an existing target."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
spec=importlib.util.spec_from_file_location('audit_tfd',Path(__file__).resolve().parents[1]/'scripts/audit_tfd_directory.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
SOURCE='''VERSION*1*\nCONFIG*0*4*0*0*0*Y*Y*N*\nENVIRON*400*700*1*550*0*AIR*K9*\nENVIRON3*1*K9*WHITE*IDEAL*1*N*0*N*\nGROUPS*1*\nGROUP*1*1.25*N*N*0*0*\nLAYERS*1*\nLAYER*1*SIO2*1*100*0*1*Y*N*0*N*N*Y*\nLAYERS2*0*\n'''

class TFDMigrationTests(unittest.TestCase):
    def test_new_workspace_archives_every_original_and_records_blocked_files(self):
        with tempfile.TemporaryDirectory() as t:
            source=Path(t)/'original';source.mkdir();output=Path(t)/'converted'
            (source/'good.tfd').write_bytes(SOURCE.encode())
            (source/'blocked.tfd').write_bytes(SOURCE.replace('ENVIRON3*1*K9','ENVIRON3*1*AIR').encode())
            (source/'notes.txt').write_bytes(b'original notes')
            before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in source.iterdir()}
            summary=module.audit(source,output,compute=True,convert=True)
            self.assertEqual(summary['imported'],1);self.assertEqual(summary['blocked'],1);self.assertEqual(summary['saved_reloaded_exact'],1)
            self.assertEqual(summary['archived_original_files'],3)
            with zipfile.ZipFile(output/'Workspace/imports/TFCalc-originals.zip') as z:
                self.assertEqual(set(z.namelist()),set(before))
                for name,digest in before.items():self.assertEqual(hashlib.sha256(z.read(name)).hexdigest(),digest)
            self.assertEqual(json.loads((output/'tfc-project.json').read_text())['default_workspace'],'Workspace')
            self.assertEqual(before,{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in source.iterdir()})
            with self.assertRaises(FileExistsError):module.audit(source,output,convert=True)
    def test_output_inside_source_is_rejected_before_writing(self):
        with tempfile.TemporaryDirectory() as t:
            source=Path(t)
            with self.assertRaises(ValueError):module.audit(source,source/'output',convert=True)
            self.assertFalse((source/'output').exists())
