"""Real UI regression checks. Requires Playwright and a local Chromium, dev tools only."""
import functools
import http.server
import json
import os
from pathlib import Path
import threading
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{server.server_port}/'
RESULTS = []

def report(name):
    RESULTS.append(name)
    print('PASS:', name, flush=True)

def run_id(page):
    return parse_qs(urlparse(page.url).query)['run'][0]

def close_modal(page):
    page.keyboard.press('Escape')

def pair(page, a, b):
    page.locator('#journal').click()
    page.locator(f'[data-select="{a}"]').click()
    page.locator(f'[data-select="{b}"]').click()
    page.locator('#connect').click()
    close_modal(page)

def resume(page):
    page.reload()
    expect(page.locator('#resume')).to_be_visible()
    page.locator('#resume').click()

def go_next(page, n):
    page.locator(f'.modal.open a[href^="chapter{n}.html"], #dialog.open a[href^="chapter{n}.html"]').click()
    expect(page.locator('#enter')).to_be_visible()
    page.locator('#enter').click()

def read_object(page, object_id):
    page.locator(f'[data-object="{object_id}"]:visible').first.click()
    close_modal(page)

def complete3(page, route):
    expect(page.locator('#sceneName')).to_have_text('Гостиница «Север»' if route=='hotel' else 'Камера хранения')
    page.locator('[data-place="station"]').click()
    for obj in ['ticket','locker','dispatch','timetable']:read_object(page,obj)
    page.locator('[data-place="hotel"]').click()
    page.locator('[data-object="woman"]').click()
    for topic in ['why','parcel','saw']:page.locator(f'[data-topic="{topic}"]').click()
    close_modal(page)
    for obj in ['invoice','telegram']:read_object(page,obj)
    for a,b in [('copy','witness'),('dispatch','invoice'),('timetable','telegram')]:pair(page,a,b)
    resume(page);expect(page.locator('#clueCount')).to_have_text('7')
    page.locator('#review').click()
    page.select_option('#answerWho','rudnev');page.select_option('#answerCargo','originals');page.select_option('#answerPlace','warehouse');page.locator('#verify').click()
    expect(page.locator('#boardFeedback')).to_contain_text('пока не сходится')
    page.select_option('#answerWho','belov');page.locator('#verify').click()
    go_next(page,4)

def complete4(page, branch):
    for obj in ['manifest','loading','departure','phone']:read_object(page,obj)
    pair(page,'invoice','manifest');pair(page,'loading','departure')
    page.locator('[data-object="crate"]').click();page.locator('[data-crate="r9"]').click();expect(page.locator('#crateFeedback')).to_contain_text('не совпадает')
    page.locator('[data-crate="correct"]').click();close_modal(page)
    resume(page);page.locator('#review').click()
    page.locator(f'[data-plan="{branch}"]').click();page.locator(f'[data-confirm="{branch}"]').click();page.locator('#finishOperation').click()
    expect(page.locator('#finalContent')).to_contain_text('Оригинал спасён' if branch=='originals' else 'Белов задержан')
    go_next(page,5)

def complete_later(page, n, branch):
    config=page.evaluate('C')
    expect(page.locator('#branchIntro')).to_have_text(config['branchIntro'][branch])
    for doc in config['docs']:read_object(page,doc['id'])
    pair(page,config['docs'][0]['id'],config['docs'][-1]['id'])
    expect(page.locator('#progress')).to_have_text('0 / 2 вывода')
    for link in config['links']:pair(page,*link['pair'])
    resume(page);expect(page.locator('#clueCount')).to_have_text('4')
    page.locator('#review').click()
    for i,field in enumerate(config['puzzle']['fields']):page.locator(f'[name="answer{i}"]').select_option(str((field['answer']+1)%len(field['options'])))
    page.locator('#puzzleForm button[type="submit"]').click();expect(page.locator('#puzzleFeedback')).not_to_be_empty()
    for i,field in enumerate(config['puzzle']['fields']):page.locator(f'[name="answer{i}"]').select_option(str(field['answer']))
    page.locator('#puzzleForm button[type="submit"]').click()
    page.locator('#finish').click()
    if n==8:
        expect(page.locator('#content')).to_contain_text(config['endingBranch'][branch])
        resume(page);page.locator('#review').click();expect(page.locator('#content')).to_contain_text('Берег остаётся городским')
    else:go_next(page,n+1)

def snapshot(page, run):
    return page.evaluate('(id)=>DetectiveSaves.store.latest(id)',run)

def checks(browser):
    for branch,route in [('originals','station'),('belov','hotel')]:
        context=browser.new_context(viewport={'width':1440,'height':1000})
        page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        # II -> III uses the existing distinct start controls.
        page.goto(BASE+'index.html');page.locator('#enter').click()
        for obj in ['report','notice','clock','typewriter']:read_object(page,obj)
        for doc in ['power','call']:
            page.locator('[data-object="phone"]').click();page.locator(f'[data-doc="{doc}"]').click();close_modal(page)
        read_object(page,'key');read_object(page,'cabinet')
        pair(page,'report','clock');expect(page.locator('#deductionCount')).to_have_text('0 / 3 вывода')
        for a,b in [('report','notice'),('clock','power'),('typewriter','call')]:pair(page,a,b)
        resume(page);expect(page.locator('#clueCount')).to_have_text('7')
        page.locator('#review').click();page.locator(f'[data-route="{route}"]').click()
        page.locator('.modal.open a[href^="chapter3.html"]').click()
        page.locator(f'[data-start="{route}"]').click()
        complete3(page,route);complete4(page,branch)
        for n in range(5,9):complete_later(page,n,branch)
        assert not errors,errors
        report(f'II–VIII via UI, {branch}, {route}, deductions, reloads and final')
        old_run=run_id(page);old=snapshot(page,old_run)
        # Rebranch IV without losing any completed downstream chapter.
        page.goto(BASE+'chapter4.html?run='+old_run);page.locator('#resume').click();page.locator('#review').click();page.locator('#rebranch').click()
        new_run=run_id(page);assert old_run!=new_run
        other='belov' if branch=='originals' else 'originals'
        page.locator(f'[data-plan="{other}"]').click();page.locator(f'[data-confirm="{other}"]').click();page.locator('#finishOperation').click()
        assert snapshot(page,old_run)==old
        go_next(page,5);assert page.evaluate('branch')==other
        assert page.evaluate('state.clues')==[]
        report(f'IV rebranch {branch} → {other} keeps completed prior run')
        # Replaying a chapter forks, including later chapter restart.
        read_object(page,'schedule');new_run=run_id(page)
        config=page.evaluate('C')
        for doc in config['docs']:read_object(page,doc['id'])
        for link in config['links']:pair(page,*link['pair'])
        page.locator('#review').click()
        for i,f in enumerate(config['puzzle']['fields']):page.locator(f'[name="answer{i}"]').select_option(str(f['answer']))
        page.locator('#puzzleForm button[type="submit"]').click();page.locator('#finish').click()
        before=snapshot(page,new_run);page.locator('#restart').click();page.locator('#confirmRestart').click()
        assert run_id(page)!=new_run;assert snapshot(page,new_run)==before
        report(f'chapter V restart preserves prior completed state, {other}')
        # Export all through actual download, import in another browser context.
        page.goto(BASE+'saves.html')
        with page.expect_download() as dl:page.locator('#export').click()
        backup=ROOT/'work'/f'progress-{branch}.json';dl.value.save_as(backup)
        exported=json.loads(backup.read_text());assert exported['runs']
        target=browser.new_context();import_page=target.new_page();import_page.goto(BASE+'saves.html')
        import_page.locator('#import').set_input_files(backup)
        expect(import_page.locator('#status')).to_contain_text('Добавлено прохождений')
        assert len(import_page.locator('.entry').all())==len(exported['runs'])
        import_page.locator('.entry').filter(has_text='Сохранённые главы: 2, 3, 4, 5, 6, 7, 8').locator('a').last.click()
        import_page.locator('#resume').click();import_page.locator('#review').click();expect(import_page.locator('#content')).to_contain_text('Берег остаётся городским')
        report(f'file export/import and restored final, {branch}')
        target.close();context.close()
    # Direct entry, no saved data, seven chapters, desktop and mobile.
    for width,height in [(1440,1000),(390,844)]:
        context=browser.new_context(viewport={'width':width,'height':height});page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        for n in range(2,9):
            page.goto(BASE+('index.html' if n==2 else f'chapter{n}.html'))
            if n==3:page.locator('[data-start="station"]').click()
            else:page.locator('#enter').click()
            expect(page.locator('#game')).to_be_visible();page.locator('#journal').click();close_modal(page)
            assert page.evaluate('document.querySelector(".scene-frame img").naturalWidth')>0
        assert not errors,errors;report(f'direct start and journal in all seven chapters, {width}×{height}')
        context.close()
    # Browser migration and corruption UI.
    context=browser.new_context();page=context.new_page();page.goto(BASE+'saves.html')
    page.evaluate('localStorage.clear()')
    page.evaluate("localStorage.setItem('last_case_chapter_3_v1','{broken');localStorage.setItem('last_case_chapter_2_v1',JSON.stringify({clues:['report'],deductions:[],key:false,cabinet:false,finished:false,route:null}))")
    page.goto(BASE+'index.html');page.locator('#resume').click();expect(page.locator('#clueCount')).to_have_text('1')
    expect(page.locator('[role="alert"]')).to_contain_text('повреждено')
    assert page.evaluate("localStorage.getItem('last_case_chapter_3_v1')")=='{broken'
    report('legacy migration and corrupt record warning in browser')
    # Two tabs continue same run: both remain recoverable.
    run=run_id(page);other=context.new_page();other.goto(BASE+'index.html?run='+run);other.locator('#resume').click()
    read_object(page,'clock');read_object(other,'notice');assert run_id(page)!=run_id(other)
    assert snapshot(page,run)['data']['chapters']['2']['clues']==['report','clock']
    report('stale browser tab forks without losing either player action')
    context.close()
    context=browser.new_context();page=context.new_page();page.goto(BASE+'saves.html')
    page.evaluate('''()=>{
      localStorage.clear();
      localStorage.setItem('last_case_chapter_4_v1',JSON.stringify({clues:['invoice','manifest','loading','departure','phone'],deductions:['cargo','split'],crate:true,plan:'belov',finished:'belov',seenOutcomes:['belov'],started:true}));
      localStorage.setItem('archive_case_chapter_5_v1',JSON.stringify({branch:'originals',clues:['schedule'],deductions:[],answers:[],solved:false,finished:false,started:true}));
    }''')
    page.goto(BASE+'chapter5.html');page.locator('#resume').click()
    assert page.evaluate('branch')=='originals';expect(page.locator('#clueCount')).to_have_text('1')
    report('mixed legacy IV/V branches recover the existing late-chapter progress')
    original=snapshot(page,run_id(page))
    page.evaluate('''()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('detective:saves:v2:revision:'))throw new DOMException('Quota','QuotaExceededError');return original.call(this,k,v);};}''')
    read_object(page,'calls');expect(page.locator('[role="alert"]')).to_contain_text('Прогресс не записан')
    assert snapshot(page,run_id(page))==original
    with page.expect_download() as dl:page.locator('[role="alert"] button').click()
    path=ROOT/'work'/'progress-emergency.json';dl.value.save_as(path)
    assert json.loads(path.read_text())['runs'][0]['data']['chapters']['5']['clues']==['schedule','calls']
    report('quota warning and emergency file export preserve unsaved browser progress')
    context.close()

try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
        checks(browser)
        browser.close()
finally:
    server.shutdown()
    (ROOT/'work'/'browser-results.json').write_text(json.dumps(RESULTS,ensure_ascii=False,indent=2)+'\n')
