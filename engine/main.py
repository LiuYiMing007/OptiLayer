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
    parser=argparse.ArgumentParser()
    parser.add_argument('--workspace',help='Workspace root (UTF-8 manifest and relative references)')
    parser.add_argument('--create-workspace',action='store_true')
    args=parser.parse_args()
    if args.workspace:os.environ['TFC_WORKSPACE_ROOT']=args.workspace
    if args.create_workspace:os.environ['TFC_CREATE_WORKSPACE']='1'
    try:
        result=dispatch(json.load(sys.stdin))
        print(json.dumps(result,ensure_ascii=False,allow_nan=False))
    except Exception as error:
        print(json.dumps({'error':str(error)},ensure_ascii=False))

if __name__=='__main__':cli()
