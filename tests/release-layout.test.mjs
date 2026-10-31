import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseFiles, assertRegularSource, NODE_RELEASE } from '../scripts/release-layout.mjs';
import { VERSION } from '../runtime/paths.mjs';
import { nativeInfoPlist, NATIVE_VERSION } from '../scripts/native-bundle.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('native release has a single version and pinned official arm64 runtime', () => {
  assert.equal(VERSION, '0.1.0-preview.1'); assert.equal(NATIVE_VERSION, VERSION);
  assert.match(nativeInfoPlist(), /<key>WhaleReleaseVersion<\/key><string>0\.1\.0-preview\.1<\/string>/);
  assert.match(nativeInfoPlist(), /<key>LSMinimumSystemVersion<\/key><string>13\.5<\/string>/);
  assert.match(NODE_RELEASE.sha256, /^[a-f0-9]{64}$/);
  assert.match(NODE_RELEASE.file, /darwin-arm64\.tar\.gz$/);
});
test('release whitelist includes native runtime/resources/licenses, not legacy renderer or personal state', () => {
  const files = releaseFiles(root); assert.equal(files.length, new Set(files).size);
  for (const file of files) assertRegularSource(root, file);
  for (const file of ['runtime/session-worker.mjs', 'runtime/insights-worker.mjs', 'desktop/native/backend.mjs',
    'desktop/ui/turn-notice.js', 'assets/bubble-defaults.json', 'assets/DSniang1.png', 'LICENSE', 'vendor/smol-toml/LICENSE']) assert.ok(files.includes(file), file);
  assert.equal(files.some(file => /whale-widget\.js|main\.cjs|\.swift$|runtime\/(mcp|process)\.mjs|\.DS_Store|auth\.json|\.codex-plugin/.test(file)), false);
});
test('release source guard rejects path traversal, hidden paths, directories and symlinks', t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-release-guard-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  fs.writeFileSync(path.join(scratch, 'file.json'), '{}'); fs.symlinkSync(path.join(scratch, 'file.json'), path.join(scratch, 'linked.json'));
  assertRegularSource(scratch, 'file.json');
  for (const name of ['../file.json', '/file.json', '.env', 'linked.json']) assert.throws(() => assertRegularSource(scratch, name));
});
