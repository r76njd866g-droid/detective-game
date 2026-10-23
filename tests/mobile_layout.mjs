// Narrow-screen layout audit for chapters II–VIII (dev tool, Chromium touch emulation).
// Checks: no horizontal overflow, header/nav fit the viewport, every hotspot is inside
// the viewport, its centre is not covered by another element, and hotspots do not overlap.
// Usage: node tests/mobile_layout.mjs [--shots dir]
import fs from 'node:fs';
import {serve, playwright} from './lib/server.mjs';

export const VIEWPORTS = [
  ['iPhone SE 1', 320, 568], ['Galaxy S8', 360, 740], ['Android narrow', 360, 800], ['iPhone SE 2', 375, 667],
  ['iPhone 13', 390, 664], ['iPhone 14 Pro Max', 430, 932], ['Pixel 7', 412, 839], ['iPad mini', 768, 1024],
  ['SE landscape', 568, 320], ['iPhone 13 landscape', 844, 390], ['Pixel landscape', 839, 412],
  ['Laptop', 1024, 700], ['Desktop', 1440, 900]
];
const PAGES = [
  ['index.html', null], ['chapter3.html', 'station'], ['chapter3.html', 'hotel'], ['chapter4.html', null],
  ['chapter5.html', null], ['chapter6.html', null], ['chapter7.html', null], ['chapter8.html', null]
];

const AUDIT = ({vw, vh}) => {
  // Compare with the configured viewport: innerWidth itself grows when content overflows.
  const problems = [];
  if (innerWidth > vw) problems.push(`layout viewport widened to ${innerWidth}px by overflowing content`);
  const frame = document.querySelector('.scene-frame'), fr = frame.getBoundingClientRect();
  if (Math.abs(fr.width / fr.height - 1.5) > 0.04) problems.push(`scene distorted: ${fr.width.toFixed(0)}×${fr.height.toFixed(0)}`);
  if (fr.bottom > vh + 1 || fr.right > vw + 1) problems.push('scene does not fit on screen');
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const name = el => el.dataset.object || el.id || el.className || el.tagName;
  if (document.documentElement.scrollWidth > vw + 1) problems.push(`horizontal overflow ${document.documentElement.scrollWidth}px > ${vw}px`);
  for (const el of document.querySelectorAll('.game-header *, .chapter-nav *, .place-nav *')) {
    if (!visible(el) || el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 0.5 || r.left < -0.5) problems.push(`header element "${(el.textContent || name(el)).trim().slice(0, 30)}" outside viewport (${r.left.toFixed(1)}–${r.right.toFixed(1)})`);
  }
  for (const el of document.querySelectorAll('.game-header button, .game-header a, .chapter-nav button, .chapter-nav a, .place-nav button, .place-nav a')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (!(hit === el || el.contains(hit))) problems.push(`control "${el.textContent.trim().slice(0, 25)}" covered by ${hit ? name(hit) : 'nothing'}`);
    if (Math.min(r.width, r.height) < 32) problems.push(`control "${el.textContent.trim().slice(0, 25)}" too small ${r.width.toFixed(0)}×${r.height.toFixed(0)}`);
  }
  const spots = [...document.querySelectorAll('.hotspot')].filter(el => visible(el) && !el.closest('[hidden]'));
  const rects = spots.map(el => el.getBoundingClientRect());
  spots.forEach((el, i) => {
    const r = rects[i], cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) problems.push(`hotspot ${name(el)} outside viewport`);
    const hit = document.elementFromPoint(Math.min(Math.max(cx, 0), vw - 1), Math.min(Math.max(cy, 0), vh - 1));
    if (!(hit === el || el.contains(hit))) problems.push(`hotspot ${name(el)} centre covered by ${hit ? name(hit) : 'nothing'}`);
    let own = 0;
    for (let x = 1; x < 10; x++) for (let y = 1; y < 10; y++) { const h = document.elementFromPoint(r.x + r.width * x / 10, r.y + r.height * y / 10); if (h === el || el.contains(h)) own++; }
    if (own < 49) problems.push(`hotspot ${name(el)} only ${Math.round(own / 81 * 100)}% of its area is tappable`);
    if (Math.min(r.width, r.height) < 10) problems.push(`hotspot ${name(el)} tiny ${r.width.toFixed(0)}×${r.height.toFixed(0)}`);
    for (let j = i + 1; j < spots.length; j++) {
      const q = rects[j], w = Math.min(r.right, q.right) - Math.max(r.left, q.left), h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
      if (w > 1 && h > 1) problems.push(`hotspots ${name(el)} and ${name(spots[j])} overlap ${w.toFixed(0)}×${h.toFixed(0)}`);
    }
  });
  return {problems, hotspots: spots.map(name)};
};

const MODAL_AUDIT = () => {
  const m = document.querySelector('.modal.open [role=dialog]');
  if (!m) return ['modal did not open'];
  const r = m.getBoundingClientRect(), out = [];
  if (r.left < -1 || r.top < -1 || r.bottom > innerHeight + 1 || r.right > innerWidth + 1) out.push(`modal outside viewport ${r.width.toFixed(0)}×${r.height.toFixed(0)}`);
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push('horizontal overflow with modal');
  const close = m.querySelector('[data-close]');
  if (close) { const c = close.getBoundingClientRect(); if (c.right > r.right + 1) out.push('close button clipped'); }
  return out;
};

export async function enter(page, file, scene, problems = [], touch = true) {
  const button = page.locator(file === 'chapter3.html' ? `[data-start="${scene}"]` : '#enter');
  try { await (touch ? button.tap({timeout: 3000}) : button.click({timeout: 3000})); }
  catch { problems.push('intro start button cannot be tapped (outside viewport / not scrollable)'); await button.dispatchEvent('click'); }
  await page.locator('#game').waitFor({state: 'visible'});
}

async function main() {
  const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
  if (shots) fs.mkdirSync(shots, {recursive: true});
  const {chromium} = await playwright();
  const {server, base} = await serve();
  const browser = await chromium.launch();
  const failures = [];
  let checked = 0;
  try {
    for (const [device, width, height] of VIEWPORTS) {
      const context = await browser.newContext({viewport: {width, height}, isMobile: width < 1000 && (width < 700 || height < 450), hasTouch: width < 1000, deviceScaleFactor: 2});
      for (const [file, scene] of PAGES) {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(base + file);
        const introProblems = [];
        await enter(page, file, scene, introProblems, width < 1000);
        await page.waitForTimeout(150);
        const {problems, hotspots} = await page.evaluate(AUDIT, {vw: width, vh: height});
        problems.unshift(...introProblems);
        // Real taps on every hotspot centre must open that object's dialog.
        for (const id of hotspots) {
          const loc = page.locator(`.hotspot[data-object="${id}"]:visible`).first();
          const box = await loc.boundingBox();
          if (width < 1000) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          const open = page.locator('.modal.open');
          if (!(await open.count())) { problems.push(`tap on ${id} opened nothing`); continue; }
          problems.push(...(await page.evaluate(MODAL_AUDIT)).map(p => `${id}: ${p}`));
          await page.keyboard.press('Escape');
          await page.locator('.modal.open').waitFor({state: 'detached', timeout: 1000}).catch(() => {});
        }
        await (width < 1000 ? page.locator('#journal').tap() : page.locator('#journal').click());
        problems.push(...(await page.evaluate(MODAL_AUDIT)).map(p => `journal: ${p}`));
        await page.keyboard.press('Escape');
        if (shots) await page.screenshot({path: `${shots}/${device.replace(/\W+/g, '_')}-${file.replace('.html', '')}${scene ? '-' + scene : ''}.png`});
        problems.push(...errors.map(e => 'JS error: ' + e));
        checked++;
        for (const p of problems) failures.push(`${device} ${width}×${height} ${file}${scene ? ' [' + scene + ']' : ''}: ${p}`);
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures.length ? failures.map(f => 'FAIL: ' + f).join('\n') : 'PASS: no overlaps or clipping');
  console.log(`${checked} screens checked on ${VIEWPORTS.length} viewports, ${failures.length} problems`);
  process.exitCode = failures.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
