import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const NATIVE_NAME = 'whale-native';
export const NATIVE_BUNDLE = NATIVE_NAME + '.app';
export const NATIVE_ICON = NATIVE_NAME + '.icns';
// Keep the identifier stable: renaming must not create a second app identity.
export const NATIVE_BUNDLE_ID = 'com.api-balance-whale.native';
export const NATIVE_VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export function nativeInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${NATIVE_BUNDLE_ID}</string><key>CFBundleExecutable</key><string>${NATIVE_NAME}</string><key>CFBundleName</key><string>${NATIVE_NAME}</string><key>CFBundleDisplayName</key><string>${NATIVE_NAME}</string><key>CFBundleIconFile</key><string>${NATIVE_ICON}</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${NATIVE_VERSION.split("-")[0]}</string><key>CFBundleVersion</key><string>1</string><key>WhaleReleaseVersion</key><string>${NATIVE_VERSION}</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/><key>LSMinimumSystemVersion</key><string>13.5</string></dict></plist>`;
}

// Convert the existing transparent default pet, without redrawing/cropping it.
// Every required 1x/2x representation is bundled for Finder and high-DPI icons.
export function buildNativeIcon(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const scratch = fs.mkdtempSync(path.join(path.dirname(destination), 'whale-icon-'));
  const iconset = path.join(scratch, 'whale-native.iconset'); fs.mkdirSync(iconset);
  try {
    for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
      const output = path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`);
      execFileSync('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), source, '--out', output], { stdio: 'ignore' });
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', destination], { stdio: 'pipe' });
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
