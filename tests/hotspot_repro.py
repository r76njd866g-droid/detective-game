"""Reproduce narrow-screen hotspot interception without force clicks or source edits."""
import argparse
import json
from pathlib import Path
import sys
import threading
from playwright.sync_api import sync_playwright, TimeoutError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.serve_staging import StagingHandler, make_server

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', default='work/staging-audit/package/site')
    parser.add_argument('--output', default='work/staging-audit/hotspots')
    args = parser.parse_args()
    output = Path(args.output).resolve(); output.mkdir(parents=True, exist_ok=False)
    StagingHandler.log_message = lambda *args: None
    server = make_server(args.site, port=0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
            cases = [('iPhone-SE', p.devices['iPhone SE'], 4, 'manifest'), ('Android-360', {**p.devices['Pixel 7'], 'viewport': {'width': 360, 'height': 800}}, 8, 'register')]
            for name, device, chapter, target in cases:
                context = browser.new_context(**device)
                page = context.new_page()
                javascript_errors = []
                page.on('pageerror', lambda error: javascript_errors.append(str(error)))
                page.goto(f'http://127.0.0.1:{server.server_port}/chapter{chapter}.html')
                page.locator('#enter').tap()
                locator = page.locator(f'[data-object="{target}"]:visible').first
                info = locator.evaluate('''node=>{
                  const r=node.getBoundingClientRect(),cx=r.x+r.width/2,cy=r.y+r.height/2;
                  const hit=document.elementFromPoint(cx,cy);
                  const exposed=[];
                  for(let x=1;x<10;x++)for(let y=1;y<10;y++){
                    const px=r.x+r.width*x/10,py=r.y+r.height*y/10,el=document.elementFromPoint(px,py);
                    if(el===node||node.contains(el))exposed.push({x:px,y:py});
                  }
                  return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},centerHit:hit?.closest('[data-object]')?.dataset.object,exposed};
                }''')
                result = {'device': name, 'viewport': device['viewport'], 'chapter': chapter, 'target': target, 'rect': info['rect'], 'centerHit': info['centerHit'], 'uncoveredSampleCount': len(info['exposed'])}
                page.screenshot(path=str(output / f'{name}-portrait.png'))
                try:
                    locator.tap(timeout=2500)
                    result['centerTap'] = 'PASS'
                except TimeoutError:
                    result['centerTap'] = 'FAIL'
                if result['centerTap'] == 'PASS':
                    page.locator('.modal.open [data-close], #dialog.open [data-close]').last.tap()
                if info['exposed']:
                    point = info['exposed'][len(info['exposed']) // 2]
                    page.touchscreen.tap(point['x'], point['y'])
                    page.locator('.modal.open, #dialog.open').wait_for(state='visible')
                    result['exposedPointTap'] = 'PASS'
                    page.locator('.modal.open [data-close], #dialog.open [data-close]').last.tap()
                else:
                    result['exposedPointTap'] = 'NO UNCOVERED SAMPLES'
                page.set_viewport_size({'width': device['viewport']['height'], 'height': device['viewport']['width']})
                try:
                    locator.tap(timeout=2500)
                    result['landscapeCenterTap'] = 'PASS'
                except TimeoutError:
                    result['landscapeCenterTap'] = 'FAIL'
                page.screenshot(path=str(output / f'{name}-landscape.png'))
                result['javascriptErrors'] = list(javascript_errors)
                results.append(result)
                context.close()
            browser.close()
    finally:
        server.shutdown(); server.server_close()
        (output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps(results, indent=2))
    return int(any(r['centerTap'] == 'FAIL' for r in results))

if __name__ == '__main__':
    raise SystemExit(main())
