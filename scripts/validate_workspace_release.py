"""Exercise the packaged engine, with no system Python used by the subprocess."""
from pathlib import Path
import hashlib
import json
import os
import platform
import shutil
import sqlite3
import subprocess
import tempfile
root=Path(__file__).resolve().parents[1]
exe=(root/'release/TFC.app/Contents/Resources/engine/tfc-engine' if platform.system()=='Darwin'
     else root/'release/Windows/TFC/engine/tfc-engine.exe')
project=json.loads((root/'docs/user-380nm-recovery.tfc.json').read_text(encoding='utf-8'))
with tempfile.TemporaryDirectory(prefix='tfc-portable-') as temporary:
    base=Path(temporary);workspace=base/'中文原工作区'
    def call(request,create=False):
        args=[str(exe),'--workspace',str(workspace)]
        if create:args+=['--create-workspace']
        result=subprocess.run(args,input=json.dumps(request),text=True,encoding="utf-8",capture_output=True,check=True)
        value=json.loads(result.stdout)
        assert 'error' not in value,value
        return value
    info=call({'action':'workspace_info'},True)
    call({'action':'library_save','materials':project['materials']})
    call({'action':'save','project':project})
    result=call({'action':'calculate','project':project})
    artifact=call({'action':'spectrum_save','project_id':project['id'],'project':project,'spectrum':result})
    destination=base/'模拟移动SSD'/'工作区';destination.parent.mkdir()
    shutil.move(workspace,destination);workspace=destination
    reopened=call({'action':'workspace_info'})
    assert info['workspace']['id']==reopened['workspace']['id']
    loaded=call({'action':'load','id':project['id']})['project']
    assert call({'action':'calculate','project':loaded})==result
    assert json.loads((workspace/artifact['relative_path']).read_text(encoding='utf-8'))['result']==result
    report={'packaged_engine':str(exe.relative_to(root)),'workspace_relocation':True,'spectrum_exact_reproduction':True,'samples':len(result['wavelength_nm'])}
print(json.dumps(report,ensure_ascii=False,indent=2))
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
(root/f'docs/v{version}-{platform.system().lower()}-workspace-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
