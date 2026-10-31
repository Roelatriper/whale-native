import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { ROOT, DATA_HOME, writeJson, readJson } from '../runtime/paths.mjs';
import { bridgeRequest } from '../runtime/bridge.mjs';
import { NATIVE_NAME, NATIVE_BUNDLE, NATIVE_ICON, nativeInfoPlist, buildNativeIcon } from './native-bundle.mjs';

if (process.platform !== 'darwin') throw Error('原生版第一阶段仅支持 macOS。');
const command = process.argv[2] || 'build';
const appDir = path.join(ROOT, '.build/native-macos', NATIVE_BUNDLE);
const executable = path.join(appDir, 'Contents/MacOS', NATIVE_NAME);
const node = process.execPath;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function build() {
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.mkdirSync(path.join(appDir, 'Contents/Resources'), { recursive: true });
  const source = path.join(ROOT, 'desktop/native');
  const cache = path.join(ROOT, '.build/native-macos/swift-cache'); fs.mkdirSync(cache, { recursive: true });
  const files = fs.readdirSync(source).filter(name => name.endsWith('.swift')).map(name => path.join(source, name));
  if (process.arch !== 'arm64') throw Error('当前预览版仅构建 Apple Silicon (arm64)。');
  const result = spawnSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-Osize', '-target', 'arm64-apple-macosx13.5',
    ...files, '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'AVFoundation', '-framework', 'QuartzCore', '-framework', 'ImageIO', '-o', executable],
  { stdio: 'inherit', env: { ...process.env, CLANG_MODULE_CACHE_PATH: cache, SWIFT_MODULECACHE_PATH: cache } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Swift 构建失败。');
  fs.writeFileSync(path.join(appDir, 'Contents/Info.plist'), nativeInfoPlist());
  buildNativeIcon(path.join(ROOT, 'assets/DSniang1.png'), path.join(appDir, 'Contents/Resources', NATIVE_ICON));
  writeJson(path.join(appDir, 'Contents/Resources/launch.json'), { root: ROOT, node, dataDir: DATA_HOME });
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appDir], { stdio: 'inherit' });
  console.log('原生应用构建完成：' + appDir);
}
function ensureBuilt() {
  const sources = fs.readdirSync(path.join(ROOT, 'desktop/native')).filter(name => name.endsWith('.swift'));
  const stamp = fs.existsSync(executable) ? fs.statSync(executable).mtimeMs : 0;
  const launch = readJson(path.join(appDir, 'Contents/Resources/launch.json'), {});
  const inputs = [path.join(ROOT, 'scripts/native-bundle.mjs'), path.join(ROOT, 'scripts/native-macos.mjs'), path.join(ROOT, 'assets/DSniang1.png')];
  if (!stamp || !fs.existsSync(path.join(appDir, 'Contents/Resources', NATIVE_ICON)) || launch.root !== ROOT || launch.node !== node || launch.dataDir !== DATA_HOME ||
      [...inputs, ...sources.map(name => path.join(ROOT, 'desktop/native', name))].some(file => fs.statSync(file).mtimeMs > stamp)) build();
}
async function stop(dataDir = DATA_HOME) {
  const state = await bridgeRequest('/api/status', { dataDir, timeoutMs: 1000 });
  if (state.renderer !== 'appkit') throw Error('当前运行的是 Electron；请使用其正常退出入口。');
  await bridgeRequest('/api/stop', { method: 'POST', dataDir, timeoutMs: 1000 });
  for (let index = 0; index < 80 && fs.existsSync(path.join(dataDir, 'native-session.lock')); index++) await pause(100);
}
async function run() {
  ensureBuilt();
  let status; try { status = await bridgeRequest('/api/status', { timeoutMs: 1000 }); } catch {}
  if (status?.renderer === 'appkit') { await bridgeRequest('/api/show', { method: 'POST' }); console.log('原生版已恢复显示。'); return; }
  if (status) throw Error('旧挂件仍在使用共享数据目录，请先从旧版菜单正常退出。');
  const config = readJson(path.join(DATA_HOME, 'follow-config.json'), {});
  // The old Node supervisor and Swift poller also consume memory. Suspend only
  // this project's exact managed LaunchAgent, with a persistent restore receipt.
  if (config.label === 'com.api-balance-whale.codex' && config.launchAgentPath) {
    const service = 'gui/' + process.getuid() + '/' + config.label;
    const loaded = spawnSync('/bin/launchctl', ['print', service], { stdio: 'ignore' }).status === 0;
    if (loaded) {
      throw Error('旧版 LaunchAgent 自动跟随仍在运行，请先在旧项目中暂停或卸载跟随服务。此项目不会自动改动旧服务。');
    }
  }
  execFileSync('/usr/bin/open', ['-n', '-g', appDir]);
  for (let index = 0; index < 100; index++) {
    const state = readJson(path.join(DATA_HOME, 'native-status.json'), {});
    let running; try { running = await bridgeRequest('/api/status', { timeoutMs: 500 }); } catch {}
    if (state.ready && state.imageValid && running?.renderer === 'appkit' && running.appPid === state.appPid) { console.log(JSON.stringify({ ok: true, appDir, stage: 1, appPid: state.appPid, backendPid: state.backendPid })); return; }
    await pause(100);
  }
  throw Error('原生应用未报告就绪；见 native-status.json。');
}
async function smoke(measure = false) {
  ensureBuilt();
  const dataDir = fs.mkdtempSync('/private/tmp/whale-native-');
  const liveSessions = measure && process.argv.includes('--sessions');
  const child = spawn(executable, ['--root', ROOT, '--node', node, '--data-dir', dataDir, '--fixture', ...(liveSessions ? ['--fixture-sessions'] : []), ...(measure ? [] : ['--self-test'])], { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  let error = ''; child.stderr.on('data', bytes => { error = (error + bytes).slice(-4000); });
  try {
    if (measure) {
      let state;
      for (let index = 0; index < 100; index++) { state = readJson(path.join(dataDir, 'native-status.json'), {}); if (state.imageValid && state.ready) break; await pause(100); }
      if (!state?.imageValid) throw Error('原生测试未就绪：' + error);
      const index = process.argv.indexOf('--samples');
      const count = index < 0 ? 1 : Number(process.argv[index + 1]);
      if (!Number.isInteger(count) || count < 1 || count > 6) throw Error('--samples 需要 1–6。');
      const samples = [];
      for (let sample = 0; sample < count; sample++) {
        await pause(sample === 0 ? 10000 : 20000);
        state = readJson(path.join(dataDir, 'native-status.json'), {});
        const report = execFileSync('/usr/bin/footprint', ['-p', String(state.appPid), '-p', String(state.backendPid), '--noCategories', '-f', 'bytes'], { encoding: 'utf8' });
        const bytes = [...report.matchAll(/phys_footprint: (\d+) B/g)].reduce((sum, match) => sum + Number(match[1]), 0);
        const backendStatus = await bridgeRequest('/api/status', { dataDir });
        const result = { renderer: 'appkit', fixture: true, liveSessions, seconds: 10 + sample * 20, observation: { watching: backendStatus.monitor?.watching || 0, activeTurns: backendStatus.monitor?.activeTurns || 0 }, metric: 'phys_footprint', bytes, MiB: +(bytes / 1048576).toFixed(1), dataDir, state, raw: report };
        samples.push(result); writeJson(path.join(dataDir, 'native-memory.json'), { ...result, samples }); console.log(JSON.stringify(result, null, 2));
      }
      await stop(dataDir);
      const timer = setTimeout(() => child.kill('SIGTERM'), 10000);
      const [code, signal] = await closed; clearTimeout(timer);
      if (code !== 0 || signal) throw Error('测量完成后应用未正常退出。');
    } else {
      const timeout = setTimeout(() => child.kill('SIGTERM'), 60000);
      const [code, signal] = await closed; clearTimeout(timeout);
      const result = readJson(path.join(dataDir, 'native-smoke.json'), { ok: false, error: error || '未生成冒烟测试报告' });
      if (code !== 0 || signal !== null) { result.ok = false; result.error = '应用未正常退出：' + JSON.stringify({ code, signal }); result.diagnostics = error; }
      console.log(JSON.stringify({ ...result, dataDir }, null, 2)); if (!result.ok) process.exitCode = 1;
    }
  } finally { if (child.exitCode == null && child.signalCode == null) { child.kill('SIGTERM'); await closed; } }
}
if (command === 'build') build();
else if (command === 'run') await run();
else if (command === 'stop') await stop();
else if (command === 'status') console.log(JSON.stringify(readJson(path.join(DATA_HOME, 'native-status.json'), {}), null, 2));
else if (command === 'smoke') await smoke();
else if (command === 'measure') await smoke(true);
else throw Error('支持 build、run、stop、status、smoke、measure');
