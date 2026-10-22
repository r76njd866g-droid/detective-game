"""Package only public game assets from an exact Git commit; never deploy."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILES = tuple(['index.html'] + [f'chapter{n}.html' for n in range(3, 9)] + ['saves.html', 'save-specs.js', 'save-store.js'])
SECRET_MARKERS = (
    re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    re.compile(rb'\bAKIA[0-9A-Z]{16}\b'),
    re.compile(rb'\b(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}\b'),
)

def prepare(destination, source='3a08c3d'):
    commit = subprocess.check_output(['git', 'rev-parse', '--verify', '--end-of-options', source + '^{commit}'], cwd=ROOT, text=True).strip()
    contents = {name: subprocess.check_output(['git', 'show', f'{commit}:{name}'], cwd=ROOT) for name in PUBLIC_FILES}
    for name, content in contents.items():
        if any(pattern.search(content) for pattern in SECRET_MARKERS):
            raise ValueError(f'Potential credential marker in {name}; package stopped')
    # The explicit allowlist excludes .git, browser profiles, exports, docs and private configuration.
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=False)
    site = destination / 'site'
    site.mkdir()
    manifest = {'source_commit': commit, 'file_count': len(contents), 'files': {}}
    for name, content in contents.items():
        (site / name).write_bytes(content)
        manifest['files'][name] = {'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    archive = destination / 'detective-game-staging.zip'
    with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED) as output:
        for name in PUBLIC_FILES:
            output.write(site / name, name)
    with zipfile.ZipFile(archive) as output:
        assert set(output.namelist()) == set(PUBLIC_FILES)
        assert output.testzip() is None
    print(json.dumps({'source_commit': commit, 'site': str(site), 'archive': str(archive), 'file_count': len(contents)}, indent=2))
    return site

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default='3a08c3d', help='Exact source commit or ref to package')
    parser.add_argument('--output', required=True, help='New, nonexistent destination; existing packages are never replaced')
    args = parser.parse_args()
    prepare(args.output, args.source)
