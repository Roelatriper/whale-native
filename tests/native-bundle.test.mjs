import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NATIVE_NAME, NATIVE_BUNDLE, nativeInfoPlist, buildNativeIcon } from '../scripts/native-bundle.mjs';

test('native bundle and Finder name use whale-native with a stable app identity and icon', () => {
  assert.equal(NATIVE_NAME, 'whale-native'); assert.equal(NATIVE_BUNDLE, 'whale-native.app');
  const plist = nativeInfoPlist();
  for (const key of ['CFBundleName', 'CFBundleDisplayName', 'CFBundleExecutable']) assert.ok(plist.includes(`<key>${key}</key><string>whale-native</string>`));
  assert.ok(plist.includes('<key>CFBundleIdentifier</key><string>com.api-balance-whale.native</string>'));
  assert.ok(plist.includes('<key>CFBundleIconFile</key><string>whale-native.icns</string>'));
});

test('default pet produces a complete macOS icon file with Retina representations', { skip: process.platform !== 'darwin' }, t => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-icon-test-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const output = path.join(scratch, 'whale-native.icns');
  buildNativeIcon(path.join(root, 'assets/DSniang1.png'), output);
  const bytes = fs.readFileSync(output); assert.equal(bytes.toString('ascii', 0, 4), 'icns');
  assert.equal(bytes.readUInt32BE(4), bytes.length);
  const types = []; let offset = 8;
  while (offset < bytes.length) { types.push(bytes.toString('ascii', offset, offset + 4)); const size = bytes.readUInt32BE(offset + 4); assert.ok(size >= 8); offset += size; }
  for (const type of ['ic07', 'ic08', 'ic09', 'ic10']) assert.ok(types.includes(type), type);
  assert.deepEqual(fs.readdirSync(scratch), ['whale-native.icns']);
});
