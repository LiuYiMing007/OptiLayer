"""Build a deterministic normalized catalogue; never modify installed TFCalc data."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
from importers.mat import parse_mat


def build(source, output):
    items=[]; hashes={}
    for directory in ('MATERIAL','SUBSTRAT','SCHOTT','SOPRA'):
        files=sorted((source/directory).iterdir(),key=lambda p:p.name)
        for path in files:
            if path.name.startswith('._') or path.suffix.lower() != '.mat':continue
            m=parse_mat(path.read_bytes(),path.relative_to(source).as_posix())
            signature={k:m.get(k) for k in ('model','samples','formula','range_nm')}
            digest=hashlib.sha256(json.dumps(signature,sort_keys=True,separators=(',',':')).encode()).hexdigest()
            m['optical_sha256']=digest
            if m['status']=='ready':
                if digest in hashes:m['duplicate_of']=hashes[digest]
                else:hashes[digest]=m['name']
            items.append(m)
    result={'schema_version':1,'catalogue_version':'0.2.0','source':'User-supplied TFCalc library',
            'counts':dict(Counter(m['collection'] for m in items)), 'status_counts':dict(Counter(m['status'] for m in items)),
            'unique_ready_datasets':len(hashes),'materials':items}
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k!='materials'},ensure_ascii=False,indent=2))
    for m in items:
        if m['status']!='ready':print(m['name'],m['issues'])

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('--output',type=Path,default=Path('engine/data/tfcalc-catalogue.json'))
    args=p.parse_args();build(args.source,args.output)
