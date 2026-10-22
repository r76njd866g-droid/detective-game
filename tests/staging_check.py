"""Independent staging audit: mobile taps, persistent browser restarts and resources.

Run after tools/prepare_staging.py. No production access or game source changes.
"""
import argparse
from contextlib import contextmanager
import json
from pathlib import Path
import sys
import threading
import time
import traceback
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.prepare_staging import PUBLIC_FILES
from tools.serve_staging import StagingHandler, make_server

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', default='work/staging-audit/package/site')
    parser.add_argument('--output', default='work/staging-audit/independent')
    parser.add_argument('--only', help='Rerun cases whose names contain this text; results contain only selected cases')
    args = parser.parse_args()
    site, output = Path(args.site).resolve(), Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    server = make_server(site, port=0)
    StagingHandler.log_message = lambda *args: None
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}/'
    results = {'base': base, 'cases': [], 'mobile': {}, 'performance': [], 'limitations': [
        'All device profiles use real Chromium on Linux, not Safari, Firefox, iOS or Android.',
        'Headless Web Audio pipeline checked; physical audio output not heard.',
        'Cold navigation is measured on a local server; throttling is simulation, not a field measurement.'
    ]}
    pages = []

    def case(name, function):
        if args.only and args.only not in name:
            return
        try:
            detail = function()
            results['cases'].append({'name': name, 'status': 'PASS', 'detail': detail})
            print('PASS:', name, flush=True)
        except Exception as error:
            results['cases'].append({'name': name, 'status': 'FAIL', 'error': str(error), 'traceback': traceback.format_exc()})
            print('FAIL:', name, str(error)[:400], flush=True)
            for index, page in enumerate(pages):
                try:
                    if not page.is_closed():
                        page.screenshot(path=str(output / f'failure-{len(results["cases"])}-{index}.png'))
                except Exception:
                    pass

    def observe(page):
        evidence = {'javascript': [], 'console_errors': [], 'failed_requests': [], 'http_errors': [], 'external_requests': []}
        page.on('pageerror', lambda error: evidence['javascript'].append(str(error)))
        page.on('console', lambda message: evidence['console_errors'].append(message.text) if message.type == 'error' else None)
        page.on('requestfailed', lambda request: evidence['failed_requests'].append({'url': request.url, 'failure': request.failure}))
        page.on('response', lambda response: evidence['http_errors'].append({'url': response.url, 'status': response.status}) if response.status >= 400 and not response.url.endswith('/favicon.ico') else None)
        page.on('request', lambda request: evidence['external_requests'].append(request.url) if urlsplit(request.url).scheme in ['http', 'https'] and not request.url.startswith(base) else None)
        pages.append(page)
        return evidence

    def healthy(evidence):
        assert not evidence['javascript'], evidence['javascript']
        assert not evidence['failed_requests'], evidence['failed_requests']
        assert not evidence['http_errors'], evidence['http_errors']
        assert not evidence['external_requests'], evidence['external_requests']

    def close_modal(page):
        page.locator('.modal.open [data-close], #dialog.open [data-close]').last.tap()

    def object_tap(page, name):
        page.locator(f'[data-object="{name}"]:visible').first.tap()
        expect(page.locator('.modal.open, #dialog.open')).to_be_visible()
        close_modal(page)

    def pair(page, a, b):
        page.locator('#journal').tap()
        page.locator(f'[data-select="{a}"]').tap()
        page.locator(f'[data-select="{b}"]').tap()
        page.locator('#connect').tap()
        close_modal(page)

    def all_storage(page):
        return page.evaluate('Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))')

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
            results['engine'] = {'name': 'Chromium', 'version': browser.version, 'platform': sys.platform}

            def route_checks():
                context = browser.new_context()
                try:
                    details = []
                    for filename in ('/', *PUBLIC_FILES):
                        response = context.request.get(base + filename.lstrip('/'))
                        assert response.status == 200, (filename, response.status)
                        expected = site / ('index.html' if filename == '/' else filename)
                        assert response.body() == expected.read_bytes(), filename
                        details.append({'route': filename, 'status': response.status, 'bytes': len(response.body()), 'mime': response.headers.get('content-type')})
                    for path in ['/.git/config', '/docs/REVIEW_REPORT.md', '/work/progress-originals.json', '/manifest.json', '/missing.html']:
                        response = context.request.get(base + path.lstrip('/'))
                        assert response.status == 404, (path, response.status)
                    response = context.request.get(base + 'chapter5.html?run=synthetic-test')
                    assert response.status == 200
                    assert set(x.name for x in site.iterdir()) == set(PUBLIC_FILES)
                    return details
                finally:
                    context.close()
            case('10 allowlisted assets, 7 chapter URLs, query routes and private-file exclusions', route_checks)

            device_profiles = {
                'iPhone-13-emulated': dict(p.devices['iPhone 13']),
                'iPhone-SE-emulated': dict(p.devices['iPhone SE']),
                'Pixel-7-emulated': dict(p.devices['Pixel 7']),
                'Android-360-emulated': {**p.devices['Pixel 7'], 'viewport': {'width': 360, 'height': 800}},
            }
            for name, device in device_profiles.items():
                def mobile_check(name=name, device=device):
                    context = browser.new_context(**device)
                    page = context.new_page()
                    page.set_default_timeout(6000)
                    evidence = observe(page)
                    chapters = []
                    results['mobile'][name] = {'viewport': device['viewport'], 'has_touch': device['has_touch'], 'chapters': chapters, 'evidence': evidence}
                    try:
                        for n in range(2, 9):
                            page.goto(base + ('index.html' if n == 2 else f'chapter{n}.html'))
                            if n == 3:
                                page.locator('[data-start="station"]').tap()
                            else:
                                page.locator('#enter').tap()
                            expect(page.locator('#game')).to_be_visible()
                            chapter = {'chapter': n, 'objects_tapped': [], 'images': page.evaluate('Array.from(document.images).map(i=>({loaded:i.complete&&i.naturalWidth>0,width:i.naturalWidth,height:i.naturalHeight}))')}
                            chapters.append(chapter)
                            assert all(image['loaded'] for image in chapter['images']), chapter
                            scenes = ['station', 'hotel'] if n == 3 else [None]
                            for scene in scenes:
                                if scene:
                                    page.locator(f'[data-place="{scene}"]').tap()
                                names = page.locator('[data-object]:visible').evaluate_all('(nodes)=>Array.from(new Set(nodes.map(n=>n.dataset.object)))')
                                for object_id in names:
                                    object_tap(page, object_id)
                                    chapter['objects_tapped'].append(object_id)
                            page.locator('#journal').tap()
                            expect(page.locator('.modal.open, #dialog.open')).to_be_visible()
                            close_modal(page)
                            page.locator('#hint').tap()
                            close_modal(page)
                            chapter['layout'] = page.evaluate('''()=>{const h=document.querySelector('.header-right').getBoundingClientRect(),b=document.querySelector('.brand').getBoundingClientRect();return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,headerRight:h.right,brandRight:b.right,controlsLeft:h.left}}''')
                            page.screenshot(path=str(output / f'{name}-chapter-{n}.png'))
                            healthy(evidence)
                        page.set_viewport_size({'width': device['viewport']['height'], 'height': device['viewport']['width']})
                        page.locator('#journal').tap()
                        close_modal(page)
                        page.screenshot(path=str(output / f'{name}-landscape.png'))
                        healthy(evidence)
                        return {'chapters': 7, 'objects_tapped': sum(len(c['objects_tapped']) for c in chapters), 'landscape_journal': True, 'evidence': evidence}
                    finally:
                        if sys.exc_info()[0] is not None:
                            page.screenshot(path=str(output / f'{name}-failure.png'))
                        context.close()
                case(name + ': all chapters, images, touch objects, journal, hints and landscape', mobile_check)

            @contextmanager
            def persistent(profile, device):
                options = {key: value for key, value in device.items() if key != 'default_browser_type'}
                context = p.chromium.launch_persistent_context(str(output / 'profiles' / profile), executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'], **options)
                context.set_default_timeout(6000)
                try:
                    yield context
                except BaseException:
                    for index, page in enumerate(context.pages):
                        if not page.is_closed():
                            page.screenshot(path=str(output / f'{profile}-error-{index}.png'))
                            (output / f'{profile}-error-{index}.json').write_text(json.dumps({'url': page.url, 'title': page.title()}))
                    raise
                finally:
                    context.close()  # Exits the browser process; no storage_state injection on reopen.

            for name in ['iPhone-13-emulated', 'Pixel-7-emulated']:
                def lifecycle(name=name):
                    device = device_profiles[name]
                    profile = name + '-lifecycle'
                    with persistent(profile, device) as context:
                        page = context.new_page(); evidence = observe(page)
                        page.goto(base + 'index.html'); page.locator('#enter').tap()
                        for obj in ['report', 'notice', 'clock', 'typewriter']:
                            object_tap(page, obj)
                        for doc in ['power', 'call']:
                            page.locator('[data-object="phone"]').tap(); page.locator(f'[data-doc="{doc}"]').tap(); close_modal(page)
                        object_tap(page, 'key'); object_tap(page, 'cabinet')
                        for a, b in [('report', 'notice'), ('clock', 'power'), ('typewriter', 'call')]:
                            pair(page, a, b)
                        # Mobile layout hides the desktop sidebar; finish through its journal control.
                        page.locator('#journal').tap(); page.locator('#conclude').tap(); page.locator('[data-route="hotel"]').tap()
                        page.locator('.modal.open a[href^="chapter3.html"]').tap(); page.locator('[data-start="hotel"]').tap()
                        page.locator('[data-object="woman"]').tap(); page.locator('[data-topic="saw"]').tap(); close_modal(page)
                        object_tap(page, 'invoice'); object_tap(page, 'telegram')
                        page.locator('[data-place="station"]').tap(); object_tap(page, 'ticket'); object_tap(page, 'locker')
                        pair(page, 'copy', 'witness')
                        expect(page.locator('#clueCount')).to_have_text('5')
                        expect(page.locator('#deductionCount')).to_have_text('1 / 3 вывода')
                        url = page.url
                        page.reload(); page.locator('#resume').tap()
                        expect(page.locator('#clueCount')).to_have_text('5')
                        saved = all_storage(page)
                        healthy(evidence)
                    # A distinct launch uses the same on-disk browser profile after full process closure.
                    with persistent(profile, device) as context:
                        page = context.new_page(); evidence = observe(page)
                        page.goto(url); page.locator('#resume').tap()
                        expect(page.locator('#clueCount')).to_have_text('5')
                        expect(page.locator('#deductionCount')).to_have_text('1 / 3 вывода')
                        assert all_storage(page) == saved
                        page.locator('#journal').tap(); expect(page.locator('[data-select]')).to_have_count(5); close_modal(page)
                        page.locator('.header-right a[href^="saves.html"]').tap()
                        with page.expect_download() as download:
                            page.locator('#export').tap()
                        backup = output / f'{name}-export.json'; download.value.save_as(backup)
                        file = json.loads(backup.read_text())
                        assert file['runs'] and file['raw']
                        old_id = file['raw'].get('detective:saves:v2:active')
                        healthy(evidence)
                    # Import into another empty persistent profile without replacing its storage.
                    with persistent(name + '-import', device) as context:
                        page = context.new_page(); evidence = observe(page)
                        page.goto(base + 'saves.html'); page.locator('#import').set_input_files(backup)
                        expect(page.locator('#status')).to_contain_text('Добавлено прохождений')
                        entry = page.locator('.entry').filter(has_text='Сохранённые главы: 2, 3')
                        entry.locator('a', has_text='Глава 3').tap()
                        page.locator('#resume').tap()
                        expect(page.locator('#clueCount')).to_have_text('5')
                        expect(page.locator('#deductionCount')).to_have_text('1 / 3 вывода')
                        imported_url = page.url  # Read only after the chapter navigation has completed.
                        assert old_id not in imported_url
                        healthy(evidence)
                    with persistent(name + '-import', device) as context:
                        page = context.new_page(); evidence = observe(page)
                        page.goto(imported_url); page.locator('#resume').tap()
                        expect(page.locator('#clueCount')).to_have_text('5')
                        healthy(evidence)
                    return {'real_browser_process_closures': 4, 'chapter_2_completed': True, 'chapter_3_restored_clues': 5, 'chapter_3_restored_deductions': 1, 'export_import_and_second_restart': True}
                case(name + ': new game → II/III → reload → close/relaunch → export/import → relaunch', lifecycle)

            def legacy_preservation():
                seeds = {
                    'last_case_chapter_2_v1': json.dumps({'clues': ['report'], 'deductions': [], 'key': False, 'cabinet': False, 'finished': False, 'route': None}),
                    'last_case_chapter_3_v1': '{damaged-legacy-do-not-replace',
                }
                context = browser.new_context(**device_profiles['Pixel-7-emulated'])
                try:
                    context.add_init_script('''(function(){const seeds=%s;for(const [k,v] of Object.entries(seeds))if(localStorage.getItem(k)===null)localStorage.setItem(k,v)})();''' % json.dumps(seeds))
                    page = context.new_page(); evidence = observe(page)
                    page.goto(base + 'index.html'); page.locator('#resume').tap()
                    expect(page.locator('#clueCount')).to_have_text('1')
                    expect(page.locator('[role="alert"]')).to_contain_text('повреждено')
                    page.locator('[data-object="notice"]').tap(); close_modal(page)
                    page.reload(); page.locator('#resume').tap()
                    values = all_storage(page)
                    for key, value in seeds.items():
                        assert values[key] == value
                    assert any(key.startswith('detective:saves:v2:revision:') for key in values)
                    healthy(evidence)
                    return {'legacy_bytes_preserved': True, 'malformed_record_preserved': True, 'new_progress': 2}
                finally:
                    context.close()
            case('legacy valid and damaged records unchanged after new actions and reload', legacy_preservation)

            def audio_check():
                context = browser.new_context()
                try:
                    page = context.new_page(); evidence = observe(page)
                    page.goto(base + 'index.html'); page.locator('#enter').click(); page.locator('#sound').click()
                    expect(page.locator('#sound')).to_have_attribute('aria-pressed', 'true')
                    page.wait_for_function('noiseCtx?.state === "running"')
                    details = page.evaluate('''()=>({context:noiseCtx.state,duration:noiseSource.buffer.duration,gain:noiseGain.gain.value,hasSignal:noiseSource.buffer.getChannelData(0).some(x=>Math.abs(x)>.0001)})''')
                    assert details['hasSignal'] and details['duration'] > 0 and details['gain'] > 0
                    page.locator('#sound').click(); expect(page.locator('#sound')).to_have_attribute('aria-pressed', 'false')
                    page.wait_for_function('noiseGain.gain.value < .02')
                    healthy(evidence)
                    return {**details, 'turned_off': True, 'physical_audio_listening': False}
                finally:
                    context.close()
            case('rain sound Web Audio start, nonzero buffer and mute controls', audio_check)

            def completed_endings_restart():
                details = []
                device = device_profiles['Pixel-7-emulated']
                for branch, text in [('originals', 'Белов остаётся в розыске'), ('belov', 'Белов остаётся задержан')]:
                    source = json.loads((ROOT / 'work' / f'progress-{branch}.json').read_text())
                    final = next(run for run in source['runs'] if run['data']['branch'] == branch and run['data']['chapters'].get('8', {}).get('finished'))
                    payload = {**source, 'runs': [final], 'raw': {}}
                    backup = output / f'ending-{branch}.json'; backup.write_text(json.dumps(payload))
                    profile = 'completed-' + branch
                    with persistent(profile, device) as context:
                        page = context.new_page(); evidence = observe(page)
                        page.goto(base + 'saves.html'); page.locator('#import').set_input_files(backup)
                        expect(page.locator('#status')).to_contain_text('Добавлено прохождений')
                        page.locator('.entry a', has_text='Глава 8').tap(); page.locator('#resume').tap()
                        page.locator('#journal').tap(); page.locator('[data-puzzle]').tap()
                        expect(page.locator('#content')).to_contain_text(text)
                        url, saved = page.url, all_storage(page)
                        healthy(evidence)
                    with persistent(profile, device) as context:
                        page = context.new_page(); evidence = observe(page)
                        page.goto(url); page.locator('#resume').tap()
                        page.locator('#journal').tap(); page.locator('[data-puzzle]').tap()
                        expect(page.locator('#content')).to_contain_text(text)
                        assert all_storage(page) == saved
                        healthy(evidence)
                    details.append({'branch': branch, 'epilogue_verified_after_process_restart': True})
                return details
            case('both completed endings survive full browser restart after portable import', completed_endings_restart)

            def performance_check():
                context = browser.new_context(**device_profiles['Pixel-7-emulated'])
                try:
                    page = context.new_page(); evidence = observe(page)
                    for throttled, names in [(False, ['index.html'] + [f'chapter{n}.html' for n in range(3, 9)]), (True, ['index.html', 'chapter3.html'])]:
                        session = context.new_cdp_session(page)
                        session.send('Network.enable')
                        session.send('Network.setCacheDisabled', {'cacheDisabled': True})
                        if throttled:
                            session.send('Network.emulateNetworkConditions', {'offline': False, 'latency': 150, 'downloadThroughput': 200000, 'uploadThroughput': 93750, 'connectionType': 'cellular3g'})
                            session.send('Emulation.setCPUThrottlingRate', {'rate': 4})
                        for name in names:
                            begin = time.perf_counter()
                            page.goto(base + name, wait_until='load', timeout=60000)
                            expect(page.locator('#intro')).to_be_visible()
                            nav = page.evaluate('''()=>{const n=performance.getEntriesByType('navigation')[0];return {domContentLoadedMs:n.domContentLoadedEventEnd,loadMs:n.loadEventEnd,transferBytes:n.transferSize}}''')
                            row = {'page': name, 'simulated_slow_network': throttled, 'elapsedMs': round((time.perf_counter()-begin)*1000), **nav}
                            results['performance'].append(row)
                        session.detach()
                    healthy(evidence)
                    return {'navigations': len(results['performance']), 'slow_profile': '1.6 Mbit/s download, 150 ms latency, CPU x4, cache disabled; local simulation'}
                finally:
                    context.close()
            case('cold local navigation and simulated constrained mobile connection', performance_check)
            browser.close()
    finally:
        server.shutdown(); server.server_close()
        (output / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
    return int(any(case['status'] == 'FAIL' for case in results['cases']))

if __name__ == '__main__':
    raise SystemExit(main())
