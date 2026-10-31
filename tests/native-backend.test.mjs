import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('synthetic native mode rejects non-native scratch targets and symlinks before changing data', async t => {
  const protectedDir = fs.mkdtempSync('/private/tmp/whale-ledger-guard-');
  const link = protectedDir.replace('whale-ledger-guard-', 'whale-native-link-');
  fs.writeFileSync(path.join(protectedDir, 'sentinel.json'), 'unchanged'); fs.symlinkSync(protectedDir, link);
  t.after(() => { fs.unlinkSync(link); fs.rmSync(protectedDir, { recursive: true, force: true }); });
  for (const target of [protectedDir, link]) {
    const child = spawn(process.execPath, [path.join(root, 'desktop/native/backend.mjs'), '--data-dir', target], { env: { ...process.env, WHALE_NATIVE_TEST: '1' }, stdio: 'ignore' });
    assert.equal((await once(child, 'close'))[0], 2);
    assert.deepEqual(fs.readdirSync(protectedDir), ['sentinel.json']);
    assert.equal(fs.readFileSync(path.join(protectedDir, 'sentinel.json'), 'utf8'), 'unchanged');
  }
});

test('native JSONL adapter serves real resources/settings, isolates versions, excludes duplicates and closes on EOF', { timeout: 20000 }, async t => {
  const dataDir = fs.mkdtempSync('/private/tmp/whale-native-backend-');
  const args = [path.join(root, 'desktop/native/backend.mjs'), '--data-dir', dataDir];
  const child = spawn(process.execPath, args, { env: { ...process.env, WHALE_NATIVE_TEST: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', serial = 0, ready;
  const waiting = new Map(), started = new Promise(resolve => { ready = resolve; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk; let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const value = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);
      if (value.event === 'ready') ready(value);
      if (value.id) { waiting.get(value.id)?.(value); waiting.delete(value.id); }
    }
  });
  t.after(async () => { if (child.exitCode === null) { child.stdin.end(); await once(child, 'close'); } fs.rmSync(dataDir, { recursive: true, force: true }); });
  const request = (method, params, v = 1) => new Promise(resolve => { const id = ++serial; waiting.set(id, resolve); child.stdin.write(JSON.stringify({ v, id, method, params }) + '\n'); });
  assert.equal((await started).data.protocol, 1);
  const snapshot = await request('snapshot'); assert.equal(snapshot.ok, true); assert.equal(snapshot.result.display.amount, '$12.35');
  const first = await request('action', { name: 'bubble-open' });
  assert.match(first.result.amount, /当前 API 余额\n\$12.35/);
  const message = await request('action', { name: 'bubble-pet' });
  assert.ok(message.result.rows?.some(row => row.text) || message.result.imageRoute);
  const refreshed = await request('action', { name: 'bubble-pet' });
  assert.ok(refreshed.result.rows?.some(row => row.text) || refreshed.result.imageRoute);
  assert.doesNotMatch(refreshed.result.amount, /当前 API 余额|12.35/);
  assert.equal((await request('action', { name: 'bubble-next' })).result.closed, true);
  const png = await request('request', { route: '/dsh-whale/image.png' });
  assert.equal(png.result.status, 200); assert.deepEqual(Buffer.from(png.result.body, 'base64').subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const html = await request('request', { route: '/native/settings.html' });
  const source = Buffer.from(html.result.body, 'base64').toString();
  assert.equal(source.includes('/native/settings.js'), true); assert.equal(source.includes('/dsh-whale/widget.js'), false);
  const config = await request('request', { route: '/api/config' });
  assert.equal(Buffer.from(config.result.body, 'base64').toString().includes('NATIVE-TEST-ONLY'), false);
  assert.equal((await request('snapshot', {}, 2)).ok, false);
  assert.equal((await request('request', { route: '//untrusted.example/' })).ok, false);
  assert.equal((await request('action', { name: 'preferences', args: { role: '../../outside' } })).ok, false);
  const changed = await request('action', { name: 'preferences', args: { volume: .25 } }); assert.equal(changed.result.volume, .25);
  const duplicate = spawn(process.execPath, args, { env: { ...process.env, WHALE_NATIVE_TEST: '1' }, stdio: 'ignore' });
  assert.equal((await once(duplicate, 'close'))[0], 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'runtime.json'))).pid, child.pid);
  child.stdin.end(); assert.equal((await once(child, 'close'))[0], 0);
  assert.equal(fs.existsSync(path.join(dataDir, 'runtime.json')), false);
  assert.equal(fs.existsSync(path.join(dataDir, 'native-session.lock')), false);
});
