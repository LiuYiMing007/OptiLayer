import hashlib, importlib.util, json, tempfile, unittest, zipfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('combined',Path(__file__).resolve().parents[1]/'scripts/package_combined_release.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class CombinedPackageTests(unittest.TestCase):
    def sources(self,root,extra=None):
        for system in ['macOS-arm64','Windows-x64-portable']:
            p=root/f'TFC-0.1.5-{system}.zip'
            entries={'TFC/tfc-project.json':json.dumps({'schema_version':1}),'TFC/使用说明.txt':'portable\r\n' if system.startswith('Windows') else 'portable\n'}
            entries.update({'TFC/macOS/TFC.app/Contents/Info.plist':'mac'} if system.startswith('macOS') else {'TFC/Windows/TFC.exe':'windows','TFC/Windows/engine/tfc-engine.exe':'engine'})
            if extra and system.startswith('Windows'):entries.update(extra)
            with zipfile.ZipFile(p,'w') as z:
                for name,data in entries.items():z.writestr(name,data)
            p.with_suffix('.zip.sha256').write_text(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name)
    def test_merge_preserves_two_programs_one_marker_and_normalized_readme(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);self.sources(root);p=module.combine_assets(root,'0.1.5')
            with zipfile.ZipFile(p) as z:
                self.assertEqual(z.namelist().count('TFC/tfc-project.json'),1)
                self.assertEqual(z.read('TFC/Windows/engine/tfc-engine.exe'),b'engine')
                self.assertEqual(z.read('TFC/macOS/TFC.app/Contents/Info.plist'),b'mac')
            self.assertEqual(p.with_suffix('.zip.sha256').read_text().split()[0],hashlib.sha256(p.read_bytes()).hexdigest())
    def test_rejects_private_workspace_and_path_traversal(self):
        for name in ['TFC/Workspace/private.json','TFC/.tfc/config.json','../outside']:
            with self.subTest(name=name),tempfile.TemporaryDirectory() as d:
                root=Path(d);self.sources(root,{name:'private'})
                with self.assertRaises(ValueError):module.combine_assets(root,'0.1.5')
                self.assertFalse((root/'TFC-0.1.5-macOS-Windows-portable.zip').exists())
    def test_ascii_readme_merges_with_different_platform_newlines(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);self.sources(root)
            for source in root.glob('*.zip'):
                with zipfile.ZipFile(source) as z: entries={n:z.read(n) for n in z.namelist()}
                entries['TFC/README.txt']=entries.pop('TFC/使用说明.txt')
                with zipfile.ZipFile(source,'w') as z:
                    for n,data in entries.items():z.writestr(n,data)
                source.with_suffix('.zip.sha256').write_text(hashlib.sha256(source.read_bytes()).hexdigest()+'  '+source.name)
            with zipfile.ZipFile(module.combine_assets(root,'0.1.5')) as z:
                self.assertEqual(z.namelist().count('TFC/README.txt'),1)
                self.assertNotIn('TFC/使用说明.txt',z.namelist())

    def test_rejects_conflicting_common_file(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);self.sources(root,{'TFC/tfc-project.json':'{"schema_version":2}'})
            with self.assertRaises(ValueError):module.combine_assets(root,'0.1.5')
    def test_rejects_corrupt_source(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);self.sources(root);p=root/'TFC-0.1.5-Windows-x64-portable.zip';p.write_bytes(p.read_bytes()+b'corrupt')
            with self.assertRaises(ValueError):module.combine_assets(root,'0.1.5')
