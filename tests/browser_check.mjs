// Full UI playthrough of chapters II–VIII on both endings, plus save checks.
// Node port of tests/browser_check.py (Playwright for Node is the available dev tool).
// Usage: node tests/browser_check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {serve, playwright, ROOT} from './lib/server.mjs';

const results = [];
const pass = name => { results.push(name); console.log('PASS:', name); };
const runId = page => new URL(page.url()).searchParams.get('run');
const snapshot = (page, run) => page.evaluate(id => DetectiveSaves.store.latest(id), run);
const text = (page, sel) => page.locator(sel).first().textContent();

function ui(page, touch) {
  const press = async loc => (touch ? loc.tap() : loc.click());
  const u = {
    press,
    sel: s => press(page.locator(s).first()),
    close: () => page.keyboard.press('Escape'),
    async object(id) { await press(page.locator(`[data-object="${id}"]:visible`).first()); await u.close(); },
    async pair(a, b) {
      await u.sel('#journal'); await u.sel(`[data-select="${a}"]`); await u.sel(`[data-select="${b}"]`); await u.sel('#connect'); await u.close();
    },
    async resume() { await page.reload(); await page.locator('#resume').waitFor(); await u.sel('#resume'); },
    async next(n) {
      await u.sel(`.modal.open a[href^="chapter${n}.html"], #dialog.open a[href^="chapter${n}.html"]`);
      await page.waitForURL(new RegExp(`chapter${n}\\.html`));
      await page.locator('#enter').waitFor(); await u.sel('#enter');
    }
  };
  return u;
}

async function chapter2(page, u, route) {
  await page.goto(BASE + 'index.html'); await u.sel('#enter');
  for (const o of ['report', 'notice', 'clock', 'typewriter']) await u.object(o);
  for (const d of ['power', 'call']) { await u.sel('[data-object="phone"]'); await u.sel(`[data-doc="${d}"]`); await u.close(); }
  await u.object('key'); await u.object('cabinet');
  await u.pair('report', 'clock'); assert.equal(await text(page, '#deductionCount'), '0 / 3 вывода');
  for (const [a, b] of [['report', 'notice'], ['clock', 'power'], ['typewriter', 'call']]) await u.pair(a, b);
  await u.resume(); assert.equal(await text(page, '#clueCount'), '7');
  await u.sel('#journal'); await u.sel('#conclude'); await u.sel(`[data-route="${route}"]`);
  await u.sel('.modal.open a[href^="chapter3.html"]');
  await page.waitForURL(/chapter3/);
  await u.sel(`[data-start="${route}"]`);
}

async function chapter3(page, u, route) {
  assert.equal(await text(page, '#sceneName'), route === 'hotel' ? 'Гостиница «Север»' : 'Камера хранения');
  await u.sel('[data-place="station"]');
  for (const o of ['locker', 'ticket', 'locker', 'dispatch', 'timetable', 'case']) await u.object(o);
  await u.sel('[data-place="hotel"]');
  await u.sel('[data-object="woman"]');
  for (const t of ['why', 'parcel', 'saw']) await u.sel(`[data-topic="${t}"]`);
  assert.match(await text(page, '#dialogueText'), /Белов заменил/);
  await u.close();
  for (const o of ['invoice', 'telegram']) await u.object(o);
  for (const [a, b] of [['copy', 'witness'], ['dispatch', 'invoice'], ['timetable', 'telegram']]) await u.pair(a, b);
  await u.resume(); assert.equal(await text(page, '#clueCount'), '7');
  await u.sel('#journal'); await u.sel('#conclude');
  await page.selectOption('#answerWho', 'rudnev'); await page.selectOption('#answerCargo', 'originals'); await page.selectOption('#answerPlace', 'warehouse');
  await u.sel('#verify'); assert.match(await text(page, '#boardFeedback'), /пока не сходится/);
  await page.selectOption('#answerWho', 'belov'); await u.sel('#verify');
  await u.next(4);
}

async function chapter4(page, u, branch) {
  for (const o of ['manifest', 'loading', 'departure', 'phone']) await u.object(o);
  await u.pair('invoice', 'manifest'); await u.pair('loading', 'departure');
  await u.sel('[data-object="crate"]'); await u.sel('[data-crate="r9"]'); assert.match(await text(page, '#crateFeedback'), /не совпадает/);
  await u.sel('[data-crate="correct"]'); await u.close();
  await u.resume(); await u.sel('#journal'); await u.sel('#conclude');
  await u.sel(`[data-plan="${branch}"]`); await u.sel(`[data-confirm="${branch}"]`); await u.sel('#finishOperation');
  assert.match(await text(page, '#finalContent'), branch === 'originals' ? /Оригинал спасён/ : /Белов задержан/);
  await u.next(5);
}

async function laterChapter(page, u, n, branch) {
  const C = await page.evaluate('C');
  assert.equal(await text(page, '#branchIntro'), C.branchIntro[branch]);
  for (const d of C.docs) await u.object(d.id);
  await u.pair(C.docs[0].id, C.docs.at(-1).id); assert.equal(await text(page, '#progress'), '0 / 2 вывода');
  for (const l of C.links) await u.pair(...l.pair);
  await u.resume(); assert.equal(await text(page, '#clueCount'), '4');
  await u.sel('#journal'); await u.sel('[data-puzzle]');
  for (const [i, f] of C.puzzle.fields.entries()) await page.locator(`[name="answer${i}"]`).selectOption(String((f.answer + 1) % f.options.length));
  await u.sel('#puzzleForm button[type="submit"]'); assert.ok((await text(page, '#puzzleFeedback')).length > 0);
  for (const [i, f] of C.puzzle.fields.entries()) await page.locator(`[name="answer${i}"]`).selectOption(String(f.answer));
  await u.sel('#puzzleForm button[type="submit"]'); await u.sel('#finish');
  if (n === 8) {
    assert.ok((await text(page, '#content')).includes(C.endingBranch[branch]));
    await u.resume(); await u.sel('#journal'); await u.sel('[data-puzzle]'); assert.match(await text(page, '#content'), /Берег остаётся городским/);
  } else await u.next(n + 1);
}

let BASE;
async function main() {
  const {chromium} = await playwright();
  const {server, base} = await serve();
  BASE = base;
  const work = path.join(ROOT, 'work'); fs.mkdirSync(work, {recursive: true});
  const browser = await chromium.launch();
  try {
    // Full playthroughs: desktop mouse and phone touch, both endings and both chapter III routes.
    for (const [branch, route, device] of [['originals', 'station', 'desktop'], ['belov', 'hotel', 'phone'], ['originals', 'hotel', 'phone'], ['belov', 'station', 'desktop']]) {
      const touch = device === 'phone';
      const context = await browser.newContext(touch ? {viewport: {width: 360, height: 740}, isMobile: true, hasTouch: true} : {viewport: {width: 1440, height: 1000}});
      const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
      const u = ui(page, touch);
      await chapter2(page, u, route); await chapter3(page, u, route); await chapter4(page, u, branch);
      for (let n = 5; n <= 8; n++) await laterChapter(page, u, n, branch);
      assert.deepEqual(errors, []);
      pass(`II–VIII via UI (${device}), ending "${branch}", III from ${route}, reloads, wrong answers and final`);
      if (device === 'phone') { await context.close(); continue; }

      const oldRun = runId(page), old = await snapshot(page, oldRun);
      await page.goto(BASE + 'chapter4.html?run=' + oldRun); await u.sel('#resume'); await u.sel('#journal'); await u.sel('#conclude'); await u.sel('#rebranch');
      const newRun = runId(page); assert.notEqual(oldRun, newRun);
      const other = branch === 'originals' ? 'belov' : 'originals';
      await u.sel(`[data-plan="${other}"]`); await u.sel(`[data-confirm="${other}"]`); await u.sel('#finishOperation');
      assert.deepEqual(await snapshot(page, oldRun), old);
      await u.next(5); assert.equal(await page.evaluate('branch'), other); assert.deepEqual(await page.evaluate('state.clues'), []);
      pass(`IV rebranch ${branch} → ${other} keeps the completed run intact`);

      const C = await page.evaluate('C');
      for (const d of C.docs) await u.object(d.id);
      const run5 = runId(page);
      for (const l of C.links) await u.pair(...l.pair);
      await u.sel('#journal'); await u.sel('[data-puzzle]');
      for (const [i, f] of C.puzzle.fields.entries()) await page.locator(`[name="answer${i}"]`).selectOption(String(f.answer));
      await u.sel('#puzzleForm button[type="submit"]'); await u.sel('#finish');
      const before = await snapshot(page, run5); await u.sel('#restart'); await u.sel('#confirmRestart');
      assert.notEqual(runId(page), run5); assert.deepEqual(await snapshot(page, run5), before);
      pass(`chapter V restart keeps the previous completed state (${other})`);

      await page.goto(BASE + 'saves.html');
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]);
      const file = path.join(work, `progress-${branch}.json`); await download.saveAs(file);
      const exported = JSON.parse(fs.readFileSync(file, 'utf8')); assert.ok(exported.runs.length);
      const target = await browser.newContext(); const ip = await target.newPage(); await ip.goto(BASE + 'saves.html');
      await ip.locator('#import').setInputFiles(file);
      await ip.locator('#status').filter({hasText: 'Добавлено прохождений'}).waitFor();
      assert.equal(await ip.locator('.entry').count(), exported.runs.length);
      await ip.locator('.entry').filter({hasText: 'Сохранённые главы: 2, 3, 4, 5, 6, 7, 8'}).locator('a').last().click();
      await ip.locator('#resume').click(); await ip.locator('#review').click();
      assert.match(await text(ip, '#content'), /Берег остаётся городским/);
      pass(`file export/import restores the finished case (${branch})`);
      await target.close(); await context.close();
    }

    // Closing and relaunching the browser with the same on-disk profile keeps progress.
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'detective-profile-'));
    let ctx = await chromium.launchPersistentContext(profile, {viewport: {width: 390, height: 664}, isMobile: true, hasTouch: true});
    let page = ctx.pages()[0] || await ctx.newPage();
    let u = ui(page, true);
    await page.goto(BASE + 'index.html'); await u.sel('#enter');
    for (const o of ['report', 'notice']) await u.object(o);
    await u.pair('report', 'notice');
    await ctx.close();
    ctx = await chromium.launchPersistentContext(profile, {viewport: {width: 390, height: 664}, isMobile: true, hasTouch: true});
    page = ctx.pages()[0] || await ctx.newPage(); u = ui(page, true);
    await page.goto(BASE + 'index.html'); await u.sel('#resume');
    assert.equal(await text(page, '#clueCount'), '2'); assert.equal(await text(page, '#deductionCount'), '1 / 3 вывода');
    await ctx.close(); fs.rmSync(profile, {recursive: true, force: true});
    pass('progress survives closing and relaunching the browser (same profile)');

    // Direct entry without saved data, desktop and phone.
    for (const [w, h] of [[1440, 1000], [390, 844]]) {
      const context = await browser.newContext({viewport: {width: w, height: h}}); const p = await context.newPage(); const errors = []; p.on('pageerror', e => errors.push(String(e)));
      for (let n = 2; n <= 8; n++) {
        await p.goto(BASE + (n === 2 ? 'index.html' : `chapter${n}.html`));
        await p.locator(n === 3 ? '[data-start="station"]' : '#enter').click();
        await p.locator('#journal').click(); await p.keyboard.press('Escape');
        assert.ok(await p.evaluate('document.querySelector(".scene-frame img").naturalWidth') > 0);
      }
      assert.deepEqual(errors, []); pass(`direct start and journal in all seven chapters, ${w}×${h}`);
      await context.close();
    }

    // Legacy migration, corrupt record warning, and stale tab fork.
    let context = await browser.newContext(); page = await context.newPage(); await page.goto(BASE + 'saves.html');
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('last_case_chapter_3_v1', '{broken'); localStorage.setItem('last_case_chapter_2_v1', JSON.stringify({clues: ['report'], deductions: [], key: false, cabinet: false, finished: false, route: null})); });
    await page.goto(BASE + 'index.html'); await page.locator('#resume').click(); assert.equal(await text(page, '#clueCount'), '1');
    assert.match(await text(page, '[role="alert"]'), /повреждено/);
    assert.equal(await page.evaluate("localStorage.getItem('last_case_chapter_3_v1')"), '{broken');
    pass('legacy migration and corrupt record warning');
    const run = runId(page); const second = await context.newPage(); await second.goto(BASE + 'index.html?run=' + run); await second.locator('#resume').click();
    u = ui(page, false); const u2 = ui(second, false);
    await u.object('clock'); await u2.object('notice'); assert.notEqual(runId(page), runId(second));
    assert.deepEqual((await snapshot(page, run)).data.chapters['2'].clues, ['report', 'clock']);
    pass('stale second tab forks without losing either action');
    await context.close();

    context = await browser.newContext(); page = await context.newPage(); await page.goto(BASE + 'saves.html');
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('last_case_chapter_4_v1', JSON.stringify({clues: ['invoice', 'manifest', 'loading', 'departure', 'phone'], deductions: ['cargo', 'split'], crate: true, plan: 'belov', finished: 'belov', seenOutcomes: ['belov'], started: true}));
      localStorage.setItem('archive_case_chapter_5_v1', JSON.stringify({branch: 'originals', clues: ['schedule'], deductions: [], answers: [], solved: false, finished: false, started: true}));
    });
    await page.goto(BASE + 'chapter5.html'); await page.locator('#resume').click();
    assert.equal(await page.evaluate('branch'), 'originals'); assert.equal(await text(page, '#clueCount'), '1');
    pass('mixed legacy IV/V branches recover the late-chapter progress');
    const original = await snapshot(page, runId(page));
    await page.evaluate(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k.startsWith('detective:saves:v2:revision:')) throw new DOMException('Quota', 'QuotaExceededError'); return set.call(this, k, v); }; });
    await ui(page, false).object('calls'); assert.match(await text(page, '[role="alert"]'), /Прогресс не записан/);
    assert.deepEqual(await snapshot(page, runId(page)), original);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[role="alert"] button').click()]);
    const emergency = path.join(work, 'progress-emergency.json'); await dl.saveAs(emergency);
    assert.deepEqual(JSON.parse(fs.readFileSync(emergency, 'utf8')).runs[0].data.chapters['5'].clues, ['schedule', 'calls']);
    pass('storage-full warning and emergency export keep unsaved progress');
    await context.close();
  } finally {
    await browser.close(); server.close();
    fs.writeFileSync(path.join(work, 'browser-results.json'), JSON.stringify(results, null, 2) + '\n');
  }
  console.log(`${results.length} browser checks passed`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
