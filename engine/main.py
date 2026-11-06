"""JSON process adapter. Business logic is in application; IO in repository/workspace."""
import argparse
import json
import os
import sys
# Stable imports retained for existing numerical fixtures and validation scripts.
from application import calculate, dispatch
from models import validate
from optics import calculate_rt
from importers.tfd import parse_tfd
from repository import connect_db


def cli():
    # Rust and browser hosts exchange UTF-8 bytes on every platform.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser=argparse.ArgumentParser()
    parser.add_argument('--serve-calculation',action='store_true',help='Stateless newline-delimited calculation service; no storage actions')
    parser.add_argument('--workspace',help='Workspace root (UTF-8 manifest and relative references)')
    parser.add_argument('--create-workspace',action='store_true')
    args=parser.parse_args()
    if args.workspace:os.environ['TFC_WORKSPACE_ROOT']=args.workspace
    if args.create_workspace:os.environ['TFC_CREATE_WORKSPACE']='1'
    if args.serve_calculation:
        for line in sys.stdin:
            try:
                request=json.loads(line)
                if request.get('action') != 'calculate':raise ValueError('常驻计算服务仅接受光谱计算，不允许访问工作区')
                result=calculate(request['project'])
                print(json.dumps(result,ensure_ascii=False,allow_nan=False),flush=True)
            except Exception as error:
                print(json.dumps({'error':str(error)},ensure_ascii=False),flush=True)
        return
    try:
        result=dispatch(json.load(sys.stdin))
        print(json.dumps(result,ensure_ascii=False,allow_nan=False))
    except Exception as error:
        print(json.dumps({'error':str(error)},ensure_ascii=False))

if __name__=='__main__':cli()
