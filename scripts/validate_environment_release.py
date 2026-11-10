"""Exercise finite environments, responses and named files in the frozen runtime."""
from pathlib import Path
import copy
import json
import platform
import shutil
import subprocess
import tempfile
import numpy as np
import tmm

root=Path(__file__).resolve().parents[1]
exe=root/('release/OptiLayer.app/Contents/Resources/engine/tfc-engine' if platform.system()=='Darwin' else 'release/Windows/OptiLayer/engine/tfc-engine.exe')
report={'all_pass':False,'platform':platform.system(),'version':json.loads((root/'package.json').read_text())['version']}
with tempfile.TemporaryDirectory(prefix='tfc-environment-') as folder:
    workspace=Path(folder)/'中文环境工作区'
    def call(body,create=False):
        args=[str(exe),'--workspace',str(workspace)]+(['--create-workspace'] if create else [])
        process=subprocess.run(args,input=json.dumps(body,ensure_ascii=False),encoding='utf-8',capture_output=True,check=True,timeout=60)
        response=json.loads(process.stdout)
        assert 'error' not in response,response
        return response
    source=(root/'fixtures/reference/reference_4layer_550nm.tfd').read_text(encoding='utf-8')
    # Synthetic REF materials are selected explicitly, never borrowed from real catalogue.
    template={'materials':[{'name':name,'n':n,'k':0,'role':'film','model':'constant','color':'#777','source':'synthetic acceptance'} for name,n in [('TA2O5_REF',2.1),('SIO2_REF',1.46)]]}
    p=call({'action':'import_tfd','text':source,'template':template})['project']
    p['name']='环境验收-玻璃透空气';p['layers']=[]
    s=p['settings'];s.update(substrate_model='incoherent',substrate_thickness_mm=1,exit_material='AIR',angle_deg=0,start_nm=400,end_nm=700,step_nm=10)
    result=call({'action':'calculate','project':p})
    n=s['substrate_n'];surface=((1-n)/(1+n))**2
    expected_T=100*(1-surface)/(1+surface)
    assert max(abs(t-expected_T) for t in result['T_percent'])<1e-9
    report['bare_plate_analytic']=True
    by={m['name']:m for m in p['materials']}
    substrate=next(m for m in p['materials'] if m['name']==s['substrate_material']);substrate['k']=.0002
    p['layers']=[{'id':'front','material':'TA2O5_REF','thickness_nm':70}]
    p['back_layers']=[{'id':'rear','material':'SIO2_REF','thickness_nm':90}]
    s.update(angle_deg=45,substrate_thickness_mm=.003)
    errors=[]; reference_rt={}
    for model in ['incoherent','coherent']:
        for side in ['front','back']:
            s.update(substrate_model=model,first_surface=side)
            result=call({'action':'calculate','project':p})
            point=result['wavelength_nm'].index(550)
            reference_rt[model+'-'+side]={field:result[field][point] for field in ('R_percent','T_percent','Rs_percent','Rp_percent','Ts_percent','Tp_percent')}
            ns=[1,2.1,n+.0002j,1.46,1];ds=[np.inf,70,3000,90,np.inf];cs=['i','c','i','c','i']
            if side=='back':ns.reverse();ds.reverse();cs.reverse()
            for i,w in enumerate(result['wavelength_nm']):
                for pol in ['s','p']:
                    expected=tmm.inc_tmm(pol,ns,ds,cs,np.pi/4,w) if model=='incoherent' else tmm.coh_tmm(pol,ns,ds,np.pi/4,w)
                    errors += [abs(result['R'+pol+'_percent'][i]-100*expected['R']),abs(result['T'+pol+'_percent'][i]-100*expected['T'])]
    assert max(errors)<1e-8,max(errors)
    report.update(front_back_coatings=True,oblique_s_p=True,absorbing_finite_substrate=True,coherent_and_incoherent=True,independent_max_error_pp=max(errors),reference_rt=reference_rt)
    p['response_data']={'illuminants':[{'name':'Test lamp','samples':[[400,50],[700,100]]}], 'detectors':[{'name':'Test sensor','samples':[[400,80],[700,40]]}]}
    s.update(illuminant='Test lamp',detector='Test sensor')
    weighted=call({'action':'calculate','project':p})
    assert result['T_percent']==weighted['T_percent'] and abs(weighted['response_weight'][0]-.4)<1e-15
    report['responses_separate_from_physical_rt']=True
    call({'action':'workspace_info'},True)
    saved=call({'action':'save','project':p});p=saved['project'];assert p['schema_version']==2;path=workspace/saved['relative_path']
    assert path.name=='环境验收-玻璃透空气.tfc.json' and json.loads(path.read_text(encoding='utf-8'))==p
    call({'action':'spectrum_save','project_id':p['id'],'project':p,'spectrum':weighted})
    catalogue_index=json.loads((workspace/'materials/catalogue/individual-files-v1.json').read_text(encoding='utf-8'))
    assert len(catalogue_index['files'])==1211
    assert all((workspace/'materials'/m['path']).is_file() for m in catalogue_index['files'])
    report['named_project_and_1211_individual_material_files']=True
    moved=Path(folder)/'移动后'/'Workspace';moved.parent.mkdir();shutil.move(workspace,moved);workspace=moved
    loaded=call({'action':'load','id':p['id']})['project']
    assert loaded==p and call({'action':'calculate','project':loaded})==weighted
    report.update(save_move_reload_exact=True,all_pass=True)
checks=root/'release/checks';checks.mkdir(parents=True,exist_ok=True)
(checks/'environment.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
