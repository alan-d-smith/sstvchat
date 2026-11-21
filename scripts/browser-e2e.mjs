// Browser end-to-end check of the real audio path: Chromium's fake microphone plays a recording
// made by scripts/make-wav.mjs (alice → bob: a text, then a snap) into the app on the Vite dev
// server (in-memory /api/claim and /api/users).
//   1. as "bob":   a new "alice" chat appears receiving, the text arrives, the snap finishes and
//                  opens (screenshot); Chrome loops the file, and the repeat must not add messages
//                  (Radio details logs it as "ignored: repeat").
//   2. as "carol": nothing is received.
// Neither may see the "can't decode" hint. Each run logs the AudioContext clock against wall time:
// well under 100% means the machine starved Chrome's audio and dropped mic samples.
//
// Usage: node scripts/browser-e2e.mjs [outDir] [--headed]
// Needs Playwright with Chromium: the `playwright` package, PLAYWRIGHT_MODULE=<path to it>, or a
// global `@playwright/cli` install.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const outDir = resolve(args.find((a) => !a.startsWith('--')) ?? join(tmpdir(), 'sstvchat-e2e'));
mkdirSync(outDir, { recursive: true });

const FROM = 'alice';
const TEXT = 'hello bob, this came over the air';

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const globalCli = process.env.APPDATA && join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright');
  for (const id of [process.env.PLAYWRIGHT_MODULE, 'playwright', globalCli]) {
    if (!id || (id.includes('/') && !existsSync(id))) continue;
    try {
      return require(id);
    } catch {
      /* next */
    }
  }
  throw new Error('Playwright not found: npm i -D playwright, or set PLAYWRIGHT_MODULE');
}

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

execFileSync(process.execPath, ['scripts/make-wav.mjs', outDir, '--from', FROM, '--to', 'bob', '--text', TEXT], { stdio: 'inherit' });
const WAV = join(outDir, 'both.wav');
const WAV_SECONDS = (statSync(WAV).size - 44) / 2 / 48000;

const { chromium } = loadPlaywright();
const server = await createServer({ logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
log('dev server', url);

/** Chats as the app saved them. */
const savedChats = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('sstv.chats') ?? '[]'));
const rows = (page) =>
  page.$$eval('.chat-row', (els) => els.map((e) => `${e.querySelector('.chat-row__name')?.textContent} | ${e.querySelector('.status-line')?.textContent}`));

/** Playwright's own Chromium; if that build is not downloaded, CHROMIUM_PATH, another downloaded build or Chrome. */
async function launch(options) {
  try {
    return await chromium.launch(options);
  } catch (e) {
    if (!/Executable doesn't exist/.test(String(e))) throw e;
  }
  const root = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright');
  const builds = root && existsSync(root)
    ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => join(root, d, 'chrome-win64', 'chrome.exe'))
    : [];
  const executablePath = [process.env.CHROMIUM_PATH, ...builds].find((p) => p && existsSync(p));
  if (executablePath) return chromium.launch({ ...options, executablePath });
  return chromium.launch({ ...options, channel: 'chrome' });
}

async function session(user) {
  const browser = await launch({
    headless: !headed,
    // Playwright mutes audio by default. Muted Chromium renders Web Audio on a timer that falls
    // behind under load, so the mic FIFO overflows and drops samples (snap lines turn to noise).
    // With a real output device the AudioContext keeps real time, as on users' machines.
    ignoreDefaultArgs: ['--mute-audio'],
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${WAV}`,
      '--autoplay-policy=user-gesture-required',
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Test-side tap: an analyser on the mic records its level every 250 ms, to see when the
  // recording plays (and whether Chrome loops it).
  await context.addInitScript(() => {
    const create = AudioContext.prototype.createMediaStreamSource;
    AudioContext.prototype.createMediaStreamSource = function (stream) {
      const src = create.call(this, stream);
      const an = this.createAnalyser();
      an.fftSize = 2048;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      window.__micLevels = [];
      window.__clock = [];
      setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let e = 0;
        for (const v of buf) e += v * v;
        window.__micLevels.push([performance.now() / 1000, Math.sqrt(e / buf.length)]);
        window.__clock.push([performance.now() / 1000, this.currentTime]);
      }, 250);
      return src;
    };
    // Main-thread stalls (the receiver runs there): longest gap between 50 ms ticks.
    window.__stall = 0;
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      window.__stall = Math.max(window.__stall, now - last - 50);
      last = now;
    }, 50);
  });
  const page = await context.newPage();
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`pageerror: ${e.message}`));
  await page.goto(url);
  await page.getByRole('textbox', { name: 'Username' }).fill(user);
  await page.getByRole('button', { name: 'Continue' }).click();
  const pill = page.locator('.radio-pill');
  await pill.waitFor();
  // The mic starts right after the claim; if the browser wanted another gesture, this is the first click.
  await sleep(1500);
  if (/Mic off|blocked|error/i.test(await pill.textContent())) await pill.click();
  await page.waitForFunction(() => /Listening/.test(document.querySelector('.radio-pill')?.textContent ?? ''), null, { timeout: 10000 });
  log(user, 'radio:', await pill.textContent());
  const start = Date.now();
  const before = await savedChats(page);
  return { browser, page, consoleLines, start, before, elapsed: () => (Date.now() - start) / 1000 };
}

/** Stretches (seconds since the first sample) where the mic heard signal, from the level tap. */
async function heardSpans(page) {
  const levels = await page.evaluate(() => window.__micLevels ?? []);
  const spans = [];
  for (const [t, rms] of levels) {
    const loud = rms > 0.05;
    const cur = spans.at(-1);
    if (loud && cur && t - cur[1] < 1.5) cur[1] = t;
    else if (loud) spans.push([t, t]);
  }
  const t0 = levels[0]?.[0] ?? 0;
  return spans.map(([a, b]) => [+(a - t0).toFixed(1), +(b - t0).toFixed(1)]);
}

/** How fast the AudioContext clock ran against wall time, and the longest main-thread stall. */
async function health(page) {
  const { clock, stall } = await page.evaluate(() => ({ clock: window.__clock ?? [], stall: window.__stall ?? 0 }));
  if (clock.length < 2) return 'no audio clock samples';
  const [w0, c0] = clock[0];
  const [w1, c1] = clock.at(-1);
  return `audio clock ${((100 * (c1 - c0)) / (w1 - w0)).toFixed(1)}% of real time over ${(w1 - w0).toFixed(0)} s, longest main-thread stall ${stall.toFixed(0)} ms`;
}

const failures = [];
const check = (ok, what) => {
  log(ok ? 'PASS' : 'FAIL', what);
  if (!ok) failures.push(what);
};

async function asBob() {
  const s = await session('bob');
  const { page } = s;
  let seenReceiving = false;
  let textAt = null;
  let snapAt = null;
  let last = '';
  let hintSeen = false;
  while (s.elapsed() < WAV_SECONDS + 15 && !(textAt && snapAt)) {
    if (await page.locator('.radio-hint').count()) hintSeen = true;
    const r = await rows(page);
    const alice = r.find((x) => x.startsWith(`${FROM} |`));
    const shown = alice?.replace(/ · \d+%/, (m) => (Number(m.slice(3, -1)) % 25 < 2 ? m : ''));
    if (alice && shown !== last) {
      log(`t=${s.elapsed().toFixed(1)}s`, alice);
      last = shown;
    }
    if (alice && /Receiving/.test(alice)) seenReceiving = true;
    const chat = (await savedChats(page)).find((c) => c.id === FROM);
    const text = chat?.messages.find((m) => m.type === 'text' && m.senderId === FROM && m.text === TEXT);
    if (text && !textAt) textAt = s.elapsed();
    if (chat?.messages.some((m) => m.type === 'snap' && m.imageId) && !snapAt) snapAt = s.elapsed();
    await sleep(500);
  }
  check(seenReceiving, `bob: a new "${FROM}" chat showed Receiving`);
  check(textAt !== null, `bob: text arrived (${textAt?.toFixed(1)} s)`);
  check(snapAt !== null, `bob: snap finished and was saved (${snapAt?.toFixed(1)} s)`);
  log('bob:', await health(page));
  check(!hintSeen, 'bob: no "can’t decode" hint while a good text and snap arrive');
  const dismiss = page.getByRole('button', { name: 'Dismiss hint' });
  if (await dismiss.count()) await dismiss.click();

  // The text shows in the alice chat (and nowhere else).
  await page.locator('.chat-row', { hasText: FROM }).first().click();
  const shownText = await page.getByText(TEXT).count();
  check(shownText === 1, `bob: text shown once in the ${FROM} chat`);
  await page.screenshot({ path: join(outDir, 'bob-chat.png') });
  // Opening it: the viewer shows the saved image.
  if (!(await page.locator('.snap-canvas').count())) await page.locator('.snap-tile.is-new').first().click().catch(() => {});
  const viewer = page.locator('.snap-canvas');
  check((await viewer.count()) > 0, 'bob: the snap opens in the viewer');
  await sleep(500);
  await page.screenshot({ path: join(outDir, 'bob-snap.png') });
  if (await viewer.count()) await viewer.screenshot({ path: join(outDir, 'bob-snap-only.png') });
  const colours = await page.evaluate(() => {
    const c = document.querySelector('.snap-canvas canvas');
    if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, 240, 320).data;
    const at = (x, y) => Array.from(d.slice((y * 240 + x) * 4, (y * 240 + x) * 4 + 3));
    return { red: at(180, 30), green: at(180, 96), blue: at(180, 160), yellow: at(180, 224) };
  });
  log('bob: viewer pixel samples', JSON.stringify(colours));
  const near = (a, b) => a && a.every((v, i) => Math.abs(v - b[i]) < 60);
  check(
    !!colours && near(colours.red, [230, 40, 40]) && near(colours.green, [40, 190, 80]) && near(colours.blue, [40, 90, 230]) && near(colours.yellow, [245, 225, 50]),
    'bob: received image matches the sent colour bands',
  );
  // Others' chats untouched.
  const now = await savedChats(page);
  const changed = now.filter((c) => c.id !== FROM && JSON.stringify(c.messages) !== JSON.stringify(s.before.find((b) => b.id === c.id)?.messages));
  check(changed.length === 0, `bob: no other chat got messages (${changed.map((c) => c.id).join(',') || 'none'})`);

  // Chrome loops the file: let the whole recording play again; the repeat must be ignored.
  const loopEnd = 2 * WAV_SECONDS + 8;
  log(`bob: waiting for the looped recording (until t=${loopEnd.toFixed(0)} s)`);
  await page.locator('.desktop-app__pane .right-pane__close, [aria-label="Close"]').first().click().catch(() => {});
  while (s.elapsed() < loopEnd) await sleep(1000);
  const chat = (await savedChats(page)).find((c) => c.id === FROM);
  const texts = chat?.messages.filter((m) => m.type === 'text').length ?? 0;
  const snaps = chat?.messages.filter((m) => m.type === 'snap').length ?? 0;
  const spans = await heardSpans(page);
  log('bob: mic heard signal at (s)', JSON.stringify(spans));
  const looped = spans.some(([a]) => a > WAV_SECONDS);
  log(looped ? 'bob: Chrome looped the recording: the text and snap were heard twice' : 'bob: the recording did not loop');
  check(texts === 1 && snaps === 1, `bob: after the loop still 1 text + 1 snap (got ${texts} + ${snaps})`);
  log('bob: rows', JSON.stringify((await rows(page)).slice(0, 3)));
  const errors = s.consoleLines.filter((l) => /^(error|pageerror)/.test(l));
  if (errors.length) log('bob console errors:', errors.slice(0, 10));
  await page.screenshot({ path: join(outDir, 'bob-after-loop.png') });
  // Radio details (Shift+R): counters and the decision log for everything heard.
  await page.keyboard.press('Shift+R');
  const panel = page.locator('.radio-details');
  await panel.waitFor();
  const panelText = await panel.innerText();
  log('bob: radio details:', panelText.split('\n').filter((l) => /bytes|SSTV started|stretches|accepted|ignored/.test(l)).join(' | '));
  check(!looped || /ignored: repeat/.test(panelText), 'bob: radio details log shows the looped copy as "ignored: repeat"');
  await page.screenshot({ path: join(outDir, 'bob-radio-details.png') });
  await s.browser.close();
}

async function asCarol() {
  const s = await session('carol');
  const { page } = s;
  let hintSeen = false;
  while (s.elapsed() < WAV_SECONDS + 5) {
    if (await page.locator('.radio-hint').count()) hintSeen = true;
    await sleep(1000);
  }
  log('carol:', await health(page));
  check(!hintSeen, 'carol: no "can’t decode" hint (the tones were decoded, just not for her)');
  const now = await savedChats(page);
  check(!now.some((c) => c.id === FROM), `carol: no "${FROM}" chat`);
  check(JSON.stringify(now.map((c) => c.messages)) === JSON.stringify(s.before.map((c) => c.messages)), 'carol: no messages received');
  await page.screenshot({ path: join(outDir, 'carol.png') });
  const errors = s.consoleLines.filter((l) => /^(error|pageerror)/.test(l));
  if (errors.length) log('carol console errors:', errors.slice(0, 10));
  await s.browser.close();
}

try {
  const only = process.env.E2E_ONLY;
  if (!only || only === 'bob') await asBob();
  if (!only || only === 'carol') await asCarol();
} finally {
  await server.close();
}
log(failures.length ? `FAILED: ${failures.length}` : 'ALL PASSED', `— screenshots in ${outDir}`);
process.exit(failures.length ? 1 : 0);
