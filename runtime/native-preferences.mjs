import path from 'node:path';
import { readJson, writeJson } from './paths.mjs';

export const NATIVE_DEFAULTS = Object.freeze({ version: 1, scale: 1, flipped: false, sound: true, volume: 0.6,
  soundSet: 'duck', outsideDismiss: true, followMode: 'standalone', role: 'default', position: null,
  taskNotices: true, bubbleSeconds: 8 });

export function validateNativePreferences(patch, previous = NATIVE_DEFAULTS) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('原生外观设置必须是对象');
  const next = { ...previous, version: 1 };
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'version') { if (value !== 1) throw Error('不支持此外观版本'); continue; }
    if (['flipped', 'sound', 'outsideDismiss', 'taskNotices'].includes(key)) {
      if (typeof value !== 'boolean') throw Error('开关设置无效');
    } else if (['scale', 'volume', 'bubbleSeconds'].includes(key)) {
      const [min, max] = key === 'scale' ? [0.5, 2.5] : key === 'volume' ? [0, 1] : [0, 60];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw Error('外观数值超出范围');
    } else if (key === 'followMode') {
      if (!['standalone', 'follow-codex'].includes(value)) throw Error('显示模式无效');
    } else if (key === 'soundSet') {
      if (!['duck', 'fx1'].includes(value)) throw Error('请选择内置音效组');
    } else if (key === 'role') {
      if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw Error('角色标识无效');
    } else if (key === 'position') {
      if (value !== null && (!value || Object.keys(value).sort().join(',') !== 'x,y' ||
        ![value.x, value.y].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 100000))) throw Error('位置无效');
    } else throw Error('未知原生外观字段：' + key);
    next[key] = value;
  }
  return next;
}

export function nativePreferenceStore(dataDir) {
  const file = path.join(dataDir, 'native-ui-state.json');
  const legacy = readJson(path.join(dataDir, '.dshw-size.json'), {});
  const mode = readJson(path.join(dataDir, 'follow-config.json'), {}).mode;
  const defaults = { ...NATIVE_DEFAULTS, followMode: mode === 'follow-codex' ? mode : 'standalone',
    outsideDismiss: legacy.outsideDismissOn === true, sound: legacy.sound !== false,
    volume: typeof legacy.vol === 'number' && legacy.vol >= 0 && legacy.vol <= 1 ? legacy.vol : NATIVE_DEFAULTS.volume };
  let current = validateNativePreferences(readJson(file, {}), defaults);
  return {
    get: () => structuredClone(current),
    set(patch) { const next = validateNativePreferences(patch, current); writeJson(file, next); current = next; return this.get(); },
  };
}
