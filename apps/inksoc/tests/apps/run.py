# Runs the installers of request.json on the engine (Node), side by side, and leaves for each
# <name>.json (the result) and <name>.png (the last screen) in out/. A .msi runs through
# Windows Installer (msiexec /i). clicks: [seconds, x, y] on the 1024x768 screen.
import json, os, subprocess, sys, urllib.request
here = os.path.dirname(os.path.abspath(__file__))
inksoc = os.path.dirname(os.path.dirname(here))
out = os.path.join(here, 'out'); os.makedirs(out, exist_ok=True)
jobs = []
for r in json.load(open(os.path.join(here, 'request.json'))):
    d = os.path.join('/tmp/apps', r['name']); os.makedirs(d, exist_ok=True)
    f = os.path.join(d, r.get('file') or r['url'].split('/')[-1].split('?')[0])
    if not os.path.exists(f): urllib.request.urlretrieve(r['url'], f)
    exe, args = os.path.basename(f), r.get('args', '')
    if f.lower().endswith('.msi'):
        with open(os.path.join(inksoc, 'bin/wine/wine-msiexec.exe'), 'rb') as a, open(os.path.join(d, 'msiexec.exe'), 'wb') as b: b.write(a.read())
        exe, args = 'msiexec.exe', ('/i "%s" ' % os.path.basename(f) + args).strip()
    clicks = []
    for t, x, y in r.get('clicks', []): clicks += [[t * 1000, 1, x, y, 0], [t * 1000 + 50, 2, x, y, 0], [t * 1000 + 150, 3, x, y, 0]]
    env = dict(os.environ, LIMIT=str(r.get('limit', 600)), INPUT=json.dumps(clicks), SHOT=os.path.join(out, r['name'] + '.ppm'))
    log = open(os.path.join(out, r['name'] + '.log'), 'w')
    jobs.append((r['name'], subprocess.Popen([os.path.join(inksoc, 'compat/app.sh'), d, exe, args], env=env, stdout=log, stderr=subprocess.STDOUT), log))
for name, p, log in jobs:
    p.wait(); log.close()
    text = open(os.path.join(out, name + '.log')).read().strip().splitlines()
    res = text[-1] if text else ''
    try: j = json.loads(res); print('RESULT', name, j['status'], j['error'][:300].replace('\n', ' | '), len(j['files']), 'files')
    except Exception: print('RESULT', name, 'crashed', ' | '.join(text[-5:])[:300])
    ppm = os.path.join(out, name + '.ppm')
    if os.path.exists(ppm): subprocess.run(['convert', ppm, os.path.join(out, name + '.png')]); os.remove(ppm)
