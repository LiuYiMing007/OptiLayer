"""Merge verified native packages into one portable project; never include Workspace."""
from pathlib import Path, PurePosixPath
import argparse, hashlib, json, re, zipfile

def combine_assets(assets, version):
    assets=Path(assets)
    if not re.fullmatch(r'\d+\.\d+\.\d+',version):raise ValueError('Invalid release version')
    sources=[assets/f'TFC-{version}-macOS-arm64.zip', assets/f'TFC-{version}-Windows-x64-portable.zip']
    for source in sources:
        expected=source.with_suffix('.zip.sha256').read_text(encoding='utf-8').split()[0]
        if hashlib.sha256(source.read_bytes()).hexdigest()!=expected:raise ValueError(f'Checksum mismatch: {source.name}')
    target=assets/f'TFC-{version}-macOS-Windows-portable.zip'
    temporary=target.with_suffix('.zip.tmp')
    seen={}
    required={'TFC/tfc-project.json','TFC/macOS/TFC.app/Contents/Info.plist','TFC/Windows/TFC.exe','TFC/Windows/engine/tfc-engine.exe'}
    try:
        with zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_DEFLATED) as output:
            for source in sources:
                with zipfile.ZipFile(source) as original:
                    for member in original.infolist():
                        name=PurePosixPath(member.filename)
                        if name.is_absolute() or '..' in name.parts or '\\' in member.filename or not name.parts or name.parts[0] not in {'TFC','__MACOSX'}:raise ValueError('Unsafe archive path')
                        if any(p.lower() in {'workspace','workspaces','.tfc','.env'} for p in name.parts):raise ValueError('Private workspace/config in archive')
                        data=original.read(member)
                        if member.filename in seen:
                            previous=seen[member.filename]
                            equivalent=previous==data
                            if member.filename=='TFC/tfc-project.json':equivalent=json.loads(previous)==json.loads(data)
                            if member.filename in {'TFC/使用说明.txt','TFC/README.txt'}:equivalent=previous.replace(b'\r\n',b'\n')==data.replace(b'\r\n',b'\n')
                            if not equivalent:raise ValueError(f'Conflicting archive entry: {member.filename}')
                            continue
                        seen[member.filename]=data
                        output.writestr(member,data)
            if not required.issubset(seen):raise ValueError('Missing native program or project marker')
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    target.with_suffix('.zip.sha256').write_text(hashlib.sha256(target.read_bytes()).hexdigest()+'  '+target.name+'\n',encoding='utf-8')
    return target

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--assets',type=Path,required=True);parser.add_argument('--version',required=True)
    args=parser.parse_args();print(combine_assets(args.assets,args.version))
