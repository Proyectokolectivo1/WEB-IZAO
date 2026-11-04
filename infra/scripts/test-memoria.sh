#!/usr/bin/env bash
# Verifica el presupuesto de memoria del Compose (con 2 réplicas de web):
#  - el heap de Node (--max-old-space-size) debe ser <= 80 % del límite del contenedor
#  - Redis: maxmemory <= 75 % del límite (hay AOF, fork y fragmentación)
#  - suma de límites <= 5,5 GB, para que quepa en un VPS de 8 GB compartido
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export MSYS_NO_PATHCONV=1
SCRIPT_PY="$(cat <<'PY'
import json, re, sys
cfg = json.load(sys.stdin)
def heap(dockerfile):
    m = re.search(r'max-old-space-size=(\d+)', open(dockerfile, encoding='utf-8').read())
    return int(m.group(1)) if m else None
fallos = 0
total = 0
for name, svc in cfg['services'].items():
    lim = svc.get('deploy', {}).get('resources', {}).get('limits', {}).get('memory')
    if lim is None:
        print(f'FALLA {name}: sin límite de memoria'); fallos += 1; continue
    mb = int(lim) // (1024 * 1024)
    rep = int(svc.get('deploy', {}).get('replicas', 1) or 1)
    total += mb * rep
    print(f'     {name}: {mb} MB x {rep}')
    h = {'web': heap(sys.argv[1]), 'worker': heap(sys.argv[2])}.get(name)
    if h is not None:
        if h <= 0.8 * mb: print(f'OK   {name}: heap {h} MB <= 80 % de {mb} MB')
        else: print(f'FALLA {name}: heap {h} MB demasiado cerca del límite {mb} MB'); fallos += 1
    if name == 'redis':
        cmd = ' '.join(svc['command']) if isinstance(svc['command'], list) else svc['command']
        m = re.search(r'--maxmemory (\d+)mb', cmd)
        mm = int(m.group(1))
        if mm <= 0.75 * mb: print(f'OK   redis: maxmemory {mm} MB <= 75 % de {mb} MB')
        else: print(f'FALLA redis: maxmemory {mm} MB demasiado cerca del límite {mb} MB'); fallos += 1
print(f'     total de límites: {total} MB')
if total <= 5632: print('OK   la suma de límites cabe en un VPS compartido de 8 GB')
else: print('FALLA suma de límites excesiva'); fallos += 1
sys.exit(1 if fallos else 0)
PY
)"
WEB_REPLICAS=2 docker compose --profile nginx config --format json | python -c "$SCRIPT_PY" Dockerfile.web Dockerfile.worker
echo "MEMORIA OK"
