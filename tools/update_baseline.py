"""Regenerate tests/baseline.json after a reviewed, intentional content change.

static_check.py then guards the new state against accidental edits. Run from the repo root.
"""
import hashlib
import json
import re
from pathlib import Path

digest = lambda value: hashlib.sha256(value.encode()).hexdigest()
PREFIXES = ('function ending(', 'function conclude(', 'function route(', 'function decision(', 'function previewPlan(', 'function operation(', 'function witness(', 'function doc(', 'function sceneObject(', 'function puzzle(', 'function success(')
INCLUDES = '<script src="save-specs.js"></script>\n<script src="save-store.js"></script>\n'
baseline = {}
for name in ['index.html'] + [f'chapter{n}.html' for n in range(3, 9)]:
    source = Path(name).read_text()
    entry = {'html': digest(re.sub(r'<script\b[^>]*>.*?</script>', '', source.replace(INCLUDES, ''), flags=re.S))}
    js = next(s for s in re.findall(r'<script\b[^>]*>(.*?)</script>', source, re.S) if 'const $=' in s)
    entry['narrativeLines'] = digest('\n'.join(line for line in js.splitlines() if line.startswith(PREFIXES)))
    if js.startswith('const C='):
        c = json.JSONDecoder().raw_decode(js[len('const C='):])[0]
        entry['C'] = digest(json.dumps(c, sort_keys=True, ensure_ascii=False))
    else:
        entry['evidence'] = digest(js.split('const evidence={', 1)[1].split('\n};', 1)[0])
    baseline[name] = entry
Path('tests/baseline.json').write_text(json.dumps(baseline, indent=2) + '\n')
print('baseline updated for', ', '.join(baseline))
