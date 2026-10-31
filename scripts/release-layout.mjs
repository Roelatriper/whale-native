import fs from 'node:fs';
import path from 'node:path';

export const NODE_RELEASE = Object.freeze({
  version: '24.22.2',
  file: 'node-v24.22.2-darwin-arm64.tar.gz',
  sha256: 'aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a',
});
export const RELEASE_UI = ['widget.html', 'ui.css', 'client.js', 'connection-settings.js', 'money.js',
  'balance-view.js', 'usage-history.js', 'insights.js', 'workshop.js', 'turn-notice.js', 'account-view.js'];
export const RELEASE_ASSETS = ['DSniang1.png', 'DSniang02.png', 'Ya1.mp3', 'Ya2.mp3', 'D1.mp3', 'D2.mp3',
  'rua.gif', 'bubble-petpet.gif', 'bubble-yue-money.gif', 'bubble-defaults.json'];
// Closed inclusion rules: never copy a checkout wholesale into a release.
export function releaseFiles(root) {
  const names = (directory, suffix) => fs.readdirSync(path.join(root, directory))
    .filter(name => /^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(name) && name.endsWith(suffix))
    .map(name => directory + '/' + name);
  return ['package.json', 'LICENSE', 'PROVENANCE.md', 'THIRD_PARTY_NOTICES.md',
    ...names('runtime', '.mjs'), ...names('lib', '.mjs'),
    ...['backend.mjs', 'settings.js', 'settings.css'].map(name => 'desktop/native/' + name),
    ...RELEASE_UI.map(name => 'desktop/ui/' + name), ...RELEASE_ASSETS.map(name => 'assets/' + name),
    'vendor/smol-toml/package.json', 'vendor/smol-toml/LICENSE', ...names('vendor/smol-toml/dist', '.js')].sort();
}
export function assertRegularSource(root, relative) {
  if (relative.startsWith('/') || relative.split('/').some(part => part === '..' || part.startsWith('.')))
    throw Error('Unsafe release path: ' + relative);
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('Release source must not be a symlink: ' + relative);
  }
  if (!fs.statSync(current).isFile()) throw Error('Release source is not a regular file: ' + relative);
}
