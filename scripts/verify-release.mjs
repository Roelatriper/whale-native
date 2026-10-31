import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { ROOT, VERSION } from '../runtime/paths.mjs';
import { NATIVE_BUNDLE, NATIVE_NAME } from './native-bundle.mjs';
import { NODE_RELEASE, releaseFiles } from './release-layout.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Release verification requires macOS arm64.');
const dist = path.join(ROOT, 'dist'), base = `whale-native-${VERSION}-macos-arm64`;
const archive = path.join(dist, base + '.zip');
const digest = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
assert.equal(fs.readFileSync(path.join(dist, base + '.sha256'), 'utf8'), digest + '  ' + base + '.zip\n');
const info = JSON.parse(fs.readFileSync(path.join(dist, 'release-build.json'), 'utf8'));
assert.equal(info.sha256, digest); assert.equal(info.version, VERSION); assert.deepEqual(info.node, NODE_RELEASE);
const entries = execFileSync('/usr/bin/unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n');
assert.ok(entries.every(name => name.startsWith(NATIVE_BUNDLE + '/') && !name.split('/').includes('..')));
const scratch = fs.mkdtempSync('/private/tmp/whale-release-');
const relocated = path.join(scratch, 'Relocated app with spaces'); fs.mkdirSync(relocated);
execFileSync('/usr/bin/ditto', ['-x', '-k', archive, relocated]);
const app = path.join(relocated, NATIVE_BUNDLE), resources = path.join(app, 'Contents/Resources');
const appRoot = path.join(resources, 'app');
const launch = JSON.parse(fs.readFileSync(path.join(resources, 'launch.json'), 'utf8'));
assert.deepEqual(launch, { mode: 'bundled', version: VERSION, nodeVersion: NODE_RELEASE.version });
function walk(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix + entry.name; assert.equal(entry.isSymbolicLink(), false, relative);
    return entry.isDirectory() ? walk(path.join(directory, entry.name), relative + '/') : [relative];
  }).sort();
}
const files = walk(appRoot);
assert.deepEqual(files, releaseFiles(ROOT));
for (const relative of files) assert.deepEqual(fs.readFileSync(path.join(appRoot, relative)), fs.readFileSync(path.join(ROOT, relative)), 'Bundle differs from current source: ' + relative);
assert.ok(files.every(name => !/\.DS_Store|\.env|\.git\/|ledger\.json|auth\.json|config\.toml|native-status\.json|\.build\//.test(name)));
for (const relative of files) {
  if (/\.(?:mjs|js|json|html|css|md)$/.test(relative))
    assert.doesNotMatch(fs.readFileSync(path.join(appRoot, relative), 'utf8'), /\/Users\/[A-Za-z0-9_.-]+\//, relative);
}
assert.ok(fs.statSync(path.join(resources, 'NODE-LICENSE')).size > 10000);
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
const bundledNode = path.join(app, 'Contents/Helpers/node');
assert.equal(execFileSync(bundledNode, ['--version'], { encoding: 'utf8' }).trim(), 'v' + NODE_RELEASE.version);
const linkage = execFileSync('/usr/bin/otool', ['-L', bundledNode], { encoding: 'utf8' });
const dependencies = linkage.trimEnd().split('\n').slice(1).map(line => line.trim().split(' ')[0]);
assert.ok(dependencies.length && dependencies.every(name => name.startsWith('/usr/lib/') || name.startsWith('/System/Library/')));
const dataDir = fs.mkdtempSync('/private/tmp/whale-native-release-');
const environment = { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', CODEX_HOME: path.join(dataDir, 'isolated-codex') };
delete environment.NODE_OPTIONS; delete environment.NODE_PATH;
delete environment.WHALE_HOME; delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(app, 'Contents/MacOS', NATIVE_NAME), ['--data-dir', dataDir, '--fixture', '--self-test'],
  { cwd: scratch, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
let diagnostics = ''; child.stdout.resume(); child.stderr.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-4000); });
const timer = setTimeout(() => child.kill('SIGTERM'), 70000);
const [code, signal] = await once(child, 'close'); clearTimeout(timer);
let smoke; try { smoke = JSON.parse(fs.readFileSync(path.join(dataDir, 'native-smoke.json'), 'utf8')); }
catch { throw Error('Relocated app did not finish smoke test: ' + diagnostics); }
assert.equal(code, 0, diagnostics); assert.equal(signal, null, diagnostics); assert.equal(smoke.ok, true, JSON.stringify(smoke));
assert.equal(fs.existsSync(path.join(dataDir, 'native-session.lock')), false);
assert.equal(fs.existsSync(path.join(dataDir, 'runtime.json')), false);
const result = { ok: true, version: VERSION, archive: path.basename(archive), sha256: digest,
  node: NODE_RELEASE.version, sourceFiles: files.length, relocated: true, externalNodeRequired: false,
  smoke, note: 'Synthetic data only; not a notarization or oldest-macOS compatibility test.' };
fs.writeFileSync(path.join(dist, 'release-verification.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, diagnosticDirectory: dataDir, relocatedApp: app }, null, 2));
