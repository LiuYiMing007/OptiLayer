"""Verify strict Chinese decoding and single-side import in the frozen engine."""
from pathlib import Path
import json,platform,subprocess,tempfile,shutil
root=Path(__file__).resolve().parents[1]
exe=root/('release/TFC.app/Contents/Resources/engine/tfc-engine' if platform.system()=='Darwin' else 'release/Windows/TFC/engine/tfc-engine.exe')
source='''VERSION*1*\nCONFIG*0*4*0*0*0*Y*Y*N*\nENVIRON*400*700*1*550*15*AIR*K9*\nENVIRON3*1*K9*WHITE*IDEAL*1*N*0*N*\nGROUPS*1*\nGROUP*1*1.25*N*N*0*0*\nLAYERS*1*\nLAYER*1*SIO2*0.5*100*0*1*Y*N*0*N*N*Y*\nLAYERS2*0*\nVARMATS*0*\nMIXMATS*0*\nTRDATA6*0*T*A*400*700*10*15*\nCOMMENTS*光谱基底*\nEOF*'''
with tempfile.TemporaryDirectory(prefix='tfc-tfd-') as folder:
 workspace=Path(folder)/'旧膜系迁入'
 def call(body,create=False):
  process=subprocess.run([str(exe),'--workspace',str(workspace)]+(['--create-workspace'] if create else []),input=json.dumps(body,ensure_ascii=False),encoding='utf-8',capture_output=True,check=True,timeout=45)
  return json.loads(process.stdout)
 decoded=call({'action':'decode_tfd','bytes':list(source.encode('gb18030'))});assert decoded['content']==source and decoded['encoding']=='gb18030',decoded
 p=call({'action':'import_tfd','text':decoded['content'],'encoding':decoded['encoding'],'name':'中文验证.tfd','template':{'materials':[]}})['project']
 assert p['layers'][0]['thickness_nm']==125 and p['layers'][0]['material']=='TFC/MATERIAL/SIO2'
 assert p['settings']['substrate_material']=='TFC/SUBSTRAT/K9'
 result=call({'action':'calculate','project':p});assert len(result['wavelength_nm'])==301
 for text in [source.replace('ENVIRON3*1*K9','ENVIRON3*1*AIR'),source.replace('LAYERS2*0','LAYERS2*1'),source.replace('LAYER*1*SIO2','LAYER*1*UNKNOWN')]:
  assert 'error' in call({'action':'import_tfd','text':text,'template':{'materials':[]}})
 call({'action':'workspace_info'},True);call({'action':'save','project':p})
 target=Path(folder)/'搬迁后';shutil.move(workspace,target);workspace=target
 restored=call({'action':'load','id':p['id']})['project'];assert restored==p and call({'action':'calculate','project':restored})==result
report={'all_pass':True,'platform':platform.system(),'strict_gb18030':True,'role_specific_materials':True,'group_factors_normalized':True,'bulk_backside_missing_material_blocked':True,'save_move_reload_exact':True}
checks=root/'release/checks';checks.mkdir(exist_ok=True,parents=True);(checks/'tfd-import.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report))
