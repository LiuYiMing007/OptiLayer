"""Read-only legacy inventory; optional conversion into a NEW private Workspace.

Never put original experiment files or the resulting Workspace in Git/Release.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import sys
import uuid
import zipfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
from importers.tfd import decode_tfd, inspect_tfd
from models import BUILTIN_MATERIALS
from application import calculate
from repository import storage_action
from workspace import Workspace


def audit(source, output, compute=False, convert=False):
    source=Path(source).resolve();output=Path(output).resolve()
    if not source.is_dir() or output.is_relative_to(source):raise ValueError('输出目录必须在源目录之外')
    output.mkdir(parents=True,exist_ok=False)
    paths=sorted(p for p in source.rglob('*') if p.is_file() and not p.is_symlink())
    before={p.relative_to(source).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    files=[p for p in paths if p.suffix.lower()=='.tfd']
    workspace=Workspace(output/'Workspace',create=True) if convert else None
    template={'materials':BUILTIN_MATERIALS}
    entries=[];counts={'files':len(paths),'tfd':len(files),'decoded_legacy':0,'imported':0,'blocked':0,'computed':0,'calculation_blocked':0,'saved_reloaded_exact':0};issues={}
    for index,p in enumerate(files):
        entry={'file':p.relative_to(source).as_posix(),'sha256':before[p.relative_to(source).as_posix()]}
        try:
            decoded=decode_tfd(p.read_bytes());entry['encoding']=decoded['encoding']
            counts['decoded_legacy']+=decoded['encoding']=='gb18030'
            report=inspect_tfd(decoded['content'],template,p.name,decoded['encoding'])
            entry['issues']=report['issues'];entry['materials']=report['materials']
            if report['issues']:
                counts['blocked']+=1
                for code in {i['code'] for i in report['issues']}:issues[code]=issues.get(code,0)+1
                entry['status']='blocked'
            else:
                counts['imported']+=1;project=report['project'];entry.update(status='imported',layers=len(project['layers']))
                project['id']=str(uuid.uuid5(uuid.NAMESPACE_URL,entry['file']+entry['sha256']))
                entry['project_id']=project['id']
                project['name']=str(p.relative_to(source).with_suffix(''))[:200]
                spectrum=None
                if compute or convert:
                    try:
                        spectrum=calculate(project);counts['computed']+=1;entry['status']='computed'
                    except (ValueError,FloatingPointError) as error:
                        counts['calculation_blocked']+=1;entry['calculation_error']=str(error)
                if workspace:
                    storage_action(workspace,{'action':'save','project':project})
                    loaded=storage_action(workspace,{'action':'load','id':project['id']})['project']
                    assert loaded==project,'Saved project changed'
                    if spectrum:
                        assert calculate(loaded)==spectrum,'Reload recalculation changed'
                        storage_action(workspace,{'action':'spectrum_save','project_id':project['id'],'project':project,'spectrum':spectrum})
                        counts['saved_reloaded_exact']+=1
        except (ValueError,UnicodeError) as error:
            counts['blocked']+=1;entry.update(status='blocked',issues=[{'code':'decode_or_structure','message':str(error)}]);issues['decode_or_structure']=issues.get('decode_or_structure',0)+1
        entries.append(entry)
        if (index+1)%100==0:print(json.dumps({'checked':index+1,'total':len(files)}),flush=True)
    assert all(hashlib.sha256((source/p).read_bytes()).hexdigest()==h for p,h in before.items()),'Original files changed'
    summary={**counts,'issue_counts_nonexclusive':issues,'original_hashes_unchanged':True,'limits':'Structural import and internal save/recalculation checks, not original TFCalc curve equivalence. Finite bulk and front/back coatings are retained; no default-material substitution. Unsupported materials, response data and special definitions stay blocked.'}
    if convert:
        archive=workspace.directory('imports')/'TFCalc-originals.zip'
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
            for name,digest in before.items():
                data=(source/name).read_bytes();assert hashlib.sha256(data).hexdigest()==digest,'Source changed during archive'
                z.writestr(name,data)
        with zipfile.ZipFile(archive) as z:
            assert all(hashlib.sha256(z.read(name)).hexdigest()==digest for name,digest in before.items())
        (workspace.directory('imports')/'TFCalc-originals.sha256.json').write_text(json.dumps(before,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        summary['archived_original_files']=len(before)
        (output/'tfc-project.json').write_text(json.dumps({'format':'tfc-portable-project','schema_version':1,'default_workspace':'Workspace'},indent=2)+'\n',encoding='utf-8')
        (output/'README.txt').write_text('这是独立迁入工作区；原始文件未改变。通过应用的数据位置选择此文件夹或 Workspace。\n逐文件检查清单列出未导入原因；不支持的背面/有限厚基底未被删除或近似计算。\n',encoding='utf-8')
    (output/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (output/'source-hashes.json').write_text(json.dumps(before,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (output/'details.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    with (output/'逐文件检查清单.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.writer(stream);writer.writerow(['文件','状态','膜层数','编码','原因'])
        for e in entries:writer.writerow([e['file'],e['status'],e.get('layers',''),e.get('encoding',''),'；'.join(i['message'] for i in e.get('issues',[])) or e.get('calculation_error','')])
    print(json.dumps(summary,ensure_ascii=False),flush=True)
    return summary

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',required=True,type=Path);p.add_argument('--output',required=True,type=Path);p.add_argument('--calculate',action='store_true');p.add_argument('--convert',action='store_true')
    a=p.parse_args();audit(a.source,a.output,a.calculate,a.convert)
