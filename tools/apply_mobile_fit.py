"""Insert/refresh the shared <style id="mobile-fit"> block in every chapter page."""
import re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
css = (ROOT / 'tools/mobile_fit.css').read_text(encoding='utf-8')
css = re.sub(r'/\*.*?\*/\s*', '', css, flags=re.S).strip()
block = f'<style id="mobile-fit">{css}</style>'
for name in ['chapter1.html', 'index.html'] + [f'chapter{n}.html' for n in range(3, 9)]:
    path = ROOT / name
    html = path.read_text(encoding='utf-8')
    html, n = re.subn(r'<style id="mobile-fit">.*?</style>', lambda m: block, html, flags=re.S)
    if not n:
        assert html.count('</head>') == 1, name
        html = html.replace('</head>', block + '</head>')
    path.write_text(html, encoding='utf-8')
    print('mobile-fit:', name)
