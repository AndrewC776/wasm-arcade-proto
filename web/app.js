import { PACKAGE_CACHE, loadPackage, mountFiles } from './loader.js';

const LOG_LIMIT = 300;

const $ = (id) => document.getElementById(id);
const ui = {
  launcher: $('launcher'),
  packages: $('packages'),
  start: $('start'),
  status: $('status'),
  bar: $('bar'),
  chunks: $('chunks'),
  game: $('game'),
  canvas: $('canvas'),
  nowPlaying: $('now-playing'),
  warmStatus: $('warm-status'),
  log: $('log'),
};

const fmtMB = (n) => `${(n / 1048576).toFixed(1)} MB`;
const setStatus = (text, kind = '') => {
  ui.status.textContent = text;
  ui.status.dataset.kind = kind;
};

function appendLog(line) {
  const lines = (ui.log.textContent ? ui.log.textContent.split('\n') : []).concat(String(line));
  ui.log.textContent = lines.slice(-LOG_LIMIT).join('\n');
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    await navigator.serviceWorker.register('./sw.js');
    return await navigator.serviceWorker.ready;
  } catch (err) {
    appendLog(`[sw] 注册失败：${err.message}`);
    return null;
  }
}

async function isCached(pkg) {
  try {
    const cache = await caches.open(PACKAGE_CACHE);
    return Boolean(await cache.match(new URL(pkg.index, location.href).href));
  } catch {
    return false;
  }
}

async function renderCatalog(catalog) {
  const items = await Promise.all(catalog.packages.map(async (pkg, i) => {
    const cached = await isCached(pkg);
    const li = document.createElement('li');
    li.innerHTML = `
      <label>
        <input type="radio" name="pkg" value="${i}" ${pkg.role === 'core' ? 'checked' : ''}>
        <span class="pkg-main">
          <span class="pkg-title"></span>
          <span class="pkg-desc"></span>
        </span>
        <span class="pkg-meta">
          <span class="tag" data-role="${pkg.role}">${pkg.role === 'core' ? '核心包' : '按需'}</span>
          <span class="size">${fmtMB(pkg.dataSize)} / ${pkg.chunkCount} 片</span>
          ${cached ? '<span class="tag" data-role="cached">已缓存</span>' : ''}
        </span>
      </label>`;
    li.querySelector('.pkg-title').textContent = pkg.label;
    li.querySelector('.pkg-desc').textContent = pkg.description;
    return li;
  }));
  ui.packages.replaceChildren(...items);
}

function renderChunkSlots(count) {
  const slots = Array.from({ length: count }, (_, i) => {
    const li = document.createElement('li');
    li.textContent = String(i).padStart(2, '0');
    return li;
  });
  ui.chunks.replaceChildren(...slots);
}

function onProgress({ loaded, total, chunksDone, chunkCount, chunkIndex }) {
  const pct = total ? Math.max(0, Math.min(100, (loaded / total) * 100)) : 0;
  ui.bar.style.width = `${pct.toFixed(1)}%`;
  if (chunkIndex !== undefined) ui.chunks.children[chunkIndex]?.classList.add('done');
  setStatus(`下载并校验数据分片：${chunksDone}/${chunkCount} 片，${fmtMB(loaded)} / ${fmtMB(total)}`);
}

let enginePromise;
function loadEngineFactory() {
  enginePromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'engine/doom.js';
    script.onload = () => (typeof window.createDoomEngine === 'function'
      ? resolve(window.createDoomEngine)
      : reject(new Error('engine/doom.js 未导出 createDoomEngine')));
    script.onerror = () => reject(new Error('引擎脚本 engine/doom.js 加载失败'));
    document.head.append(script);
  });
  return enginePromise;
}

async function warmOthers(currentPkg) {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return;
  try {
    const res = await fetch('warm.json', { cache: 'no-store' });
    const { urls } = await res.json();
    const prefix = currentPkg.index.slice(0, currentPkg.index.lastIndexOf('/') + 1);
    const todo = urls.filter((u) => !u.startsWith(prefix));
    if (todo.length) controller.postMessage({ type: 'warm', urls: todo });
  } catch (err) {
    appendLog(`[warm] 跳过：${err.message}`);
  }
}

navigator.serviceWorker?.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg?.type !== 'warm-progress') return;
  const failed = msg.failed ? `，失败 ${msg.failed}` : '';
  ui.warmStatus.textContent = msg.done + msg.failed >= msg.total
    ? `后台预热完成 ${msg.done}/${msg.total}${failed}`
    : `后台预热 ${msg.done}/${msg.total}${failed}`;
});

async function start(pkg) {
  ui.start.disabled = true;
  ui.packages.querySelectorAll('input').forEach((el) => { el.disabled = true; });
  renderChunkSlots(pkg.chunkCount);
  setStatus('加载引擎与数据包…');

  const [factory, pack] = await Promise.all([
    loadEngineFactory(),
    loadPackage(pkg.index, { onProgress }),
  ]);
  setStatus(`全部 ${pack.index.chunks.length} 片校验通过，启动引擎…`, 'ok');

  const engine = await factory({
    canvas: ui.canvas,
    locateFile: (path) => `engine/${path}`,
    print: (text) => appendLog(text),
    printErr: (text) => appendLog(text),
  });
  mountFiles(engine.FS, pack.files);

  ui.launcher.hidden = true;
  ui.game.hidden = false;
  document.body.classList.add('playing');
  ui.nowPlaying.textContent = pkg.label;
  ui.canvas.focus();

  try {
    engine.callMain(['-iwad', pkg.iwad, ...pkg.args]);
  } catch (err) {
    // The engine hands control to the browser main loop by unwinding the stack.
    if (err !== 'unwind' && err?.name !== 'ExitStatus') throw err;
  }
  warmOthers(pkg);
}

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab']);
window.addEventListener('keydown', (event) => {
  if (document.body.classList.contains('playing') && GAME_KEYS.has(event.key)) event.preventDefault();
});

$('fullscreen').addEventListener('click', () => ui.canvas.requestFullscreen?.());
$('back').addEventListener('click', () => location.reload());

async function init() {
  await registerServiceWorker();
  let catalog;
  try {
    const res = await fetch('catalog.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    catalog = await res.json();
  } catch (err) {
    setStatus(`读取 catalog.json 失败：${err.message}`, 'error');
    return;
  }
  await renderCatalog(catalog);
  ui.start.disabled = false;
  setStatus('选择内容后点「开始」。');

  ui.start.addEventListener('click', () => {
    const picked = ui.packages.querySelector('input[name="pkg"]:checked');
    const pkg = catalog.packages[Number(picked?.value ?? 0)];
    start(pkg).catch((err) => {
      appendLog(`[error] ${err.stack || err.message}`);
      setStatus(`启动失败：${err.message}`, 'error');
      ui.start.disabled = false;
      ui.packages.querySelectorAll('input').forEach((el) => { el.disabled = false; });
    });
  });
}

init();
