(() => {
  'use strict';
  const el = (parent, tag, text = '', cls = '') => { const node = document.createElement(tag); node.textContent = text; node.className = cls; parent.append(node); return node; };
  async function api(route, method = 'GET', body) {
    const response = await fetch(route, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json(); if (!response.ok || value.ok === false) throw Error(value.error || '操作未完成'); return value;
  }
  const page = el(document.body, 'main', '', 'native-settings dshwv-menu dshwv-menu-open whale-dashboard');
  const header = el(page, 'header', '', 'whale-account-menu'); el(header, 'strong', '小鲸鱼');
  const modes = el(header, 'div'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '额度展示模式');
  const nav = el(page, 'nav', '', 'whale-dashboard-tabs'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', '小鲸鱼页面');
  const scroll = el(page, 'div', '', 'whale-dashboard-scroll');
  const sections = {}, tabs = {};
  let selected = 'overview', mode = 'api', revision = 0, balance = null, insights = null;
  const modeButtons = [];
  function select(name) {
    if (!sections[name]) return;
    selected = name;
    for (const key of Object.keys(sections)) {
      sections[key].hidden = key !== name; tabs[key].setAttribute('aria-selected', String(key === name)); tabs[key].tabIndex = key === name ? 0 : -1;
    }
    scroll.scrollTop = 0;
  }
  for (const [key, label] of [['overview', '概览'], ['usage', '用量'], ['settings', '设置']]) {
    const tab = el(nav, 'button', label); tab.type = 'button'; tab.id = 'native-tab-' + key;
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'native-page-' + key); tab.onclick = () => select(key); tabs[key] = tab;
    const section = el(scroll, 'section', '', 'whale-' + key + '-page'); section.id = 'native-page-' + key;
    section.setAttribute('role', 'tabpanel'); section.setAttribute('aria-labelledby', tab.id); sections[key] = section;
  }
  nav.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const keys = Object.keys(tabs), index = keys.indexOf(selected);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
    event.preventDefault(); select(keys[next]); tabs[keys[next]].focus();
  });
  window.addEventListener('whale-native-page', event => select(event.detail));
  const data = el(sections.overview, 'div', '', 'whale-overview-data');
  const actions = el(sections.overview, 'div', '', 'whale-dashboard-actions');
  function button(parent, label, action, cls = '') {
    const node = el(parent, 'button', label, cls); node.type = 'button';
    node.onclick = () => Promise.resolve().then(action).catch(error => window.whaleToast(error.message)); return node;
  }
  const refresh = button(actions, '刷新', () => load(true));
  const configure = button(actions, '配置 API 余额 →', () => window.dispatchEvent(new Event(mode === 'subscription' ? 'whale-open-insights' : 'whale-open-settings')), 'whale-mode-open');
  const usage = el(sections.usage, 'div', '', 'whale-token-usage');
  const status = el(sections.settings, 'p', '', 'native-save-status'); status.setAttribute('role', 'status');
  const groups = {};
  for (const [key, label] of [['appearance', '外观与位置'], ['sound', '声音与气泡'], ['resources', '用量与资源']]) {
    const group = el(sections.settings, 'details', '', 'whale-menu-group'); el(group, 'summary', label); group.open = key === 'appearance'; groups[key] = group;
  }
  window.WhaleAccountView = { get mode() { return mode; }, quotaLabel: item => item.windowDurationMins === 300 ? '5 小时额度' : item.windowDurationMins === 10080 ? '每周额度' : '额度窗口' };
  function updateMode(next) {
    mode = next; balance = null; insights = null;
    document.documentElement.dataset.accountMode = next;
    for (const item of modeButtons) item.setAttribute('aria-pressed', String(item.dataset.mode === next));
    configure.textContent = next === 'subscription' ? '查看订阅额度 →' : '配置 API 余额 →'; render();
  }
  for (const [value, label] of [['api', 'API 余额'], ['subscription', 'Codex 订阅']]) {
    const node = button(modes, label, async () => {
      modeButtons.forEach(item => { item.disabled = true; }); ++revision;
      try { const result = await api('/api/display-mode', 'POST', { mode: value }); updateMode(result.mode || result.displayMode); await load(); }
      finally { modeButtons.forEach(item => { item.disabled = false; }); }
    }); node.dataset.mode = value; modeButtons.push(node);
  }
  const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const tokens = value => numeric(value) ? value.toLocaleString() + ' token' : '暂无记录';
  const money = (value, currency = balance?.currency || 'USD') => numeric(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value) : '金额未知';
  function metric(parent, label, value) { const row = el(parent, 'div', '', 'whale-metric'); el(row, 'span', label); el(row, 'strong', value); }
  function note(parent, text) { el(parent, 'p', text, 'whale-dashboard-note'); }
  function render() {
    data.replaceChildren(); usage.replaceChildren();
    if (mode === 'subscription') {
      const sub = insights?.subscription || {}, grid = el(data, 'div', '', 'whale-quota-grid');
      for (const [minutes, label] of [[300, '5 小时额度'], [10080, '每周额度']]) {
        const item = (sub.windows || []).find(item => item.windowDurationMins === minutes), box = el(grid, 'section', '', 'whale-quota-box');
        const remaining = numeric(item?.usedPercent) ? Math.max(0, 100 - item.usedPercent) : null;
        el(box, 'span', label); el(box, 'strong', remaining === null ? '未观测' : '剩余 ' + remaining.toFixed(1) + '%');
        if (remaining !== null) { const bar = el(box, 'progress'); bar.max = 100; bar.value = remaining; bar.setAttribute('aria-label', label + '剩余'); }
        el(box, 'small', item?.resetsAt && Number.isFinite(Date.parse(item.resetsAt)) ? '重置：' + new Date(item.resetsAt).toLocaleString() : '等待官方额度快照');
        if (item?.stale) el(box, 'small', '快照已过期，请刷新');
      }
      if (!sub.available) note(data, sub.reason || '正在读取订阅额度…');
      note(data, '额度来自官方快照；token 来自本机记录，两者分别统计。');
      el(usage, 'h3', '本机 token 用量'); const totals = sub.tokens || insights?.tokens || {};
      for (const [key, label] of [['last5Hours', '滚动 5 小时'], ['total', '近 7 天'], ['input', '输入'], ['output', '输出'], ['cachedInput', '缓存输入'], ['reasoningOutput', '推理输出']]) metric(usage, label, tokens(totals[key]));
      note(usage, '缓存与推理可能是输入、输出的子集，请勿重复相加。其他设备不计入本机记录。');
      button(usage, '查看订阅额度详情', () => window.dispatchEvent(new Event('whale-open-insights')));
    } else {
      const view = window.WhaleBalanceView.describe(balance || {});
      el(data, 'span', view.label, 'whale-dashboard-label'); el(data, 'strong', view.message || money(view.balance), 'whale-balance-number');
      if (balance?.stale) note(data, '上次成功数据，等待更新');
      metric(data, '今日已观测消耗', view.canObserve ? money(view.todayUsage) : '金额未知');
      note(data, '消费记录在“用量”页；点击宠物的气泡继续查看小鲸鱼留言。');
      el(usage, 'h3', 'API 消费记录'); metric(usage, '今日已观测消耗', money(view.todayUsage));
      note(usage, '账户消费与本轮估算分别记账，不重复累加。');
      button(usage, '历史账户账本', () => window.dispatchEvent(new Event('whale-open-history')));
    }
  }
  async function load(force = false) {
    const own = ++revision, requestedMode = mode; refresh.disabled = true;
    try {
      const result = await api(mode === 'subscription' ? '/api/insights' : '/dsh-whale/balance.json' + (force ? '?refresh=1' : ''));
      if (own !== revision || mode !== requestedMode) return;
      if (mode === 'subscription') insights = result; else balance = result; render();
    } finally { if (own === revision) refresh.disabled = false; }
  }
  async function save(patch) { await api('/native/preferences', 'PUT', patch); status.textContent = '已保存'; }
  function field(group, label, control, key, prefs) {
    const row = el(group, 'label', label, 'dshwv-menu-row'); row.append(control);
    control.onchange = async () => {
      const previous = prefs[key], next = control.type === 'checkbox' ? control.checked : control.type === 'number' ? Number(control.value) : control.value;
      control.disabled = true;
      try { await save({ [key]: next }); prefs[key] = next; }
      catch (error) { if (control.type === 'checkbox') control.checked = previous; else control.value = previous; window.whaleToast(error.message); }
      finally { control.disabled = false; }
    };
  }
  function choice(group, label, key, choices, prefs) {
    const control = document.createElement('select');
    for (const [value, label] of choices) { const option = el(control, 'option', label); option.value = value; }
    control.value = prefs[key]; field(group, label, control, key, prefs); return control;
  }
  Promise.all([api('/native/preferences'), api('/api/display-mode'), api('/dsh-whale/roles.json')]).then(async ([prefs, display, roles]) => {
    updateMode(display.mode);
    choice(groups.appearance, '窗口模式', 'followMode', [['standalone', '独立桌面'], ['follow-codex', '跟随 Codex']], prefs);
    for (const [key, label, min, max, step] of [['scale', '宠物大小', .5, 2.5, .1], ['volume', '按压音量', 0, 1, .05], ['bubbleSeconds', '气泡显示秒数（0 不关闭）', 0, 60, 1]]) {
      const control = document.createElement('input'); control.type = 'number'; Object.assign(control, { min, max, step, value: prefs[key] });
      field(key === 'scale' ? groups.appearance : groups.sound, label, control, key, prefs);
    }
    for (const [key, label] of [['flipped', '水平翻转'], ['sound', '按压音效'], ['outsideDismiss', '点击空白关闭气泡'], ['taskNotices', '任务与账户消费提示']]) {
      const control = document.createElement('input'); control.type = 'checkbox'; control.checked = prefs[key];
      field(key === 'flipped' ? groups.appearance : groups.sound, label, control, key, prefs);
    }
    choice(groups.sound, '内置音效组', 'soundSet', [['duck', '小黄鸭'], ['fx1', '音效 1']], prefs);
    const roleControl = choice(groups.appearance, '已有角色', 'role', (roles.roles || []).map(role => [role.id, role.name]), prefs);
    button(groups.resources, 'API 连接与价格', () => window.dispatchEvent(new Event('whale-open-settings')));
    button(groups.resources, '历史账户账本', () => window.dispatchEvent(new Event('whale-open-history')));
    button(groups.resources, '素材导入 / 导出', () => window.dispatchEvent(new Event('whale-open-workshop')));
    button(groups.appearance, '导入角色图片 / 动图', () => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif';
      input.onchange = async () => { try {
        const file = input.files?.[0]; if (!file) return;
        if (file.size > 20 * 1024 * 1024) throw Error('角色文件不能超过 20 MiB');
        const image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
        const result = await api('/dsh-whale/roles.json', 'POST', { name: file.name, image });
        const added = result.roles.find(role => ![...roleControl.options].some(option => option.value === role.id));
        if (added) { const option = el(roleControl, 'option', added.name); option.value = added.id; await save({ role: added.id }); prefs.role = added.id; roleControl.value = added.id; }
      } catch (error) { window.whaleToast(error.message); } }; input.click();
    });
    note(sections.settings, '原生预览版 · 默认留言与动图已迁移。复杂编排编辑、动态文字特效和自定义任务音效仍在迁移中。');
    await load(); page.dataset.ready = 'true';
  }).catch(error => { status.textContent = error.message; });
  select('overview');
})();
