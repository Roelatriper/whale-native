import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { createDispatcher } from '../../runtime/dispatcher.mjs';
import { startBridge, pipeName, socketResponds } from '../../runtime/bridge.mjs';
import { DATA_HOME } from '../../runtime/paths.mjs';
import { nativePreferenceStore } from '../../runtime/native-preferences.mjs';
import { createNativeView } from '../../runtime/native-view.mjs';

const argument = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const dataDir = path.resolve(argument('--data-dir', DATA_HOME));
const fixture = process.env.WHALE_NATIVE_TEST === '1';
const liveSessionFixture = fixture && process.env.WHALE_NATIVE_TEST_SESSIONS === '1';
// Synthetic balances must never observe/write the installed user's ledger.
if (fixture && (dataDir === DATA_HOME || !/^\/private\/tmp\/whale-native-[A-Za-z0-9-]+$/.test(dataDir) || (fs.existsSync(dataDir) && fs.lstatSync(dataDir).isSymbolicLink()))) {
  process.stderr.write('模拟模式仅允许独立的 /private/tmp/whale-native-* 测试目录。\n'); process.exit(2);
}
const write = message => { if (!process.stdout.destroyed) process.stdout.write(JSON.stringify({ v: 1, ...message }) + '\n'); };
const emit = (event, data) => write({ event, data });
if (await socketResponds(pipeName(dataDir))) { process.stderr.write('挂件已在运行；请先从其菜单正常退出，不要并行使用同一数据目录。\n'); process.exit(2); }
fs.mkdirSync(dataDir, { recursive: true });
const lockPath = path.join(dataDir, 'native-session.lock');
const sessionId = crypto.randomUUID();
try { fs.mkdirSync(lockPath); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  if (fs.lstatSync(lockPath).isSymbolicLink()) throw Error('拒绝使用符号链接锁目录');
  const old = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
  let alive = false; try { process.kill(old.pid, 0); alive = true; } catch (failure) { if (failure.code !== 'ESRCH') alive = true; }
  if (alive) { process.stderr.write('原生后台已在运行。\n'); process.exit(2); }
  fs.rmSync(lockPath, { recursive: true }); fs.mkdirSync(lockPath);
}
fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({ pid: process.pid, sessionId }));
const preferences = nativePreferenceStore(dataDir);
let options = {};
if (fixture) {
  const { ConfigStore } = await import('../../runtime/config.mjs');
  const { WhaleService } = await import('../../runtime/service.mjs');
  const codexHome = path.join(dataDir, 'fixture-codex'); fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model_provider="fixture"\n[model_providers.fixture]\nbase_url="https://example.invalid/v1"\nexperimental_bearer_token="NATIVE-TEST-ONLY"\n');
  const config = new ConfigStore({ dataDir, codexHome: liveSessionFixture ? path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) : codexHome, env: liveSessionFixture ? process.env : {} });
  options = { service: new WhaleService({ config, provider: { async balance(c) { return { ok: true, accountId: c.accountId, currency: 'USD', totalBalance: 12.3456, totalUsed: 0 }; } } }), monitor: liveSessionFixture, autoRefresh: false };
}
let bridge, view, closing = false, input = '', polling = false;
const timers = [];
const dispatcher = createDispatcher({ dataDir, ...options, onShow: () => emit('show', {}), onStop: () => { emit('shutdown', {}); void close(); },
  statusInfo: () => {
    let host = {}; try { host = JSON.parse(fs.readFileSync(path.join(dataDir, 'native-status.json'), 'utf8')); } catch {}
    const belongs = host.appPid === process.ppid;
    return { renderer: 'appkit', nativeStage: 1, protocol: 1, appPid: process.ppid, platform: 'darwin',
      rendererReady: belongs && host.ready === true && host.imageValid === true,
      visible: belongs && host.petVisible === true, manuallyHidden: belongs && host.manuallyHidden === true,
      desktopMode: preferences.get().followMode, followCodex: preferences.get().followMode !== 'standalone' };
  } });

async function close() {
  if (closing) return; closing = true;
  for (const timer of timers) clearInterval(timer);
  const watchdog = setTimeout(() => process.exit(1), 7000);
  try { await bridge?.close(); await dispatcher.close(); }
  finally {
    if (JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8')).sessionId === sessionId) fs.rmSync(lockPath, { recursive: true, force: true });
    clearTimeout(watchdog); process.exit(0);
  }
}
process.on('SIGTERM', close); process.on('SIGINT', close); process.stdin.on('end', close); process.stdout.on('error', close);

function settingsHTML() {
  let html = fs.readFileSync(new URL('../ui/widget.html', import.meta.url), 'utf8');
  html = html.replace(/<script[\s\S]*?<\/script>/g, '');
  html = html.replace('</head>', '<link rel="stylesheet" href="/native/settings.css">' +
    ['client.js', 'connection-settings.js', 'money.js', 'balance-view.js', 'usage-history.js', 'insights.js', 'workshop.js', 'native/settings.js'].map(file => `<script src="/${file}" defer></script>`).join('') + '</head>');
  return html;
}

async function request(message) {
  if (message.v !== 1 || !Number.isSafeInteger(message.id) || message.id < 1 || typeof message.method !== 'string') throw Error('无效的协议消息');
  const params = message.params || {};
  if (message.method === 'snapshot') return view.refresh(params.force === true);
  if (message.method === 'action') return view.action(params.name, params.args);
  if (message.method === 'shutdown') { setTimeout(close, 20); return { stopped: true }; }
  if (message.method !== 'request') throw Error('未知协议方法');
  const { route, method = 'GET', body = null } = params;
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || /[\\\x00-\x1f]/.test(route)) throw Error('本地路径无效');
  const pathname = new URL(route, 'whale://widget').pathname;
  if (pathname === '/native/preferences') {
    if (method === 'GET') return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(preferences.get())).toString('base64') };
    if (method !== 'PUT') throw Error('外观设置仅支持 GET/PUT');
    const updated = await view.action('preferences', body);
    return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(updated)).toString('base64') };
  }
  if (pathname.startsWith('/native/')) {
    if (method !== 'GET') throw Error('原生静态资源仅支持 GET');
    const file = { '/native/settings.html': ['text/html; charset=utf-8', () => Buffer.from(settingsHTML())],
      '/native/settings.js': ['application/javascript', () => fs.readFileSync(new URL('./settings.js', import.meta.url))],
      '/native/settings.css': ['text/css', () => fs.readFileSync(new URL('./settings.css', import.meta.url))] }[pathname];
    if (!file) throw Error('原生资源不存在');
    return { status: 200, headers: { 'content-type': file[0], 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" }, body: file[1]().toString('base64') };
  }
  const response = await dispatcher.dispatch(route, { method, body });
  if (method !== 'GET' && ['/api/display-mode', '/api/config'].includes(pathname) && response.status < 400) {
    view.invalidateNotices('settings'); void view.refresh().catch(() => {});
  }
  return { status: response.status, headers: response.headers, body: response.body.toString('base64') };
}

try {
  bridge = await startBridge(dispatcher, { dataDir, onMode: mode => { preferences.set({ followMode: mode }); emit('snapshot', { ...view.snapshot(), preferences: preferences.get() }); return true; }, onResetPosition: () => { preferences.set({ position: null }); emit('show', { resetPosition: true }); return true; } });
  view = createNativeView({ dispatch: dispatcher.dispatch, preferences, emit });
  emit('ready', { protocol: 1, renderer: 'appkit', pid: process.pid, fixture, liveSessionFixture });
  void view.refresh().catch(() => emit('error', { message: '余额或额度暂不可用，请检查配置' }));
  timers.push(setInterval(() => { void view.refresh().catch(() => {}); }, 30000));
  timers.push(setInterval(async () => { if (polling || closing) return; polling = true; try { await view.pollNotices(); } catch {} finally { polling = false; } }, 1500));
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    input += chunk;
    if (Buffer.byteLength(input) > 36 * 1024 * 1024) { emit('error', { message: '本地消息超过大小限制' }); void close(); return; }
    let index;
    while ((index = input.indexOf('\n')) !== -1) {
      const line = input.slice(0, index); input = input.slice(index + 1);
      let message; try { message = JSON.parse(line); } catch { write({ id: null, ok: false, error: { code: 'BAD_JSON', message: '无效 JSON' } }); continue; }
      void request(message).then(result => write({ id: message.id, ok: true, result }), () => write({ id: message.id || null, ok: false, error: { code: 'REQUEST_FAILED', message: '本地操作失败，请检查请求或设置' } }));
    }
  });
} catch { process.stderr.write('原生后台初始化失败；请检查数据目录和已运行的挂件。\n'); await close(); }
