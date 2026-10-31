import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeView, nativeDisplay } from '../runtime/native-view.mjs';
import { NATIVE_DEFAULTS, validateNativePreferences } from '../runtime/native-preferences.mjs';

function fixture(intercept = null) {
  const events = [], routes = [];
  const values = new Map([
    ['/api/display-mode', { mode: 'api' }], ['/dsh-whale/balance.json', { ok: true, totalBalance: 12.5, currency: 'USD' }],
    ['/api/insights', { subscription: { available: true, windows: [{ windowDurationMins: 300, usedPercent: 20 }, { windowDurationMins: 10080, usedPercent: 65 }] } }],
    ['/dsh-whale/roles.json', { roles: [{ id: 'default', name: '小鲸鱼', private: 'not-for-view' }] }],
    ['/dsh-whale/last-turn.json', { ok: true, seq: 0 }], ['/api/account-notices', { scope: 'public-scope', notices: [] }],
    ['/api/account-notices/ack', { ok: true }],
  ]);
  let prefs = { ...NATIVE_DEFAULTS };
  const dispatch = async (route, options = {}) => {
    routes.push([route, options]);
    if (intercept) { const result = intercept(route, options, values); if (result) return await result; }
    if (route === '/api/display-mode' && options.method === 'POST') values.set(route, { mode: options.body.mode });
    return { status: 200, body: Buffer.from(JSON.stringify(values.get(route.split('?')[0]) || {})) };
  };
  const view = createNativeView({ dispatch, preferences: { get: () => ({ ...prefs }), set(patch) { prefs = validateNativePreferences(patch, prefs); } }, emit: (name, data) => events.push({ name, data }), startedAt: 10000, random: () => 0 });
  return { view, values, routes, events };
}

test('native subscription snapshots contain distinct quota windows and never fetch API money', async () => {
  const { view, values, routes } = fixture(); values.set('/api/display-mode', { mode: 'subscription' });
  const result = await view.refresh();
  assert.equal(result.display.amount, '5h 额度 80.0%'); assert.equal(result.display.hint, '周额度 35.0%');
  assert.equal(routes.some(([route]) => route.startsWith('/dsh-whale/balance')), false);
  assert.equal(JSON.stringify(result).includes('12.5'), false); assert.equal(JSON.stringify(result).includes('not-for-view'), false);
  values.get('/api/insights').subscription.windows[0].stale = true;
  assert.equal((await view.refresh()).display.hint.includes('快照已过期'), true);
});

test('unknown, unlimited and unconfirmed native money follow the shared display policy', () => {
  assert.equal(nativeDisplay('api', { totalBalance: null }).amount, '暂不可用');
  assert.equal(nativeDisplay('api', { totalBalance: 0, currency: 'USD' }).amount.includes('0'), true);
  assert.equal(nativeDisplay('api', { balanceStatus: 'unlimited', totalBalance: 1e100 }).amount, '密钥不限额');
  assert.equal(nativeDisplay('api', { balanceStatus: 'unconfirmed', totalBalance: 9999 }).amount, '金额口径待确认');
});

test('native task polling suppresses startup replay and emits a fresh main completion only once', async () => {
  const { view, values, events } = fixture();
  values.set('/dsh-whale/last-turn.json', { ok: true, seq: 1, id: 'old', turn: 1, notificationAt: 9000, amount: 1 });
  await view.pollNotices(); assert.equal(events.filter(e => e.name === 'notice').length, 0);
  values.set('/dsh-whale/last-turn.json', { ok: true, seq: 2, id: 'new', turn: 2, notificationAt: 11000, amount: null, tokens: 1234, costState: 'unknown' });
  await view.pollNotices(); await view.pollNotices();
  const notices = events.filter(e => e.name === 'notice'); assert.equal(notices.length, 1);
  assert.equal(notices[0].data.display.amount, '1,234 tokens');
  assert.equal(notices[0].data.display.rows[1].color, '#e0433f');
  values.set('/dsh-whale/last-turn.json', { ok: true, seq: 3, id: 'child', turn: 3, isSubagent: true, amount: 10 });
  await view.pollNotices(); assert.equal(events.filter(e => e.name === 'notice').length, 1);
});

test('account messages remain unacknowledged until the native view confirms actual display', async () => {
  const { view, values, events, routes } = fixture();
  values.set('/api/account-notices', { scope: 'public', notices: [{ id: 'batch-1', amount: .25, currency: 'USD' }] });
  await view.pollNotices(); await view.pollNotices();
  assert.equal(events.filter(e => e.data.kind === 'account').length, 1);
  assert.equal(routes.some(([, options]) => options.method === 'POST'), false);
  await view.action('ack-account', { id: 'batch-1' });
  assert.deepEqual(routes.at(-1), ['/api/account-notices/ack', { method: 'POST', body: { ids: ['batch-1'] } }]);
});

test('native preferences reject unknown fields, invalid types and paths; patches preserve other choices', () => {
  for (const patch of [{ scale: 0 }, { sound: 'yes' }, { volume: NaN }, { role: '../secret' }, { position: { x: 1 } }, { apiKey: 'not-allowed' }]) assert.throws(() => validateNativePreferences(patch));
  const first = validateNativePreferences({ volume: .2, flipped: true });
  const second = validateNativePreferences({ scale: 1.5 }, first);
  assert.equal(second.volume, .2); assert.equal(second.flipped, true); assert.equal(second.scale, 1.5);
});

test('mode and account scope changes invalidate queued native money without confirming the old batch', async () => {
  const { view, values, events, routes } = fixture();
  values.set('/api/account-notices', { scope: 'old-account', notices: [{ id: 'old-batch', amount: .25, currency: 'USD' }] });
  await view.pollNotices();
  values.set('/api/account-notices', { scope: 'new-account', notices: [{ id: 'new-batch', amount: .5, currency: 'USD' }] });
  await view.pollNotices();
  assert.equal(events.some(event => event.name === 'invalidate-notices' && event.data.reason === 'account-scope'), true);
  await view.action('mode', { mode: 'subscription' });
  assert.equal(events.some(event => event.name === 'invalidate-notices' && event.data.reason === 'mode'), true);
  assert.equal(routes.some(([route]) => route === '/api/account-notices/ack'), false);
  const snapshot = view.snapshot(); assert.equal(snapshot.mode, 'subscription'); assert.equal(snapshot.display.amount.includes('$'), false);
});

test('a delayed API notice read cannot publish old money after switching to subscription', async () => {
  let release, began;
  const waiting = new Promise(resolve => { began = resolve; });
  const subject = fixture(route => {
    if (route === '/api/account-notices') { began(); return new Promise(resolve => { release = () => resolve({ status: 200, body: Buffer.from(JSON.stringify({ scope: 'old', notices: [{ id: 'late', amount: 99, currency: 'USD' }] })) }); }); }
  });
  const { view, values, events } = subject;
  values.set('/dsh-whale/last-turn.json', { ok: true, seq: 1, id: 'fresh', turn: 1, notificationAt: 11000, amount: 99 });
  const pending = view.pollNotices(); await waiting;
  await view.action('mode', { mode: 'subscription' }); release(); await pending;
  assert.equal(events.some(event => event.name === 'notice'), false);
  assert.equal(view.snapshot().mode, 'subscription');
});

test('a click reads persisted mode instead of showing a cached API screen after a settings change', async () => {
  const { view, values } = fixture();
  await view.refresh(); await view.action('bubble-open');
  values.set('/api/display-mode', { mode: 'subscription' });
  assert.deepEqual(await view.action('bubble-next'), { closed: true });
  assert.deepEqual(await view.action('bubble-pet'), { closed: true });
  const next = await view.action('bubble-open');
  assert.equal(next.amount, '5h 额度 80.0%'); assert.equal(JSON.stringify(next).includes('$12.50'), false);
});

test('a delayed conversation config read cannot reopen old API money after a mode switch', async () => {
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  const { view } = fixture(route => {
    if (route !== '/dsh-whale/bubble.json') return;
    started(); return new Promise(resolve => { release = () => resolve({ status: 200, body: Buffer.from('{"config":null}') }); });
  });
  await view.refresh();
  const pending = view.action('bubble-open'); await began;
  await view.action('mode', { mode: 'subscription' }); release();
  assert.deepEqual(await pending, { closed: true });
});
