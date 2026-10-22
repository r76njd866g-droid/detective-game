"""Optional documentation schema checks using an existing development jsonschema tool."""
import json
from pathlib import Path
from jsonschema import Draft202012Validator

for path in Path('docs/specs').glob('*.schema.json'):
    schema = json.loads(path.read_text())
    Draft202012Validator.check_schema(schema)
    print('PASS schema:', path)

progress = Draft202012Validator(json.loads(Path('docs/specs/progress.schema.json').read_text()))
for path in Path('work').glob('progress-*.json'):
    progress.validate(json.loads(path.read_text()))
    print('PASS exported progress:', path)
