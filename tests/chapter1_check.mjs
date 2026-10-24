// Chapter I: every prologue × phone × route combination through the real UI (mouse and touch),
// the 15-second timer (pause while the tab is hidden, "Ты замер" on timeout, "без таймера"),
// and the small echoes of chapter I in II, III, V, VII and VIII for all combinations.
// Usage: node tests/chapter1_check.mjs [--quick]
import assert from 'node:assert/strict';
import {serve, playwright} from './lib/server.mjs';

const PROLOGUE = ['hide', 'drown', 'call', 'froze'], PHONE = ['play', 'press', 'silent'], ROUTE = ['hotel', 'station'];
const results = [];
const pass = name => { results.push(name); console.log('PASS:', name); };
const text = async (page, sel) => (await page.locator(sel).first().textContent()) || '';

export async function playChapterOne(page, {prologue, phone, route, binFirst = true, touch = false, timer = false, base = BASE}) {
  const press = sel => (touch ? page.locator(sel).first().tap() : page.locator(sel).first().click());
  const close = () => page.keyboard.press('Escape');
  await page.goto(base + 'chapter1.html');
  await page.evaluate(v => localStorage.setItem('detective:pref:no-timer', v ? '0' : '1'), timer);
  await page.reload();
  await press('#enter');
  await page.locator('#objectModal.open [data-locked]').waitFor({state: 'attached'});
  if (prologue === 'froze' && timer) await page.locator('#toTitle').waitFor({timeout: 20000});
  else await press(`[data-prologue="${prologue}"]`);
  assert.match(await text(page, '#objectTitle'), prologue === 'froze' ? /Ты замер/ : /./);
  await press('#toTitle'); await press('#titleNext');
  await page.locator('.hotspot[data-object="ledger"]').waitFor();
  const object = async id => { await press(`.hotspot[data-object="${id}"]`); await close(); };
  // Opening the smouldering bin early saves every scrap; looking around first lets two of them burn.
  if (binFirst) await object('bin');
  for (const id of ['ledger', 'glass', 'paper', 'booking']) await object(id);
  if (!binFirst) await object('bin');
  await press('.hotspot[data-object="phone"]'); await press(`[data-phone="${phone}"]`); await close();
  await press('.hotspot[data-object="bin"]');
  for (const id of await page.locator('[data-scrap]').evaluateAll(n => n.map(b => b.dataset.scrap))) await press(`[data-scrap="${id}"]`);
  await close();
  await object('drawer');
  await press('#journal'); await press('[data-select="ledger"]'); await press('[data-select="paper"]'); await press('#connect');
  assert.match(await text(page, '#journalFeedback'), /не подтверждают/);
  await press('[data-select="paper"]'); await press('[data-select="glass"]'); await press('#connect');
  await press('#conclude'); await press(`[data-route="${route}"]`);
  assert.match(await text(page, '#finalTitle'), /Ключ от соседней двери/);
  const state = await page.evaluate('state');
  assert.equal(state.prologue, prologue); assert.equal(state.phone, phone); assert.equal(state.route, route); assert.equal(state.finished, true);
  assert.equal(state.scraps.length, binFirst ? 3 : 1); assert.equal(state.burned, binFirst ? 0 : 2);
  return state;
}

let BASE;
async function main() {
  const quick = process.argv.includes('--quick');
  const {chromium} = await playwright();
  const {server, base} = await serve(); BASE = base;
  const browser = await chromium.launch();
  try {
    // 1. Every combination through the UI; alternate mouse/touch and early/late bin.
    let i = 0;
    for (const prologue of PROLOGUE) for (const phone of PHONE) for (const route of ROUTE) {
      if (quick && i % 5) { i++; continue; }
      const touch = i % 2 === 1, binFirst = i % 3 !== 2;
      const context = await browser.newContext(touch ? {viewport: {width: 390, height: 664}, isMobile: true, hasTouch: true} : {viewport: {width: 1280, height: 800}});
      const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
      await playChapterOne(page, {prologue, phone, route, binFirst, touch});
      // Chapter II opens with the daytime route of chapter I, carried by the run id in the link.
      await (touch ? page.locator('#finalModal a[href^="index.html"]').tap() : page.locator('#finalModal a[href^="index.html"]').click());
      await page.waitForURL(/index\.html\?run=/);
      assert.match(await text(page, '#chapterOneEcho'), route === 'hotel' ? /«Севере»/ : /вокзал/);
      await page.reload(); assert.match(await text(page, '#chapterOneEcho'), route === 'hotel' ? /«Севере»/ : /вокзал/);
      assert.deepEqual(errors, []);
      pass(`chapter I via UI (${touch ? 'touch 390×664' : 'mouse 1280×800'}): ${prologue} × ${phone} × ${route}, bin ${binFirst ? 'first (3 scraps)' : 'late (1 scrap)'} → chapter II entry`);
      await context.close(); i++;
    }

    // 2. Timer: 15 s, paused while the tab is hidden, timeout = "Ты замер"; "без таймера" offers the fourth choice.
    {
      const context = await browser.newContext(); const page = await context.newPage();
      await page.goto(BASE + 'chapter1.html'); await page.evaluate(() => localStorage.setItem('detective:pref:no-timer', '0')); await page.reload();
      await page.locator('#enter').click(); await page.locator('#timerBar').waitFor();
      assert.equal(await page.locator('[data-prologue="froze"]').count(), 0);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', {configurable: true, get: () => true}); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForTimeout(16500);
      assert.equal(await page.evaluate('state.prologue'), null); assert.match(await text(page, '#timerLabel'), /Пауза/);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', {configurable: true, get: () => false}); document.dispatchEvent(new Event('visibilitychange')); });
      const started = Date.now(); await page.locator('#toTitle').waitFor({timeout: 20000});
      const waited = Date.now() - started;
      assert.ok(waited > 12000 && waited < 17000, `timer resumed and ran out after ${waited} ms`);
      assert.equal(await page.evaluate('state.prologue'), 'froze'); assert.match(await text(page, '#objectTitle'), /Ты замер/);
      pass(`timer pauses while hidden (16.5 s, no choice made) and then expires after ${(waited / 1000).toFixed(1)} s as "Ты замер"`);
      await page.locator('#toTitle').click(); await page.locator('#titleNext').click();
      await page.locator('#newGame').count();
      await page.evaluate(() => localStorage.removeItem('detective:pref:no-timer')); await page.goto(BASE + 'chapter1.html');
      await page.locator('#enter').click(); await page.locator('#disableTimer').click();
      assert.equal(await page.locator('#timerBar').count(), 0); assert.equal(await page.locator('[data-prologue="froze"]').count(), 1);
      await page.waitForTimeout(16000); assert.equal(await page.evaluate('state.prologue'), null);
      assert.equal(await page.locator('#noTimer').isChecked(), true);
      pass('"Без таймера": no countdown, explicit "Замереть" choice, nothing happens after 16 s');
      await page.keyboard.press('Escape'); assert.equal(await page.locator('#objectModal.open').count(), 1);
      pass('prologue dialog cannot be dismissed without a choice');
      await context.close();
    }

    // 3. Echo logic in II–VIII for every combination and scrap count (state injected via the save store).
    const context = await browser.newContext(); const page = await context.newPage();
    await page.goto(BASE + 'saves.html');
    const solved = n => page.evaluate(n => {
      const s = DetectiveSaveSpecs[n];
      return {...s.defaults, clues: [...s.clues], deductions: Object.keys(s.pairs), answers: s.correct.map(String), solved: true, finished: true, started: true};
    }, n);
    const late = {5: await solved(5), 7: await solved(7), 8: await solved(8)};
    let combos = 0;
    for (const prologue of PROLOGUE) for (const phone of PHONE) for (const route of ROUTE) for (let scraps = 0; scraps <= 3; scraps++) {
      if (quick && combos % 7) { combos++; continue; }
      const one = {clues: ['ledger', 'glass', 'note'], deductions: ['fresh'], prologue, phone, scraps: ['date', 'pier', 'initial'].slice(0, scraps), burned: 3 - scraps, bin: true, cache: true, route, finished: true, started: true};
      for (const branch of ['originals', 'belov']) {
        await page.goto(BASE + 'saves.html');
        const run = await page.evaluate(([one, late, branch]) => {
          const [rec] = DetectiveSaves.store.importProgress({format: 'detective-game-progress', schemaVersion: 2, runs: [{data: {label: 't', branch, chapters: {1: one, 5: {...late[5], branch}, 7: {...late[7], branch}, 8: {...late[8], branch}}}}]});
          return rec.runId;
        }, [one, late, branch]);
        if (branch === 'originals') {
          await page.goto(BASE + `index.html?run=${run}`);
          assert.match(await text(page, '#chapterOneEcho'), route === 'hotel' ? /номере 204/ : /вокзал/);
          await page.goto(BASE + `chapter3.html?run=${run}`); await page.locator('[data-start="hotel"]').click(); await page.evaluate('witness()');
          const w = await text(page, '#objectContent');
          assert.match(w, {play: /дело закрывают/, press: /на цепочке/, silent: /назвался следователем/}[phone]);
          assert.match(w, route === 'hotel' ? /передал вашу записку/ : /на вокзале днём/);
          await page.goto(BASE + `chapter5.html?run=${run}`); await page.evaluate("doc('receipt')");
          assert.equal((await text(page, '#content')).includes('грубили по телефону'), phone === 'press');
          await page.goto(BASE + `chapter7.html?run=${run}`); await page.evaluate("doc('phone')");
          assert.equal((await text(page, '#content')).includes('11:20, внутренняя линия архива'), phone === 'silent');
          await page.evaluate('ending()');
          assert.equal((await text(page, '#content')).includes('«В.» — Воронцов'), scraps === 3);
        }
        await page.goto(BASE + `chapter8.html?run=${run}`); await page.evaluate('ending()');
        const end = await text(page, '#content');
        assert.match(end, /с другой стороны/); assert.match(end, /СЕВЕРНАЯ ОПИСЬ/); assert.match(end, /2,1 кг/);
        assert.match(end, phone === 'silent' ? /Шаги на досках — Нина Орлова/ : /Шаги на досках — курьер Воронцова/);
        const key = prologue === 'call' ? (phone === 'silent' ? /«Это я»/ : /Курьер не ответил/) : {hide: /зачитают в суде/, drown: /знаете только вы/, froze: /голос Руднева/}[prologue];
        assert.match(end, key);
        assert.equal(end.includes('считал вас своим'), phone === 'play');
        assert.match(end, branch === 'originals' ? /Белов остаётся в розыске/ : /Белов остаётся задержан/);
      }
      combos++;
    }
    pass(`echo logic for ${quick ? 'a sample of' : 'all'} ${PROLOGUE.length * PHONE.length * ROUTE.length * 4} combinations (prologue × phone × route × scraps) in II, III, V, VII and both endings of VIII`);
    // A run without chapter I keeps the old texts everywhere.
    await page.goto(BASE + 'saves.html');
    const plain = await page.evaluate(late => DetectiveSaves.store.importProgress({format: 'detective-game-progress', schemaVersion: 2, runs: [{data: {label: 'old', branch: 'belov', chapters: {8: {...late[8], branch: 'belov'}}}}]})[0].runId, late);
    await page.goto(BASE + `index.html?run=${plain}`); assert.equal(await page.locator('#chapterOneEcho').isHidden(), true);
    await page.goto(BASE + `chapter8.html?run=${plain}`); await page.evaluate('ending()');
    assert.ok(!(await text(page, '#content')).includes('с другой стороны'));
    pass('runs without chapter I show the original texts (no replay, no echo)');
    // A damaged chapter I record in an import is refused before anything is written.
    const before = await page.evaluate(() => DetectiveSaves.store.list().length);
    const refused = await page.evaluate(() => { try { DetectiveSaves.store.importProgress({format: 'detective-game-progress', schemaVersion: 2, runs: [{data: {label: 'bad', branch: 'originals', chapters: {1: {clues: [], deductions: [], prologue: 'swim'}}}}]}); return false; } catch { return true; } });
    assert.ok(refused); assert.equal(await page.evaluate(() => DetectiveSaves.store.list().length), before);
    // A damaged chapter I revision already in storage is skipped with a warning, never rewritten.
    await page.evaluate(() => localStorage.setItem('detective:saves:v2:revision:broken1', JSON.stringify({schemaVersion: 2, id: 'broken1', runId: 'r1', parent: null, sequence: 0, createdAt: 'x', data: {label: 'x', branch: 'originals', chapters: {1: {prologue: 'swim'}}}})));
    await page.goto(BASE + 'chapter1.html'); assert.match(await text(page, '[role="alert"]'), /повреждённая запись/);
    assert.match(await page.evaluate(() => localStorage.getItem('detective:saves:v2:revision:broken1')), /swim/);
    pass('damaged chapter I data: import refused, stored record kept untouched with a warning');
    // Two tabs of chapter I on the same run fork instead of overwriting each other.
    await page.evaluate(() => localStorage.setItem('detective:pref:no-timer', '1'));
    await page.locator('#enter').click(); await page.locator('[data-prologue="hide"]').click();
    const run = new URL(page.url()).searchParams.get('run');
    const other = await context.newPage(); await other.goto(BASE + `chapter1.html?run=${run}`); await other.locator('#resume').click();
    await page.locator('#toTitle').click(); await page.locator('#titleNext').click(); await page.locator('.hotspot[data-object="ledger"]').click();
    await other.locator('#titleNext').click().catch(() => {}); await other.locator('.hotspot[data-object="glass"]').click();
    assert.notEqual(new URL(other.url()).searchParams.get('run'), new URL(page.url()).searchParams.get('run'));
    assert.deepEqual((await page.evaluate(id => DetectiveSaves.store.latest(id), run)).data.chapters['1'].clues, ['ledger']);
    pass('chapter I in two tabs: the stale tab forks, both actions are kept');
    await context.close();
  } finally { await browser.close(); server.close(); }
  console.log(`${results.length} chapter I checks passed`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exitCode = 1; });
