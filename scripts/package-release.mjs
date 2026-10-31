import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT, VERSION } from '../runtime/paths.mjs';
import { NATIVE_BUNDLE, NATIVE_NAME, NATIVE_ICON, nativeInfoPlist } from './native-bundle.mjs';
import { NODE_RELEASE, releaseFiles, assertRegularSource } from './release-layout.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Release build requires an Apple Silicon Mac.');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const downloads = path.join(ROOT, '.build/downloads'); fs.mkdirSync(downloads, { recursive: true });
const archive = path.join(downloads, NODE_RELEASE.file);
if (!fs.existsSync(archive) || hash(archive) !== NODE_RELEASE.sha256) {
  const response = await fetch(`https://nodejs.org/dist/v${NODE_RELEASE.version}/${NODE_RELEASE.file}`, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error('Node download failed: ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== NODE_RELEASE.sha256) throw Error('Node SHA256 mismatch; refusing to package.');
  fs.writeFileSync(archive, bytes);
}
if (hash(archive) !== NODE_RELEASE.sha256) throw Error('Cached Node checksum mismatch.');
execFileSync(process.execPath, ['scripts/native-macos.mjs', 'build'], { cwd: ROOT, stdio: 'inherit' });
const work = fs.mkdtempSync(path.join(ROOT, '.build/release-'));
const app = path.join(work, NATIVE_BUNDLE), resources = path.join(app, 'Contents/Resources');
const appRoot = path.join(resources, 'app'), helpers = path.join(app, 'Contents/Helpers');
fs.mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
fs.mkdirSync(helpers, { recursive: true }); fs.mkdirSync(appRoot, { recursive: true });
const development = path.join(ROOT, '.build/native-macos', NATIVE_BUNDLE);
fs.copyFileSync(path.join(development, 'Contents/MacOS', NATIVE_NAME), path.join(app, 'Contents/MacOS', NATIVE_NAME));
fs.copyFileSync(path.join(development, 'Contents/Resources', NATIVE_ICON), path.join(resources, NATIVE_ICON));
fs.writeFileSync(path.join(app, 'Contents/Info.plist'), nativeInfoPlist());
// No builder paths, home directory, credentials or launch-time data snapshots.
fs.writeFileSync(path.join(resources, 'launch.json'), JSON.stringify({ mode: 'bundled', version: VERSION, nodeVersion: NODE_RELEASE.version }, null, 2));
for (const relative of releaseFiles(ROOT)) {
  assertRegularSource(ROOT, relative);
  const target = path.join(appRoot, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(ROOT, relative), target);
}
const stem = NODE_RELEASE.file.replace(/\.tar\.gz$/, '');
execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', work, stem + '/bin/node', stem + '/LICENSE']);
const bundledNode = path.join(helpers, 'node');
fs.copyFileSync(path.join(work, stem, 'bin/node'), bundledNode); fs.chmodSync(bundledNode, 0o755);
fs.chmodSync(path.join(app, 'Contents/MacOS', NATIVE_NAME), 0o755);
fs.copyFileSync(path.join(work, stem, 'LICENSE'), path.join(resources, 'NODE-LICENSE'));
const nodeVersion = execFileSync(bundledNode, ['--version'], { encoding: 'utf8' }).trim();
if (nodeVersion !== 'v' + NODE_RELEASE.version) throw Error('Unexpected bundled Node version.');
const linkage = execFileSync('/usr/bin/otool', ['-L', bundledNode], { encoding: 'utf8' });
const dependencies = linkage.trimEnd().split('\n').slice(1).map(line => line.trim().split(' ')[0]);
if (!dependencies.length || dependencies.some(name => !name.startsWith('/usr/lib/') && !name.startsWith('/System/Library/'))) throw Error('Bundled Node has non-system dynamic dependencies.');
execFileSync('/usr/bin/codesign', ['--verify', '--strict', bundledNode], { stdio: 'inherit' });
// Preserve the official Node binary/signature; only the outer app is ad-hoc signed.
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app], { stdio: 'inherit' });
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
const dist = path.join(ROOT, 'dist'); fs.mkdirSync(dist, { recursive: true });
const base = `whale-native-${VERSION}-macos-arm64`;
const zip = path.join(dist, base + '.zip');
if (fs.existsSync(zip)) throw Error('Release output already exists; move the previous artifact aside before rebuilding: ' + zip);
execFileSync('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', app, zip]);
const digest = hash(zip);
fs.writeFileSync(path.join(dist, base + '.sha256'), digest + '  ' + path.basename(zip) + '\n');
fs.writeFileSync(path.join(dist, 'release-build.json'), JSON.stringify({ version: VERSION, architecture: 'arm64', minimumMacOS: '13.5', node: NODE_RELEASE, signature: 'ad-hoc', notarized: false, sha256: digest, archive: path.basename(zip) }, null, 2));
console.log(JSON.stringify({ app, zip, sha256: digest, node: nodeVersion }, null, 2));
