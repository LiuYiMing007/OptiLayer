"""Test catalogue resources inside the frozen runtime on the actual build OS."""
import hashlib
import json
import platform
from pathlib import Path
import shutil
import subprocess
import tempfile
root=Path(__file__).resolve().parents[1]
exe=root/('release/TFC.app/Contents/Resources/engine/tfc-engine' if platform.system()=='Darwin' else 'release/Windows/TFC/engine/tfc-engine.exe')
with tempfile.TemporaryDirectory(prefix='tfc-catalogue-') as folder:
    workspace=Path(folder)/'中文工作区'
    def call(body,create=False):
        args=[str(exe),'--workspace',str(workspace)]+(['--create-workspace'] if create else [])
        result=subprocess.run(args,input=json.dumps(body,ensure_ascii=False),encoding='utf-8',capture_output=True,timeout=45,check=True)
        data=json.loads(result.stdout)
        assert 'error' not in data,data
        return data
    call({'action':'workspace_info'},True)
    materials=call({'action':'library_list'})['materials']
    imported=[m for m in materials if m.get('collection')]
    assert len(imported)==1211
    assert sum(m['status']=='ready' for m in imported)==1186
    assert sum(m['status']=='quarantined' for m in imported)==25
    silver=call({'action':'catalogue_get','name':'TFC/SOPRA/AG'})['material']
    glass=call({'action':'catalogue_get','name':'TFC/SCHOTT/BK7'})['material']
    project=json.loads((root/'docs/user-380nm-recovery.tfc.json').read_text(encoding='utf-8'))
    project['materials'] += [silver,glass]; project['settings'].update(substrate_material=glass['name'],start_nm=450,end_nm=650,step_nm=1)
    project['layers'][0]['material']=silver['name']
    edited=json.loads(json.dumps(silver));edited['name']='USER/ci-silver';edited['display_name']='CI 编辑银';edited['samples'][5][2]+=.01
    edited=call({'action':'material_validate','material':edited})['material']
    call({'action':'library_save','materials':[edited]})
    files=list((workspace/'materials/films').glob('*.material.json'))
    assert len(files)==1 and json.loads(files[0].read_text(encoding='utf-8'))==edited
    assert (workspace/'materials/catalogue/TFCalc-0.2.0.original.json').exists()
    # Frozen executable must persist both material and substrate CRUD on this OS.
    for role in ('film','substrate'):
        item=dict(name='USER/crud-'+role,display_name='新增材料' if role=='film' else '新增基底',n=1.73,k=0,role=role,model='constant',color='#6488a6',source='CI CRUD')
        call({'action':'library_save','materials':[item]})
        category='substrates' if role=='substrate' else 'films'
        path=workspace/'materials'/category/(item['display_name']+'.material.json')
        assert json.loads(path.read_text(encoding='utf-8'))==item
        assert any(m['name']==item['name'] for m in call({'action':'library_list'})['materials'])
        call({'action':'library_delete','name':item['name'],'expected':item})
        assert not path.exists()
        assert all(m['name']!=item['name'] for m in call({'action':'library_list'})['materials'])
        call({'action':'library_restore','name':item['name']})
        assert json.loads(path.read_text(encoding='utf-8'))==item
    call({'action':'library_delete','name':silver['name'],'expected':silver})
    assert all(m['name']!=silver['name'] for m in call({'action':'library_list'})['materials'])
    call({'action':'library_restore','name':silver['name']})
    assert any(m['name']==silver['name'] for m in call({'action':'library_list'})['materials'])
    project['materials'].append(edited);project['layers'][0]['material']=edited['name']

    call({'action':'save','project':project})
    spectrum=call({'action':'calculate','project':project})
    assert spectrum['absorbing'] and min(spectrum['A_percent']) > -1e-8
    assert spectrum['max_energy_error']<1e-8
    call({'action':'spectrum_save','project_id':project['id'],'project':project,'spectrum':spectrum})
    new=Path(folder)/'新盘符'/'Workspace';new.parent.mkdir();shutil.move(workspace,new);workspace=new
    loaded=call({'action':'load','id':project['id']})['project']
    assert spectrum==call({'action':'calculate','project':loaded})
    report={'all_pass':True,'platform':platform.system(),'catalogue_total':1211,'ready':1186,'quarantined':25,
            'catalogue_digest':hashlib.sha256((root/'engine/data/tfcalc-catalogue.json').read_bytes()).hexdigest(),
            'packaged_data_loaded':True,'metal_absorption_and_glass_dispersion':True,'move_save_exact_recalculation':True,'material_edit_and_custom_file':True,'visible_original_catalogue_export':True,'material_substrate_create_delete_restore':True,'catalogue_delete_restore':True,'demo_shared_records_absent':not any(m['name'] in ('AIR','TA2O5_REF','SIO2_REF','GLASS_REF') for m in materials)}
checks=root/'release/checks';checks.mkdir(parents=True,exist_ok=True)
(checks/'catalogue.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
