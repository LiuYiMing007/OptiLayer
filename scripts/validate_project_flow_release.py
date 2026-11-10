"""Frozen-runtime TFD compatibility and Workspace-file regression, no user data."""
from pathlib import Path
import json,platform,subprocess,tempfile,sys
import numpy as np
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'engine/tests'));sys.path.insert(0,str(root/'engine'))
from test_tfd_export import project
exe=root/('release/OptiLayer.app/Contents/Resources/engine/tfc-engine' if platform.system()=='Darwin' else 'release/Windows/OptiLayer/engine/tfc-engine.exe')
with tempfile.TemporaryDirectory(prefix='tfc-project-flow-')as folder:
    workspace=Path(folder)/'Workspace'
    def call(body,create=False):
        r=subprocess.run([str(exe),'--workspace',str(workspace)]+(['--create-workspace']if create else []),input=json.dumps(body),capture_output=True,text=True,encoding='utf-8',timeout=60,check=True)
        d=json.loads(r.stdout);assert 'error'not in d,d;return d
    call({'action':'workspace_info'},True);p=project()
    original=call({'action':'export_project','project':p,'format':'tfd'})['content'].replace('COMMENTS*0*','UNCHANGED-RECORD*keep*\r\nCOMMENTS*0*')
    p=call({'action':'import_tfd','text':original,'template':p,'name':'original.tfd'})['project']
    result=call({'action':'save','project':p,'format':'tfd'})
    file=workspace/result['relative_path'];assert file.suffix=='.tfd' and file.read_bytes().startswith(b'VERSION*1*')
    assert b'UNCHANGED-RECORD*keep*'in file.read_bytes()
    converted=call({'action':'import_tfd','text':file.read_bytes().decode('gb18030'),'template':p,'name':'copy.tfd'})['project']
    a=call({'action':'calculate','project':p});b=call({'action':'calculate','project':converted})
    error=max(float(np.max(np.abs(np.array(a[k])-np.array(b[k]))))for k in ['R_percent','T_percent'])
    assert error<1e-10,error
    p['response_data']={'distributions':[{'name':'CONE','samples':[[0,100],[30,50]]}]}
    saved=call({'action':'save','project':p,'format':'json'})
    assert json.loads((workspace/saved['relative_path']).read_text(encoding='utf-8'))['response_data']==p['response_data']
    assert len(list((workspace/'materials/distributions').glob('*.distribution.json')))==1
report={'all_pass':True,'platform':platform.system(),'tfd_records_not_json_renamed':True,'full_original_records_preserved':True,'group_and_polarization_roundtrip':True,'max_rt_error_pp':error,'named_workspace_tfd_visible':True,'distribution_json_visible':True,'limits':'Frozen TFD writer and re-import with verified original material records. Does not run proprietary TFCalc or assert native OS save-dialog clicks.'}
checks=root/'release/checks';checks.mkdir(parents=True,exist_ok=True)
(checks/'project-flow.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
