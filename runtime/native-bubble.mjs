import fs from 'node:fs';

// Extracted unchanged from the upstream widget; no legacy browser renderer is shipped.
const defaults = JSON.parse(fs.readFileSync(new URL('../assets/bubble-defaults.json', import.meta.url), 'utf8'));
export const defaultNativeBubbleItems = () => structuredClone(defaults);

const validID = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const weight = value => Number.isFinite(Number(value)) ? Math.max(1, Number(value) || 1) : 1;
const modules = item => Array.isArray(item?.modules) ? item.modules.filter(mod => mod && typeof mod === 'object').slice(0, 6) : [];
function pick(items, random) {
  let remaining = random() * items.reduce((sum, item) => sum + weight(item.w), 0);
  return items.find(item => (remaining -= weight(item.w)) < 0) || items.at(-1);
}
export function usesApiMoney(item) {
  return !item || item.kind === 'normal' || item.kind === 'custom' && modules(item).some(mod =>
    ['balance', 'today'].includes(mod.type) || /当前\s*API\s*余额|\{(?:balance|expense)_(?:api|ds)\}/i.test(String(mod.text || '') + String(mod.tpl || '')));
}
function row(text, style = {}, type = '') {
  const level = Math.max(1, Math.min(50, Math.round(Number(style.size) || 6)));
  return { text: String(text ?? '').slice(0, 4096), size: Math.round(40 + (level - 1) * 200 / 49),
    bold: style.bold === true || type === 'balance' || type === 'random' && style.bold !== false,
    italic: style.italic === true, underline: style.ul === true,
    color: /^#[a-f0-9]{6}$/i.test(style.color || '') ? style.color : '#536ba9',
    gradient: typeof style.rgb === 'string' ? style.rgb : '' };
}

// One conversation owns its cursor and random picks. Refresh never rerolls or
// mutates an already displayed message. Pet clicks refresh the current message
// step without resetting the conversation to money or exhausting its cursor.
export function createNativeBubble({ random = Math.random } = {}) {
  let items = [], index = 0, messageStep = null;
  const lastPicks = new WeakMap();
  function display(item, context) {
    if (!item || item.kind === 'normal') return context.display;
    if (item.kind === 'random') item = defaults[1].options[0].item;
    if (item.kind !== 'custom') return context.display;
    const rows = [];
    let imageRoute = null;
    for (const mod of modules(item)) {
      if (mod.type === 'image') {
        if (validID(mod.imgId)) imageRoute = '/dsh-whale/bubble-img.png?id=' + mod.imgId;
        continue;
      }
      let text = mod.text || '', style = mod;
      const lines = Array.isArray(mod.lines) ? mod.lines.filter(line => line && typeof line === 'object') : [];
      if (mod.type === 'random' && lines.length) {
        let chosen;
        // Same bounded avoidance of the previous pick as the original widget.
        for (let attempt = 0; attempt < 6; attempt++) {
          chosen = pick(lines, random);
          if (lines.length === 1 || chosen !== lastPicks.get(mod)) break;
        }
        if (lines.length > 1 && chosen === lastPicks.get(mod)) chosen = lines.find(line => line !== chosen);
        lastPicks.set(mod, chosen); text = chosen.t; style = { ...mod, ...chosen };
      } else if (mod.type === 'balance' || mod.type === 'today') {
        const amount = mod.type === 'balance' ? context.display.amount : context.today;
        text = String(mod.tpl || (mod.type === 'balance' ? amount : '今日已观测 ' + amount));
        for (const key of mod.type === 'balance' ? ['balance_api', 'balance_ds'] : ['expense_api', 'expense_ds']) text = text.split('{' + key + '}').join(amount);
      }
      rows.push(row(text, style, mod.type));
    }
    const text = rows.map(value => value.text).filter(Boolean).join('\n');
    return { kind: imageRoute ? 'image' : 'message', label: '', amount: text, hint: '', rows, ...(imageRoute ? { imageRoute } : {}) };
  }
  function resolve(step, context, messagesOnly = false) {
    if (!step || typeof step !== 'object') return null;
    let item = step;
    if (step.kind === 'choice') {
      const options = (Array.isArray(step.options) ? step.options : []).filter(option => option?.item &&
        (!(messagesOnly || context.mode === 'subscription') || !usesApiMoney(option.item)));
      if (!options.length) return null;
      item = pick(options, random).item;
    }
    if (!['normal', 'random', 'custom'].includes(item.kind)) return null;
    return (messagesOnly || context.mode === 'subscription') && usesApiMoney(item) ? null : item;
  }
  function next(context, messagesOnly = false) {
    while (index < items.length) {
      const step = items[index++], item = resolve(step, context, messagesOnly);
      if (!item) continue;
      messageStep = usesApiMoney(item) ? null : step;
      return display(item, context);
    }
    messageStep = null;
    return { closed: true };
  }
  return {
    open(context, config) {
      items = Array.isArray(config?.items) && config.items.length ? structuredClone(config.items.slice(0, 256)) : defaultNativeBubbleItems(); index = 0; messageStep = null;
      if (context.mode === 'subscription') return context.display;
      return next(context);
    },
    next,
    pet(context) {
      if (messageStep) {
        const item = resolve(messageStep, context, true);
        if (item) return display(item, context);
      }
      const nextMessage = next(context, true);
      if (!nextMessage.closed) return nextMessage;
      // Even a saved money-only sequence can enter the shipped message pool.
      messageStep = defaults[1];
      return display(resolve(messageStep, context, true), context);
    },
    random(context) { return display(pick(defaults[1].options, random).item, context); },
  };
}
