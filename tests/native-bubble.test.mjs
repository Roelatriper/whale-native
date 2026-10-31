import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createNativeBubble, defaultNativeBubbleItems } from '../runtime/native-bubble.mjs';

const api = { mode: 'api', display: { label: 'API 余额', amount: '$12.35', hint: '' }, today: '$0.20' };
const subscription = { ...api, mode: 'subscription', display: { label: 'Codex 剩余额度', amount: '5h 额度 80.0%', hint: '周额度 35.0%' } };

test('native conversations use the complete original default JSON, weights and built-in image', () => {
  const source = fs.readFileSync(new URL('../assets/bubble-defaults.json', import.meta.url), 'utf8');
  const defaults = defaultNativeBubbleItems();
  const lines = defaults[1].options[0].item.modules[0].lines;
  assert.ok(lines.length > 40);
  for (const line of lines) { assert.ok(source.includes(JSON.stringify(line.t))); assert.ok(line.w > 0); }
  assert.equal(defaults[1].options[0].w, 10); assert.equal(defaults[1].options[1].w, 1);
  assert.equal(defaults[1].options[1].item.modules[0].imgId, 'bimg_petpet');
  defaults[0].modules[0].text = 'changed copy';
  assert.equal(defaultNativeBubbleItems()[0].modules[0].text, '当前 API 余额');
});

test('pet click starts with money, bubble click picks one original message then closes', () => {
  let calls = 0;
  const bubble = createNativeBubble({ random: () => { calls++; return 0; } });
  const first = bubble.open(api);
  assert.match(first.amount, /当前 API 余额\n\$12.35\n今日已观测 \$0.20/);
  assert.equal(calls, 0);
  const message = bubble.next(api);
  assert.equal(message.amount, '好模型...↓'); assert.equal(message.rows[0].bold, true);
  assert.equal(message.rows[0].size, 126); assert.equal(calls, 2);
  assert.deepEqual(bubble.next(api), { closed: true });
  assert.equal(calls, 2);
  assert.equal(bubble.open(api).amount, first.amount);
});

test('the original weighted image branch serves the original petpet animation', () => {
  const bubble = createNativeBubble({ random: () => .999 });
  bubble.open(api);
  assert.equal(bubble.next(api).imageRoute, '/dsh-whale/bubble-img.png?id=bimg_petpet');
  assert.deepEqual(bubble.next(api), { closed: true });
});

test('subscription starts with quotas and skips API modules even inside a choice', () => {
  const bubble = createNativeBubble({ random: () => 0 });
  const config = { items: [
    { kind: 'custom', modules: [{ type: 'balance' }] },
    { kind: 'choice', options: [{ w: 100, item: { kind: 'custom', modules: [{ type: 'text', text: '当前 API 余额' }] } },
      { w: 1, item: { kind: 'custom', modules: [{ type: 'text', text: '原来自定义留言', bold: true }] } }] },
  ] };
  assert.deepEqual(bubble.open(subscription, config), subscription.display);
  assert.equal(bubble.next(subscription).amount, '原来自定义留言');
  assert.deepEqual(bubble.next(subscription), { closed: true });
});

test('native rows preserve saved typography and reject path-like image identifiers', () => {
  const bubble = createNativeBubble();
  const display = bubble.open(api, { items: [{ kind: 'custom', modules: [
    { type: 'text', text: '自己的留言', color: '#123456', italic: true, ul: true },
    { type: 'image', imgId: '../../secret' },
  ] }] });
  assert.equal(display.rows[0].color, '#123456'); assert.equal(display.rows[0].italic, true);
  assert.equal(display.rows[0].underline, true); assert.equal(display.imageRoute, undefined);
});

test('malformed legacy queue entries cannot crash the native conversation', () => {
  const bubble = createNativeBubble();
  const display = bubble.open(api, { items: [null, { kind: 'unknown' }, { kind: 'choice', options: null },
    { kind: 'custom', modules: [null, { type: 'random', lines: [null] }, { type: 'text', text: '仍可显示' }] }] });
  assert.match(display.amount, /仍可显示/);
  assert.deepEqual(bubble.next(api), { closed: true });
});

test('pet clicks enter messages after the initial balance and keep refreshing instead of reopening money', () => {
  const draws = [0, 0, 0, .3, 0, .6];
  const bubble = createNativeBubble({ random: () => draws.shift() ?? .8 });
  assert.match(bubble.open(api).amount, /\$12.35/);
  const first = bubble.pet(api), second = bubble.pet(api), third = bubble.pet(api);
  assert.equal(first.amount, '好模型...↓');
  assert.notEqual(first.amount, second.amount); assert.notEqual(second.amount, third.amount);
  for (const message of [first, second, third]) { assert.equal(message.kind, 'message'); assert.doesNotMatch(message.amount, /API|12.35/); }
  assert.deepEqual(bubble.next(api), { closed: true });
  assert.match(bubble.open(api).amount, /\$12.35/);
});

test('pet refresh works after bubble-click entry and never returns subscription to API money', () => {
  let draw = 0;
  const bubble = createNativeBubble({ random: () => (draw++ % 2 ? .4 : 0) });
  assert.deepEqual(bubble.open(subscription), subscription.display);
  bubble.next(subscription);
  for (let count = 0; count < 10; count++) {
    const message = bubble.pet(subscription);
    assert.equal(message.closed, undefined); assert.doesNotMatch(message.amount, /API|12.35|5h 额度/);
  }
});
