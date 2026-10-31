import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionReader } from '../runtime/session-monitor.mjs';

test('session replay reuses bounded 64KiB reads while preserving a long active turn and UTF-8 metadata', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-bounded-reader-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'rollout-bounded.jsonl'), starts = [], ends = [];
  const record = (type, payload) => JSON.stringify({ type, timestamp: '2026-10-31T00:00:00Z', payload }) + '\n';
  fs.writeFileSync(file, record('session_meta', { id: 'bounded', padding: '鲸'.repeat(10000) }) +
    record('event_msg', { type: 'task_started', turn_id: 't' }) +
    record('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 20 } } }) +
    record('response_item', { text: '鲸'.repeat(100000) }).repeat(8));
  const original = fs.readSync, sizes = [], buffers = new Set();
  fs.readSync = (...args) => { sizes.push(args[3]); buffers.add(args[1].buffer); return original(...args); };
  try {
    const reader = new SessionReader({ root, defaultModel: 'probe', onStart: e => starts.push(e), onEnd: e => ends.push(e) });
    reader.tick(true);
    fs.appendFileSync(file, record('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 110, output_tokens: 30 } } }) + record('event_msg', { type: 'task_complete', turn_id: 't' }));
    reader.tick();
    assert.equal(starts.length, 1); assert.equal(ends.length, 1);
    assert.equal(ends[0].sessionId, 'bounded'); assert.equal(ends[0].byModel.probe.input_tokens, 10); assert.equal(ends[0].byModel.probe.output_tokens, 10);
    assert.ok(Math.max(...sizes) <= 65536, `largest read: ${Math.max(...sizes)}`);
    assert.ok(buffers.size <= 2, `allocated ${buffers.size} read buffers`);
  } finally { fs.readSync = original; }
});

test('bounded replay preserves split UTF-8 records across separate polls', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-utf8-reader-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'rollout-utf8.jsonl'), ends = [];
  const record = (type, payload) => JSON.stringify({ type, payload }) + '\n';
  fs.writeFileSync(file, record('session_meta', { id: 'utf8' }));
  const reader = new SessionReader({ root, onEnd: e => ends.push(e) }); reader.tick(true);
  const context = Buffer.from(record('turn_context', { model: '鲸鱼模型' }));
  const split = context.indexOf(Buffer.from('鲸')) + 1;
  fs.appendFileSync(file, context.subarray(0, split)); reader.tick();
  fs.appendFileSync(file, Buffer.concat([context.subarray(split), Buffer.from(
    record('event_msg', { type: 'task_started', turn_id: 't' }) +
    record('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 12, output_tokens: 4 } } }) +
    record('event_msg', { type: 'task_complete', turn_id: 't' }))]));
  reader.tick(); assert.equal(ends.length, 1); assert.equal(ends[0].byModel['鲸鱼模型'].input_tokens, 12);
});

test('oversized irrelevant records do not hide following live token/completion records', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-large-line-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'rollout-large-line.jsonl'), ends = [];
  const record = (type, payload) => JSON.stringify({ type, payload }) + '\n';
  fs.writeFileSync(file, record('session_meta', { id: 'long-line' }));
  const reader = new SessionReader({ root, defaultModel: 'probe', onEnd: e => ends.push(e) }); reader.tick(true);
  fs.appendFileSync(file, record('event_msg', { type: 'task_started', turn_id: 't' }) +
    record('response_item', { text: 'x'.repeat(9 * 1048576) }) +
    record('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 12, output_tokens: 4 } } }) +
    record('event_msg', { type: 'task_complete', turn_id: 't' }));
  for (let attempt = 0; attempt < 5; attempt++) reader.tick();
  assert.equal(ends.length, 1); assert.equal(ends[0].byModel.probe.input_tokens, 12);
  assert.equal(reader.files.get(file).pending, ''); assert.equal(reader.status().catchingUp, false);
});

test('an unfinished chat body is discarded without retaining megabytes or losing the next record', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-chat-discard-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'rollout-chat.jsonl'), ends = [];
  const record = (type, payload) => JSON.stringify({ type, payload }) + '\n';
  fs.writeFileSync(file, record('session_meta', { id: 'discard', subagent_history_start_ordinal: 1 }));
  const reader = new SessionReader({ root, defaultModel: 'probe', onEnd: e => ends.push(e) }); reader.tick(true);
  fs.appendFileSync(file, '{"timestamp":"2026-10-31T00:00:00Z","type":"response_item","payload":{"text":"' + '鲸'.repeat(700000));
  reader.tick();
  assert.equal(reader.files.get(file).pending.length, 0);
  assert.equal(reader.files.get(file).skipLine, true);
  fs.appendFileSync(file, '"}}\n' + record('event_msg', { type: 'task_started', turn_id: 't' }) +
    record('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 12, output_tokens: 4 } } }) +
    record('event_msg', { type: 'task_complete', turn_id: 't' }));
  reader.tick(); assert.equal(ends.length, 1); assert.equal(ends[0].byModel.probe.input_tokens, 12);
});

test('chat-shaped nested data does not discard a genuine lifecycle record', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-prefix-guard-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'rollout-guard.jsonl'), starts = [];
  const record = (type, payload) => JSON.stringify({ type, payload }) + '\n';
  fs.writeFileSync(file, record('session_meta', { id: 'guard' }));
  const reader = new SessionReader({ root, onStart: e => starts.push(e) }); reader.tick(true);
  const line = record('event_msg', { type: 'task_started', turn_id: 'kept', nested: { type: 'response_item' }, padding: 'x'.repeat(200000) });
  fs.appendFileSync(file, line.slice(0, 100000)); reader.tick();
  assert.equal(reader.files.get(file).skipLine, false);
  fs.appendFileSync(file, line.slice(100000)); reader.tick();
  assert.equal(starts.length, 1); assert.equal(starts[0].turnId, 'kept');
});
