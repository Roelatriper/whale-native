import fs from 'node:fs';
import vm from 'node:vm';
import { createNativeBubble } from './native-bubble.mjs';

// Reuse the same notice policy as Electron instead of inventing new billing or
// deduplication semantics. These small UMD modules have no browser dependencies.
function shared(name) {
  const box = { module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(new URL('../desktop/ui/' + name, import.meta.url), 'utf8'), box);
  return box.module.exports;
}
const noticePolicy = shared('turn-notice.js');
const quota = shared('account-view.js');
const balanceView = shared('balance-view.js');
const money = (value, currency = 'USD') => typeof value === 'number' && Number.isFinite(value)
  ? new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) : '金额未知';
function costDisplay(display, known = true) {
  return { ...display, rows: [
    { text: display.label, size: 40, bold: true, color: '#536ba9' },
    { text: display.amount, size: known ? Math.min(100, 760 / Math.max(8, display.amount.length)) : 52, bold: true, color: '#e0433f' },
    { text: display.hint, size: 34, color: '#9fb0d9' },
  ] };
}

export function nativeDisplay(mode, balance, insights) {
  if (mode === 'subscription') {
    const display = quota.quotaBubble(insights);
    if (insights?.subscription?.windows?.some(window => window.stale)) display.hint += ' · 快照已过期';
    return display;
  }
  const description = balanceView.describe(balance || {});
  return { label: description.label, amount: balanceView.amount(balance || {}, money),
    hint: balance?.stale ? '缓存数据 · 请刷新确认' : balance?.message || '点击气泡查看小鲸鱼留言' };
}

export function createNativeView({ dispatch, preferences, emit, startedAt = Date.now(), random = Math.random }) {
  let lastSeq = 0, lastId = '', firstPoll = true, snapshot = null, modeRevision = 0, contextEpoch = 0, observedMode = null, observedScope = null;
  const conversation = createNativeBubble({ random });
  let conversationMode = null;
  let today = '--';
  const bubbleContext = () => ({ mode: snapshot?.mode, display: snapshot?.display || {}, today });
  const sentAccounts = new Set();
  function invalidateNotices(reason) { contextEpoch++; conversationMode = null; sentAccounts.clear(); observedScope = null; emit('invalidate-notices', { reason }); }
  const json = async (route, options) => {
    const reply = await dispatch(route, options);
    const body = JSON.parse(reply.body.toString('utf8'));
    if (reply.status >= 400) throw Error(body.error || '本地操作失败');
    return body;
  };
  async function readMode() {
    const { mode } = await json('/api/display-mode');
    if (observedMode !== null && observedMode !== mode) invalidateNotices('mode');
    observedMode = mode; return mode;
  }
  async function refresh(force = false) {
    const revision = ++modeRevision;
    const mode = await readMode();
    const [balance, insights, roles] = await Promise.all([
      mode === 'api' ? json('/dsh-whale/balance.json' + (force ? '?refresh=1' : '')).catch(() => null) : null,
      mode === 'subscription' ? json('/api/insights').catch(() => null) : null,
      json('/dsh-whale/roles.json').catch(() => ({ roles: [] })),
    ]);
    if (revision !== modeRevision) return snapshot;
    const description = balanceView.describe(balance || {});
    today = description.todayUsage === null ? '--' : money(description.todayUsage, balance?.currency);
    snapshot = { protocol: 1, mode, display: nativeDisplay(mode, balance, insights), preferences: preferences.get(),
      roles: (roles.roles || []).map(role => ({ id: role.id, name: role.name })), at: Date.now() };
    emit('snapshot', snapshot); return snapshot;
  }
  async function pollNotices() {
    const mode = await readMode();
    const epoch = contextEpoch;
    const record = await json('/dsh-whale/last-turn.json');
    const notify = noticePolicy.shouldNotify(record, { seq: lastSeq, id: lastId, firstPoll, startedAt });
    firstPoll = false;
    if (Number.isSafeInteger(record.seq)) lastSeq = Math.max(lastSeq, record.seq);
    if (record.id) lastId = record.id;
    const prefs = preferences.get();
    if (!prefs.taskNotices) return;
    const account = mode === 'api' ? await json('/api/account-notices') : null;
    if (mode !== await readMode() || epoch !== contextEpoch) return;
    if (account && observedScope !== null && observedScope !== account.scope) invalidateNotices('account-scope');
    if (account) observedScope = account.scope;
    if (notify) {
      const notice = noticePolicy.snapshot(record);
      const text = mode === 'subscription'
        ? { label: '本轮本机已观测', amount: notice.tokens === null ? '用量待确认' : notice.tokens.toLocaleString('zh-CN') + ' tokens', hint: 'Codex 订阅用量' }
        : { label: notice.label, amount: notice.amount === null ? (notice.tokens === null ? '用量待确认' : notice.tokens.toLocaleString('zh-CN') + ' tokens') : money(notice.amount, notice.currency), hint: notice.completionKind === 'success' ? '任务已完成' : notice.completionKind === 'cancelled' ? '任务已取消' : '任务已结束' };
      emit('notice', { id: 'task:' + notice.id, kind: 'task', display: mode === 'api' ? costDisplay(text, notice.amount !== null) : text, outcome: notice.completionKind });
      void refresh().catch(() => {});
    }
    if (!account) return;
    for (const item of account.notices || []) if (!sentAccounts.has(item.id)) {
      sentAccounts.add(item.id);
      if (sentAccounts.size > 64) sentAccounts.delete(sentAccounts.values().next().value);
      emit('notice', { id: 'account:' + item.id, kind: 'account', accountId: item.id, scope: account.scope,
        display: costDisplay({ label: '账户新增消费', amount: money(item.amount, item.currency), hint: item.concurrent ? '账户合计 · 含并行任务' : '自上次提示以来的账户合计' }) });
    }
  }
  async function action(name, args = {}) {
    if (name === 'refresh') return refresh(true);
    if (name === 'mode') {
      await json('/api/display-mode', { method: 'POST', body: { mode: args.mode } });
      return refresh();
    }
    if (name === 'preferences') { preferences.set(args); emit('snapshot', { ...snapshot, preferences: preferences.get() }); return preferences.get(); }
    if (name === 'bubble-open') {
      const mode = await readMode();
      if (!snapshot || snapshot.mode !== mode) await refresh();
      const epoch = contextEpoch;
      const { config } = await json('/dsh-whale/bubble.json').catch(() => ({ config: null }));
      if (mode !== await readMode() || epoch !== contextEpoch) return { closed: true };
      conversationMode = mode;
      const context = snapshot?.mode === mode ? bubbleContext() : { mode, display: nativeDisplay(mode, null, null), today: '--' };
      return conversation.open(context, config);
    }
    if (name === 'bubble-next' || name === 'bubble-pet') {
      const mode = await readMode();
      return conversationMode === mode && snapshot?.mode === mode ?
        conversation[name === 'bubble-pet' ? 'pet' : 'next'](bubbleContext()) : { closed: true };
    }
    if (name === 'random') return conversation.random(bubbleContext());
    if (name === 'ack-account') return json('/api/account-notices/ack', { method: 'POST', body: { ids: [args.id] } });
    throw Error('不支持此原生操作');
  }
  return { refresh, pollNotices, action, invalidateNotices, snapshot: () => snapshot, json };
}
