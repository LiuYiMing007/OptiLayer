"""The native host requires UTF-8 even on a legacy Windows code page."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

class ProcessEncodingTests(unittest.TestCase):
    def test_json_pipe_ignores_system_code_page(self):
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(prefix='中文 pipe ') as folder:
            env = {**os.environ, 'PYTHONIOENCODING':'gbk', 'PYTHONUTF8':'0'}
            p = subprocess.run([sys.executable, str(root/'engine/main.py'),
                '--workspace',folder,'--create-workspace'],
                input=json.dumps({'action':'workspace_info'}).encode('utf-8'),
                capture_output=True,check=True,env=env)
            value=json.loads(p.stdout.decode('utf-8'))
            self.assertNotIn('error',value)
            self.assertIn('workspace',value)
