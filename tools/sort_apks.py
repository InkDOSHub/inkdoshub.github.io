#!/usr/bin/env python3
"""Move each downloaded .apk into the repository (main/community) whose official APKINDEX lists it."""
import io, sys, tarfile
from pathlib import Path

out, arch, tmp = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
owner = {}
for repo in ('main', 'community'):
    with tarfile.open(out / repo / arch / 'APKINDEX.tar.gz') as tar:
        text = tar.extractfile('APKINDEX').read().decode()
    for block in text.split('\n\n'):
        fields = dict(line.split(':', 1) for line in block.splitlines() if ':' in line)
        if 'P' in fields and 'V' in fields:
            owner[f"{fields['P']}-{fields['V']}.apk"] = repo
missing = []
count = 0
for apk in sorted(tmp.glob('*.apk')):
    repo = owner.get(apk.name)
    if not repo:
        missing.append(apk.name)
        continue
    apk.rename(out / repo / arch / apk.name)
    count += 1
print(f'{count} pacotes copiados')
if missing:
    print('Fora dos índices (ignorados):', ', '.join(missing))
names = sorted({line.strip() for line in Path('alpine-packages.txt').read_text().splitlines() if line.strip() and not line.startswith('#')})
(out / 'pacotes.txt').write_text('\n'.join(names) + '\n')
