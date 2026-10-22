"""Check recorded viewport geometry independently of successful click/tap tests."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--results', default='work/staging-audit/independent/results.json')
args = parser.parse_args()
data = json.loads(Path(args.results).read_text())
issues = []
for device, profile in data['mobile'].items():
    for chapter in profile['chapters']:
        layout = chapter.get('layout')
        if not layout:
            continue
        # innerWidth may itself expand when a mobile layout overflows: compare with the emulated viewport.
        viewport = profile['viewport']['width']
        if layout['headerRight'] > viewport + 1:
            issues.append({'device': device, 'chapter': chapter['chapter'], 'problem': 'header controls extend beyond viewport', 'overflowPx': round(layout['headerRight'] - viewport, 2)})
        if layout['brandRight'] > layout['controlsLeft'] + 1:
            issues.append({'device': device, 'chapter': chapter['chapter'], 'problem': 'header brand overlaps controls'})
result = {'status': 'FAIL' if issues else 'PASS', 'issues': issues, 'checked_chapter_views': sum(bool(c.get('layout')) for p in data['mobile'].values() for c in p['chapters']), 'incomplete_chapter_views': sum(not bool(c.get('layout')) for p in data['mobile'].values() for c in p['chapters'])}
Path(args.results).with_name('layout-results.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
raise SystemExit(bool(issues))
