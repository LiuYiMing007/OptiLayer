"""Bundle a directory runtime so calculations do not re-extract SciPy per request."""
import platform
import subprocess
import sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
subprocess.run([sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onedir','--name','tfc-engine','--add-data',str(root/'engine/data')+':data','--distpath',str(root/'engine/dist'),'--workpath',str(root/'engine/build'),'--specpath',str(root/'engine/build'),str(root/'engine/main.py')],check=True,cwd=root)
print(f'Engine runtime ready ({platform.machine()}): {root/"engine/dist/tfc-engine"}')
