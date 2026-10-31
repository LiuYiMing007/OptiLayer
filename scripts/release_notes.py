"""Render a version report with working repository links for GitHub Releases."""
from pathlib import Path
import os
import posixpath
import re
import sys
from urllib.parse import quote
root=Path(__file__).resolve().parents[1]
tag=sys.argv[1]
if not re.fullmatch(r'v\d+\.\d+\.\d+',tag):raise SystemExit('Expected version tag vX.Y.Z')
repository=os.environ.get('GITHUB_REPOSITORY','')
if not re.fullmatch(r'[\w.-]+/[\w.-]+',repository):raise SystemExit('GITHUB_REPOSITORY must be owner/repo')
report=root/'docs/更新报告'/f'{tag[1:]}更新报告.md'
def absolute(match):
    label,link=match.groups()
    if '://' in link or link.startswith('#'):return match.group(0)
    target=posixpath.normpath(posixpath.join('docs/更新报告',link))
    if target.startswith('../'):raise ValueError('Report link escapes repository')
    return f'[{label}](https://github.com/{repository}/blob/{tag}/{quote(target,safe="/")})'
sys.stdout.reconfigure(encoding='utf-8')
print(re.sub(r'\[([^\]]+)\]\(([^)]+)\)',absolute,report.read_text(encoding='utf-8')))
