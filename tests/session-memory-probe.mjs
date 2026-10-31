// Deterministic allocation/performance probe; no real sessions or credentials.
// node tests/session-memory-probe.mjs [--budget-mib 100]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

if (process.argv.includes('--child')) {
  const { SessionReader } = await import('../runtime/session-monitor.mjs');
  const root = process.argv.at(-1), starts = [], ends = [];
  const original = fs.readSync; let maxReadBytes = 0, readCalls = 0;
  fs.readSync = (...args) => { maxReadBytes = Math.max(maxReadBytes, args[3]); readCalls++; return original(...args); };
  const reader = new SessionReader({ root, defaultModel: 'probe', onStart: item => starts.push(item), onEnd: item => ends.push(item) });
  const started = performance.now(); reader.tick(true);
  const filename = path.join(root, 'rollout-probe.jsonl');
  const event = payload => JSON.stringify({ type: 'event_msg', timestamp: '2026-10-31T00:01:00Z', payload }) + '\n';
  fs.appendFileSync(filename, event({ type: 'token_count', info: { total_token_usage: { input_tokens: 110, output_tokens: 30 } } }) + event({ type: 'task_complete', turn_id: 'turn' }));
  reader.tick(); fs.readSync = original;
  assert.equal(starts.length, 1); assert.equal(ends.length, 1);
  assert.equal(ends[0].byModel.probe.input_tokens, 10); assert.equal(ends[0].byModel.probe.output_tokens, 10);
  console.log(JSON.stringify({ syntheticMiB: 64, maxRSSMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(1),
    heapUsedMiB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1), externalMiB: +(process.memoryUsage().external / 1048576).toFixed(1),
    milliseconds: +(performance.now() - started).toFixed(1), maxReadBytes, readCalls, observedTurns: ends.length }));
} else {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-scan-memory-'));
  try {
    const filename = path.join(scratch, 'rollout-probe.jsonl'), fd = fs.openSync(filename, 'w');
    const record = (type, payload) => JSON.stringify({ type, timestamp: '2026-10-31T00:00:00Z', payload }) + '\n';
    try {
      fs.writeSync(fd, record('session_meta', { id: 'memory-probe' }));
      fs.writeSync(fd, record('event_msg', { type: 'task_started', turn_id: 'turn' }));
      fs.writeSync(fd, record('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 20 } } }));
      const line = record('response_item', { type: 'message', content: '鲸'.repeat(20000) });
      for (let bytes = 0; bytes < 64 * 1048576; bytes += Buffer.byteLength(line)) fs.writeSync(fd, line);
    } finally { fs.closeSync(fd); }
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', scratch], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout); console.log(JSON.stringify(result));
    const index = process.argv.indexOf('--budget-mib');
    if (index >= 0) assert.ok(result.maxRSSMiB <= Number(process.argv[index + 1]), `scan peak ${result.maxRSSMiB} MiB exceeds budget`);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
