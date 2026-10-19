import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repo = resolve(process.env.SHOT_REPO ?? process.cwd());
const out = resolve(process.env.SHOT_DIR ?? join(repo, 'dist/shots'));
const sceneFile = process.env.SHOT_SCENE;
if (sceneFile === undefined) {
  process.stderr.write('[shot] SHOT_SCENE is not set\n');
  process.exit(2);
}
const scene = readScene(sceneFile);
const mainEntry = resolve(process.env.SHOT_MAIN ?? join(repo, 'out/main/index.js'));
const defaultSize = process.env.SHOT_SIZE ?? scene.size ?? '1100x700';
const timeoutMs = Number(process.env.SHOT_TIMEOUT ?? '300000');
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const log = (line) => process.stdout.write('[shot] ' + line + '\n');

function readScene(file) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? { steps: parsed } : parsed;
}

function profileDir() {
  if (process.env.SHOT_PROFILE) {
    return resolve(process.env.SHOT_PROFILE);
  }
  const root = join(out, 'profiles');
  mkdirSync(root, { recursive: true });
  if (scene.profile === undefined) {
    return mkdtempSync(join(root, 'p.'));
  }
  const dir = join(root, scene.profile);
  if (scene.reset === true) {
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

function applySceneEnv() {
  for (const [key, value] of Object.entries(scene.env ?? {})) {
    if (!process.env[key]) {
      process.env[key] = String(value);
    }
  }
}

setTimeout(() => {
  log('timeout');
  app.exit(3);
}, timeoutMs).unref();

const profile = profileDir();
log('profile ' + profile);
applySceneEnv();
process.env.MCMONITOR_GAME_DIR = join(profile, 'game');
if (process.env.SHOT_UNREACHABLE === '1' || scene.unreachable === true) {
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
}
app.setPath('userData', profile);
mkdirSync(out, { recursive: true });

await import(mainEntry);

async function firstWindow() {
  for (;;) {
    const [win] = BrowserWindow.getAllWindows();
    if (win && !win.webContents.isLoading()) {
      return win;
    }
    await wait(100);
  }
}

function js(win, code) {
  return win.webContents.executeJavaScript(code, true);
}

async function waitFor(win, selector, timeout = 30000, text) {
  const started = Date.now();
  const probe = `(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const want = ${JSON.stringify(text ?? null)};
    return els.some((el) => want === null || el.textContent.includes(want));
  })()`;
  while (Date.now() - started < timeout) {
    if (await js(win, probe)) {
      return true;
    }
    await wait(50);
  }
  log('WARN no ' + selector + (text ? ' "' + text + '"' : ''));
  return false;
}

async function waitGone(win, selector, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (!(await js(win, `!!document.querySelector(${JSON.stringify(selector)})`))) {
      return true;
    }
    await wait(50);
  }
  log('WARN still ' + selector);
  return false;
}

function settle(win, quiet = 600, max = 6000) {
  return js(
    win,
    `(async () => {
      const deadline = Date.now() + ${max};
      await document.fonts.ready;
      const onScreen = (img) => { const box = img.getBoundingClientRect(); return box.bottom > 0 && box.top < innerHeight; };
      const pending = [...document.images].filter((img) => !img.complete && (img.loading !== 'lazy' || onScreen(img)));
      await Promise.race([
        Promise.all(pending.map((img) => new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); }))),
        new Promise((r) => setTimeout(r, Math.max(0, deadline - Date.now()))),
      ]);
      const calm = await new Promise((resolve) => {
        let timer;
        const finish = (value) => { observer.disconnect(); clearTimeout(timer); resolve(value); };
        const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => finish(true), ${quiet}); });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        timer = setTimeout(() => finish(true), ${quiet});
        setTimeout(() => finish(false), Math.max(${quiet}, deadline - Date.now()));
      });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return calm;
    })()`,
  );
}

function scrollCode(scroll) {
  const spec = typeof scroll === 'object' ? scroll : { y: scroll };
  const scroller = JSON.stringify(spec.scroller ?? 'main.lx-main');
  if (spec.to) {
    return `(() => {
      const sc = document.querySelector(${scroller});
      const el = document.querySelector(${JSON.stringify(spec.to)});
      if (!sc || !el) return 'missing';
      const y = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - ${spec.offset ?? 16};
      sc.scrollTo(0, y);
      return sc.scrollTop + '/' + sc.scrollHeight;
    })()`;
  }
  const y = spec.y === 'bottom' ? 'sc.scrollHeight' : String(spec.y);
  return `(() => {
    const sc = document.querySelector(${scroller});
    if (!sc) return 'missing';
    sc.scrollTo(0, ${y});
    return sc.scrollTop + '/' + sc.scrollHeight;
  })()`;
}

function inputCode(selector, value) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`;
}

function clickCode(selector, text) {
  return `(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const want = ${JSON.stringify(text ?? null)};
    const el = els.find((node) => want === null || node.textContent.includes(want));
    if (!el) return false;
    el.click();
    return true;
  })()`;
}

const SELECT_ALL = `(async () => {
  document.activeElement?.blur();
  document.execCommand('selectAll');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const text = getSelection().toString().replace(/\\s+/g, ' ').trim();
  return text.length + ' ' + JSON.stringify(text.slice(0, 600));
})()`;

function setSize(win, size) {
  const [width, height] = size.split('x').map(Number);
  win.setContentSize(width, height);
}

async function capture(win, item) {
  if (item.blur !== false) {
    await js(
      win,
      'document.activeElement && document.activeElement !== document.body && !document.activeElement.matches("input") && document.activeElement.blur()',
    );
  }
  const image = await win.webContents.capturePage();
  writeFileSync(join(out, item.name + '.png'), image.toPNG());
  const { width, height } = image.getSize();
  log(item.name + ' ' + width + 'x' + height);
}

function resolved(value) {
  if (Array.isArray(value)) {
    return value.map(resolved);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (typeof value.$in === 'number') {
    return new Date(Date.now() + value.$in).toISOString();
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolved(item)]));
}

function stubIpc(table) {
  for (const [channel, answer] of Object.entries(table)) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => resolved(answer));
    log('ipc ' + channel);
  }
}

let clockScript = null;

async function setClock(win, at) {
  const { debugger: devtools } = win.webContents;
  if (!devtools.isAttached()) {
    devtools.attach();
    await devtools.sendCommand('Page.enable');
  }
  if (clockScript !== null) {
    await devtools.sendCommand('Page.removeScriptToEvaluateOnNewDocument', clockScript);
    clockScript = null;
  }
  if (at === null) {
    return;
  }
  const source = `(() => {
    const Real = Date;
    const shift = ${String(Date.parse(at))} - Real.now();
    globalThis.Date = class extends Real {
      constructor(...args) {
        if (args.length === 0) super(Real.now() + shift);
        else super(...args);
      }
      static now() {
        return Real.now() + shift;
      }
    };
  })()`;
  clockScript = await devtools.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source });
  log('clock ' + at);
}

async function run(win, step) {
  const item = Array.isArray(step) ? { name: step[0], route: step[1], ...(step[2] ?? {}) } : step;
  if (item.size) {
    setSize(win, item.size);
    await wait(300);
  }
  if (item.before) {
    log('before: ' + JSON.stringify(await js(win, item.before)));
  }
  if (item.clock !== undefined) {
    await setClock(win, item.clock);
  }
  if (item.ipc) {
    stubIpc(item.ipc);
  }
  if (item.reload) {
    win.webContents.reload();
    await wait(200);
    while (win.webContents.isLoading()) await wait(50);
    await waitFor(win, '#app > *');
  }
  const route = item.routeJs ? await js(win, item.routeJs) : item.route;
  if (item.routeJs) {
    log('route ' + route);
  }
  if (route !== undefined) {
    await js(win, `location.hash = ${JSON.stringify('#' + route)}`);
  }
  for (const selector of [item.wait ?? []].flat()) {
    await waitFor(win, selector, item.waitMs ?? 30000);
  }
  if (item.waitText) {
    await waitFor(win, item.waitText[0], item.waitMs ?? 30000, item.waitText[1]);
  }
  for (const selector of [item.gone ?? []].flat()) {
    await waitGone(win, selector, item.waitMs ?? 30000);
  }
  if (item.input) {
    log('input ' + (await js(win, inputCode(item.input[0], item.input[1]))));
  }
  if (item.click) {
    const [selector, text] = [item.click].flat();
    log('click ' + selector + ' ' + (await js(win, clickCode(selector, text))));
  }
  if (item.send) {
    win.webContents.send(item.send[0], resolved(item.send[1]));
  }
  if (item.after) {
    log('after: ' + JSON.stringify(await js(win, item.after)));
  }
  if (item.pause) {
    await wait(item.pause);
  }
  for (const selector of [item.waitAfter ?? []].flat()) {
    await waitFor(win, selector, item.waitMs ?? 30000);
  }
  if (item.settle !== false) {
    const calm = await settle(win, item.quiet ?? 600, item.max ?? 6000);
    if (!calm) log('note: page kept changing (' + (item.name ?? 'step') + ')');
  }
  if (item.scroll !== undefined) {
    log('scroll ' + (await js(win, scrollCode(item.scroll))));
    await settle(win, 300, 2000);
  }
  if (item.selectAll) {
    log('selected ' + (item.name ?? 'step') + ' ' + (await js(win, SELECT_ALL)));
  }
  if (item.name) {
    await capture(win, item);
  }
  if (item.selectAll) {
    await js(win, 'getSelection().removeAllRanges()');
  }
}

void app.whenReady().then(async () => {
  const win = await firstWindow();
  setSize(win, defaultSize);
  await waitFor(win, '#app > *');
  for (const step of scene.steps) {
    try {
      await run(win, step);
    } catch (error) {
      log('ERROR ' + JSON.stringify(step).slice(0, 120) + ' ' + String(error));
    }
  }
  app.exit(0);
});
