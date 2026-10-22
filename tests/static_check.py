"""Baseline checks without external dependencies. Run from the repository root."""
import hashlib
import json
import re
from pathlib import Path

baseline = json.loads(Path('tests/baseline.json').read_text())
digest = lambda value: hashlib.sha256(value.encode()).hexdigest()
for name, expected in baseline.items():
    source = Path(name).read_text()
    html = re.sub(r'<script\b[^>]*>.*?</script>', '', source, flags=re.S)
    # Script includes add only separators around the original inline script.
    if digest(html) != expected['html']:
        # The exact added includes each end in a newline immediately before the original script.
        source_without_includes = source.replace('<script src="save-specs.js"></script>\n<script src="save-store.js"></script>\n', '')
        assert digest(re.sub(r'<script\b[^>]*>.*?</script>', '', source_without_includes, flags=re.S)) == expected['html'], name
    scripts = re.findall(r'<script\b[^>]*>(.*?)</script>', source, re.S)
    js = next(s for s in scripts if 'const $=' in s)
    prefixes = ('function ending(', 'function conclude(', 'function route(', 'function decision(', 'function previewPlan(', 'function operation(', 'function witness(', 'function doc(', 'function sceneObject(', 'function puzzle(', 'function success(')
    assert digest('\n'.join(line for line in js.splitlines() if line.startswith(prefixes))) == expected['narrativeLines'], name
    if 'C' in expected:
        c = json.JSONDecoder().raw_decode(js[len('const C='):])[0]
        assert digest(json.dumps(c, sort_keys=True, ensure_ascii=False)) == expected['C'], name
    else:
        assert digest(js.split('const evidence={', 1)[1].split('\n};', 1)[0]) == expected['evidence'], name
    print('PASS:', name, 'HTML, CSS, images and narrative baseline')
