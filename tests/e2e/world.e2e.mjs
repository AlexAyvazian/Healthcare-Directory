/* Browser acceptance tests (Playwright + Chromium) against the built static site in dist/.
 * Run `npm run build` first, then `npm run test:e2e`. Scenarios marked LIVE call the real
 * international Neon Data API (empty database) and geoBoundaries; scenarios marked FIXTURE
 * intercept the Data API with synthetic, clearly labelled records (never written to Neon). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {COUNTRIES} from '../../assets/js/world-catalog.js';
import {respond as fixtureResponse} from '../fixtures/world-facilities.fixture.mjs';
import {WORLD_PALETTE} from '../../scripts/world-palette.mjs';
import {COUNTRY_COLOR_ORDER} from '../../scripts/world-country-order.mjs';

const {chromium} = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const dist = join(root, 'dist');
const shots = process.env.E2E_SCREENSHOTS || join(root, 'test-results');
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/geo+json'};

let server, base, browser;
test.before(async () => {
  await stat(join(dist, 'world.html')); // build first
  await mkdir(shots, {recursive: true});
  server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(dist, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
    try {
      const info = await stat(file);
      res.writeHead(200, {'content-type': TYPES[extname(file)] || 'application/octet-stream', 'content-length': info.size});
      createReadStream(file).pipe(res);
    } catch { res.writeHead(404).end('not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
test.after(async () => { await browser?.close(); server?.close(); });

async function open(path = '/world.html', options = {}) {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, ...options});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(base + path);
  if (path.startsWith('/world')) await page.waitForSelector('body[data-ready=true]', {timeout: 30000});
  return {page, context, errors};
}
async function useFixtures(page, {delayFor = null, delayMs = 0} = {}) {
  await page.route('**/neondb/auth/token/anonymous', route => route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'},
    body: JSON.stringify({token: 'e30.' + Buffer.from(JSON.stringify({role: 'anonymous', exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url') + '.fixture'})}));
  await page.route('**/neondb/rest/v1/category_counts**', route => route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'},
    body: JSON.stringify([{category: 'clinic', total: 26}, {category: 'hospital', total: 26}, {category: 'pharmacy', total: 26}])}));
  await page.route('**/neondb/rest/v1/facilities**', async route => {
    const url = route.request().url();
    if (delayFor && url.includes(delayFor)) await new Promise(r => setTimeout(r, delayMs));
    await route.fulfill(fixtureResponse(url));
  });
}
const pinCount = page => page.locator('#mapSvg circle, #mapSvg image, #mapSvg use, #mapSvg text, #mapSvg [class*=pin], #mapSvg [class*=marker], #mapSvg [class*=dot]').count();
const regionPath = (page, level, name) => page.locator(`g.level-${level} path.region[aria-label^="${name},"]`);
async function selectCountryByChip(page, name) {
  await page.fill('#regionFilter', name);
  await page.locator('#regionList .chip', {hasText: new RegExp('^' + name + '$')}).first().click();
}

test('UX-01 existing U.S. state → county map still works and links to the international directory', async () => {
  const {page, context, errors} = await open('/');
  await page.waitForSelector('path.state');
  assert.ok(await page.locator('path.state').count() >= 50);
  await page.locator('path.state[aria-label="California"]').click();
  await page.waitForSelector('path.county');
  assert.ok(await page.locator('path.county').count() > 50);
  assert.match(await page.textContent('#breadcrumb'), /California/);
  await page.click('a.toplink');
  await page.waitForURL('**/world.html');
  assert.deepEqual(errors, []);
  await context.close();
});

test('UX-02/03/11/12 world overview: country polygons, deterministic colours, country-specific glow, no pins (LIVE)', async () => {
  const {page, context, errors} = await open();
  assert.equal(await page.locator('path.country').count(), 241);
  assert.equal(await pinCount(page), 0);
  const fill = iso3 => page.locator(`path.country[data-iso3=${iso3}]`).first().evaluate(el => getComputedStyle(el).fill);
  assert.equal(await fill('CAN'), 'rgb(236, 254, 255)');
  assert.equal(await fill('MEX'), 'rgb(116, 203, 245)');
  assert.equal(await fill('GTM'), 'rgb(101, 168, 229)');
  assert.equal(await fill('USA'), 'rgb(74, 83, 99)', 'United States is muted grey');
  await page.screenshot({path: join(shots, '01-world.png')});
  await page.locator('path.country[data-iso3=CAN]').hover();
  await page.waitForTimeout(250);
  const canFilter = await page.locator('path.country[data-iso3=CAN]').evaluate(el => getComputedStyle(el).filter);
  assert.match(canFilter, /drop-shadow\(rgb\(236, 254, 255\)/, 'Canada glows in its own colour');
  await page.screenshot({path: join(shots, '02-hover-canada.png')});
  await page.locator('path.country[data-iso3=BRA]').hover();
  await page.waitForTimeout(250);
  const braFilter = await page.locator('path.country[data-iso3=BRA]').evaluate(el => getComputedStyle(el).filter);
  const bra = COUNTRIES.find(c => c.iso3 === 'BRA').states.glow;
  const rgb = [1, 3, 5].map(i => parseInt(bra.slice(i, i + 2), 16)).join(', ');
  assert.ok(braFilter.includes(`rgb(${rgb})`), `Brazil glows in its own colour (${braFilter})`);
  await page.reload();
  await page.waitForSelector('body[data-ready=true]');
  assert.equal(await fill('CAN'), 'rgb(236, 254, 255)', 'colours stable across reloads');
  // Every rendered country is filled with its own entry in the 25×10 palette sequence.
  const toRgb = h => `rgb(${[1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
  const flat = Object.values(WORLD_PALETTE).flat();
  const expected = new Map(COUNTRY_COLOR_ORDER.filter(iso3 => iso3 !== 'ATA').map((iso3, i) => [iso3, toRgb(flat[i])]));
  expected.set('USA', 'rgb(74, 83, 99)');
  expected.set('ATA', 'rgb(244, 248, 252)'); // Antarctica: fixed ice-white special case
  const rendered = await page.$$eval('path.country', els => els.map(e => [e.dataset.iso3, getComputedStyle(e).fill]));
  assert.equal(rendered.length, 241);
  const wrong = rendered.filter(([iso3, f]) => expected.get(iso3) !== f);
  assert.deepEqual(wrong, [], 'rendered fills follow the palette sequence');
  assert.equal(new Set(rendered.filter(([iso3]) => iso3 !== 'USA' && iso3 !== 'ATA').map(([, f]) => f)).size, 238, '238 distinct numbered country colours');
  assert.ok(rendered.some(([iso3, f]) => iso3 === 'AUS' && f === toRgb(WORLD_PALETTE.purple[4])), 'Australia renders Purple 5');
  // No visible globe outline: the sphere has neither stroke nor fill.
  const sphere = await page.locator('path.sphere').evaluate(el => ({stroke: getComputedStyle(el).stroke, fill: getComputedStyle(el).fill}));
  assert.deepEqual(sphere, {stroke: 'none', fill: 'none'});
  assert.deepEqual(errors, []);
  await context.close();
});

test('UX-04/05/06/10/11 Canada → British Columbia → Alberta with a scrollable, filterable sidebar (FIXTURE data)', async () => {
  const {page, context, errors} = await open();
  await useFixtures(page, {delayFor: 'CA-BC', delayMs: 1500});
  await page.evaluate(() => { window.__sameDocument = true; });
  const canadaResponse = page.waitForResponse(r => r.url().endsWith('/geo/gbOpen/CAN/ADM1/geoBoundaries-CAN-ADM1_simplified.geojson'));
  await page.locator('path.country[data-iso3=CAN]').click();
  const response = await canadaResponse;
  assert.equal(Number(response.headers()['content-length']), 26022306, 'Canada loads the original file');
  await page.waitForSelector('g.level-0 path.region');
  assert.equal(await page.locator('g.level-0 path.region').count(), 13);
  assert.equal(await page.textContent('#panelTitle'), 'Canada');
  // Stale-request guard: BC's response is delayed; Alberta is chosen before it arrives.
  await regionPath(page, 0, 'British Columbia').click();
  await page.waitForTimeout(150);
  await regionPath(page, 0, 'Alberta').click();
  await page.waitForSelector('#facilityList .facility');
  await page.waitForTimeout(1800);
  const albertaCards = await page.locator('#facilityList .facility h3').allTextContents();
  assert.equal(albertaCards.length, 3);
  assert.ok(albertaCards.every(t => t.includes('Alberta')), 'no stale British Columbia cards');
  assert.equal(await page.textContent('#panelTitle'), 'Alberta');
  // British Columbia: 75 fixture records → 50 + incremental load of 25.
  await regionPath(page, 0, 'British Columbia').click();
  await page.waitForFunction(() => document.querySelectorAll('#facilityList .facility').length === 50, null, {timeout: 15000});
  assert.equal(await page.getAttribute('g.level-0 path.region[aria-label^="British Columbia,"]', 'aria-pressed'), 'true');
  assert.match(await page.textContent('#listLabel'), /Showing 50 of 75/);
  assert.match(await page.textContent('#selectionCount'), /75 healthcare facilities/);
  const scroll = await page.locator('#facilityList').evaluate(el => ({scrollHeight: el.scrollHeight, clientHeight: el.clientHeight}));
  assert.ok(scroll.scrollHeight > scroll.clientHeight, 'facility cards scroll vertically');
  await page.waitForSelector('g.level-1 path.region'); // census divisions inside BC
  await page.waitForTimeout(900);
  await page.screenshot({path: join(shots, '03-british-columbia-fixture.png')});
  await page.click('#loadMore');
  await page.waitForFunction(() => document.querySelectorAll('#facilityList .facility').length === 75);
  assert.equal(await page.isHidden('#loadMore'), true);
  await page.selectOption('#category', 'pharmacy');
  await page.waitForFunction(() => document.querySelectorAll('#facilityList .facility').length === 25);
  await page.fill('#search', 'Facility 03');
  await page.waitForFunction(() => document.querySelectorAll('#facilityList .facility').length === 1);
  await page.locator('#facilityList .facility').first().click();
  assert.equal(await page.isVisible('#drawer'), true);
  assert.match(await page.textContent('#drawerBody'), /FIXTURE British Columbia Test Facility 03/);
  await page.waitForTimeout(450); // drawer entrance animation
  await page.screenshot({path: join(shots, '04-record-drawer-fixture.png')});
  await page.keyboard.press('Escape');
  assert.equal(await page.isHidden('#drawer'), true);
  await page.fill('#search', 'no such facility');
  await page.waitForSelector('#facilityList .empty');
  assert.match(await page.textContent('#facilityList'), /No published facilities match/);
  assert.equal(await page.evaluate(() => window.__sameDocument), true, 'no page reload');
  assert.equal(await pinCount(page), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('UX-05/16 live empty international database shows a true empty state for British Columbia (LIVE)', async () => {
  const {page, context, errors} = await open('/world.html#/CAN');
  await page.waitForSelector('g.level-0 path.region');
  const request = page.waitForRequest(r => r.url().includes('/rest/v1/facilities') && r.url().includes('CA-BC'));
  await regionPath(page, 0, 'British Columbia').click();
  const sent = new URL((await request).url());
  assert.equal(sent.searchParams.get('country_iso3'), 'eq.CAN');
  await page.waitForSelector('#facilityList .empty');
  assert.match(await page.textContent('#facilityList'), /No healthcare facilities have been published for British Columbia yet/);
  assert.equal(await page.textContent('#statFacilities'), '0');
  await page.waitForTimeout(1200);
  await page.screenshot({path: join(shots, '05-british-columbia-live-empty.png')});
  assert.deepEqual(errors, []);
  await context.close();
});

test('UX-07 Mexico loads states, then municipalities inside the selected state (LIVE geometry)', async () => {
  const {page, context, errors} = await open();
  await selectCountryByChip(page, 'Mexico');
  await page.waitForSelector('g.level-0 path.region');
  assert.equal(await page.locator('g.level-0 path.region').count(), 32);
  const jalisco = page.locator('g.level-0 path.region[aria-label*="Jalisco"]');
  await jalisco.click();
  await page.waitForSelector('g.level-1 path.region', {timeout: 60000});
  const municipalities = await page.locator('g.level-1 path.region').count();
  assert.ok(municipalities > 100 && municipalities < 160, `Jalisco municipalities: ${municipalities}`);
  await page.waitForTimeout(900);
  await page.screenshot({path: join(shots, '06-mexico-jalisco-municipalities.png')});
  await page.locator('#regionList .chip').first().click();
  await page.waitForFunction(() => document.getElementById('modeBadge').textContent === 'Municipality');
  assert.equal(await page.isHidden('#panelMeta'), true, 'no instructional text under the title');
  // No breadcrumb bar: clicking empty sea goes back up one level (municipality → Jalisco).
  const box = await page.locator('#mapShell').boundingBox();
  const sea = await page.evaluate(({x, y, w, h}) => {
    for (let fy = .05; fy < .95; fy += .05) for (let fx = .05; fx < .95; fx += .05) {
      const t = document.elementFromPoint(x + w * fx, y + h * fy);
      if (t && !t.closest('path.country:not(.hidden), path.region, .mapLabel')) return [x + w * fx, y + h * fy];
    }
    return null;
  }, {x: box.x, y: box.y, w: box.width, h: box.height});
  assert.ok(sea, 'found empty sea to click');
  await page.mouse.click(sea[0], sea[1]);
  await page.waitForFunction(() => document.getElementById('panelTitle').textContent === 'Jalisco');
  assert.equal(await pinCount(page), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('COLOR-04 Antarctica is ice-white; colours stay correct after hovering then selecting (LIVE)', async () => {
  const {page, context, errors} = await open();
  const toRgb = h => `rgb(${[1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
  const expected = new Map(COUNTRIES.map(c => [c.iso3, c.color ? toRgb(c.color) : 'rgb(74, 83, 99)']));
  for (const iso3 of ['BRA', 'CHN', 'ATA', 'AUS', 'RUS', 'CAN']) await page.locator(`path.country[data-iso3=${iso3}]`).first().hover({force: true});
  await page.mouse.move(2, 2);
  await selectCountryByChip(page, 'Antarctica');
  await page.waitForFunction(() => document.getElementById('panelTitle').textContent === 'Antarctica');
  await page.waitForTimeout(1300);
  const ata = await page.locator('path.country[data-iso3=ATA]').evaluate(el => ({cls: el.getAttribute('class'), fill: getComputedStyle(el).fill, filter: getComputedStyle(el).filter}));
  assert.equal(ata.cls, 'country selected');
  assert.equal(ata.fill, 'rgb(255, 255, 255)', 'selected Antarctica is white');
  assert.match(ata.filter, /drop-shadow\(rgb\(159, 212, 255\)/, 'cool blue selection glow');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('panelTitle').textContent === 'World');
  await page.waitForTimeout(1300);
  const rendered = await page.$$eval('path.country', els => els.map(e => [e.dataset.iso3, getComputedStyle(e).getPropertyValue('--fill').trim()]));
  const wrong = rendered.filter(([iso3, f]) => toRgb(f) !== expected.get(iso3));
  assert.deepEqual(wrong, [], 'every path keeps its own colour variables after hover + re-render');
  assert.equal(await page.locator('path.country[data-iso3=ATA]').evaluate(el => getComputedStyle(el).fill), 'rgb(244, 248, 252)', 'idle Antarctica is ice-white');
  assert.deepEqual(errors, []);
  await context.close();
});

test('COLOR-03 subdivisions are distinguishable shades; level names read correctly (LIVE geometry)', async () => {
  const {page, context, errors} = await open();
  await selectCountryByChip(page, 'Germany');
  await page.waitForSelector('g.level-0 path.region');
  const fills = await page.$$eval('g.level-0 path.region', els => els.map(e => getComputedStyle(e).fill));
  assert.equal(fills.length, 16);
  assert.equal(new Set(fills).size, 16, `German federal states use distinct shades (${new Set(fills).size})`);
  await page.locator('#mapShell').focus().catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('panelTitle').textContent === 'World');
  await selectCountryByChip(page, 'Japan');
  await page.waitForSelector('g.level-0 path.region', {timeout: 60000});
  await page.waitForFunction(() => /47 prefectures/.test(document.getElementById('mapLabel').textContent));
  assert.match(await page.textContent('#mapLabel'), /^Japan · 47 prefectures · /);
  assert.match(await page.textContent('#regionLabel'), /^Prefecture \(47\)/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('GEO-02 a non-bundled country loads its pinned geoBoundaries file from the source commit (LIVE)', async () => {
  const {page, context, errors} = await open();
  const remote = page.waitForResponse(r => r.url().includes('media.githubusercontent.com/media/wmgeolab/geoBoundaries/') && r.url().endsWith('FRA-ADM1_simplified.geojson'));
  await selectCountryByChip(page, 'France');
  assert.equal((await remote).status(), 200);
  await page.waitForSelector('g.level-0 path.region', {timeout: 60000});
  assert.equal(await page.locator('g.level-0 path.region').count(), 13);
  assert.deepEqual(errors, []);
  await context.close();
});

test('UX-08 a country without published subdivisions fails gracefully (no fabricated shapes)', async () => {
  const country = COUNTRIES.find(c => !c.redirect && !c.noDirectory && !c.levels.length && c.numeric);
  const {page, context, errors} = await open();
  await selectCountryByChip(page, country.name);
  await page.waitForFunction(name => document.getElementById('panelTitle').textContent === name, country.name);
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('path.region').count(), 0);
  assert.match(await page.textContent('#panelMeta'), /publishes no subdivision boundaries/);
  assert.match(await page.textContent('#regionLabel'), /No subdivision boundaries/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('UX-09 the United States on the world map opens the existing U.S. directory', async () => {
  const {page, context} = await open();
  await page.locator('path.country[data-iso3=USA]').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(base + '/');
  await page.waitForSelector('path.state');
  await context.close();
});

test('UX-12 keyboard: select country and region with Enter, go back with Escape', async () => {
  const {page, context, errors} = await open();
  await useFixtures(page);
  await page.locator('path.country[data-iso3=CAN]').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('g.level-0 path.region');
  await regionPath(page, 0, 'Alberta').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('panelTitle').textContent === 'Alberta');
  await page.locator('#facilityList').focus();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('panelTitle').textContent === 'Canada');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('panelTitle').textContent === 'World');
  await page.goBack();
  await page.waitForFunction(() => document.getElementById('panelTitle').textContent === 'Canada');
  assert.deepEqual(errors, []);
  await context.close();
});

test('UX-13 mobile layout: map selection and scrolling facility cards remain usable', async () => {
  const {page, context, errors} = await open('/world.html', {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2});
  await useFixtures(page);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow');
  await page.screenshot({path: join(shots, '07-mobile-world.png')});
  await page.locator('path.country[data-iso3=CAN]').tap();
  await page.waitForSelector('g.level-0 path.region');
  await regionPath(page, 0, 'British Columbia').tap();
  await page.waitForFunction(() => document.querySelectorAll('#facilityList .facility').length === 50, null, {timeout: 15000});
  const scroll = await page.locator('#facilityList').evaluate(el => ({scrollHeight: el.scrollHeight, clientHeight: el.clientHeight}));
  assert.ok(scroll.scrollHeight > scroll.clientHeight);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.waitForTimeout(900);
  await page.screenshot({path: join(shots, '08-mobile-british-columbia-fixture.png')});
  assert.deepEqual(errors, []);
  await context.close();
});

test('SEC-01 public pages expose no upload, download, export, or admin controls', async () => {
  for (const path of ['/', '/world.html']) {
    const {page, context} = await open(path);
    if (path === '/world.html') { await useFixtures(page); await page.locator('path.country[data-iso3=CAN]').click(); await page.waitForSelector('g.level-0 path.region'); await regionPath(page, 0, 'Alberta').click(); await page.waitForSelector('#facilityList .facility'); }
    assert.equal(await page.locator('input[type=file], a[download], form').count(), 0);
    const text = (await page.locator('body').innerText()).toLowerCase();
    assert.doesNotMatch(text, /\b(upload|download|export|import data|admin)\b/);
    await context.close();
  }
});
