import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTICES_TARGETS, noticesWorkDir } from './notices-plugin.ts';

interface PackageManifest {
  name?: string;
  version?: string;
  license?: string;
  homepage?: string;
  repository?: string | { url?: string };
}

export interface LicenseFile {
  path: string;
  text: string;
}

export interface ThirdPartyPackage {
  name: string;
  version: string;
  license: string;
  source: string | null;
  files: LicenseFile[];
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
// electron-builder leaves extraResources sources out of app.asar, so the copy for resources/ is a
// separate file and the one the renderer reads stays inside the archive.
const outputFiles = ['renderer', 'resources'].map((dir) =>
  join(projectRoot, 'out', dir, 'THIRD_PARTY_NOTICES.txt'),
);
const licenseFileName = /^(licen[cs]e|copying|notice)([-._].*)?$/i;
const rule = '='.repeat(80);
const thinRule = '-'.repeat(80);

// Vite and Rollup append the licenses of the tools they bundle into their own build; only the
// part above this heading covers the code they inject into our bundles.
const bundledToolLicensesHeading = /^# Licenses of bundled dependencies$/m;

// @xmcl/unzip and @xmcl/client are published without a license file; they come from the same
// repository and author as @xmcl/core and declare the same MIT license, so the notice reuses that
// text and says so. lazy-val (pulled in by electron-updater) has no license file in the package or
// its repository; it declares MIT and its author also wrote builder-util-runtime, so the same rule.
const borrowedLicenses: Readonly<Record<string, string>> = {
  '@xmcl/unzip': '@xmcl/core',
  '@xmcl/client': '@xmcl/core',
  'lazy-val': 'builder-util-runtime',
};

function readManifest(dir: string): PackageManifest {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageManifest;
}

function browsableUrl(repository: string): string {
  return repository
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '');
}

function sourceOf(manifest: PackageManifest): string | null {
  const repository =
    typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  return repository === undefined ? (manifest.homepage ?? null) : browsableUrl(repository);
}

function licenseFilePaths(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => !path.split('/').includes('node_modules'))
    .filter((path) => licenseFileName.test(path.split('/').at(-1) ?? ''))
    .sort();
}

function normalizedText(text: string): string {
  const cut = bundledToolLicensesHeading.exec(text);
  const own = cut === null ? text : text.slice(0, cut.index);
  return own
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '')
    .trimEnd();
}

export function readPackage(dir: string): ThirdPartyPackage {
  const manifest = readManifest(dir);
  const name = manifest.name ?? relative(projectRoot, dir);
  return {
    name,
    version: manifest.version ?? 'unknown',
    license: manifest.license ?? 'UNKNOWN',
    source: sourceOf(manifest),
    files: licenseFilePaths(dir).map((path) => ({
      path,
      text: normalizedText(readFileSync(join(dir, path), 'utf8')),
    })),
  };
}

function withBorrowedLicense(item: ThirdPartyPackage): ThirdPartyPackage {
  const lender = borrowedLicenses[item.name];
  if (item.files.length > 0 || lender === undefined) {
    return item;
  }
  const source = readPackage(join(projectRoot, 'node_modules', lender));
  const files = source.files.map((file) => ({
    path: `${file.path} of ${source.name} ${source.version} (the package ships no license file)`,
    text: file.text,
  }));
  return { ...item, files };
}

function readTargetList(target: string): string[] {
  const file = join(noticesWorkDir, `${target}.json`);
  if (!existsSync(file)) {
    throw new Error(`notices: ${relative(projectRoot, file)} is missing, run electron-vite build`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as string[];
}

export function collectPackages(packageDirs: Iterable<string>): ThirdPartyPackage[] {
  const byKey = new Map<string, ThirdPartyPackage>();
  for (const dir of packageDirs) {
    const found = withBorrowedLicense(readPackage(join(projectRoot, dir)));
    byKey.set(`${found.name}@${found.version}`, found);
  }
  return [...byKey.values()].sort(
    (a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'),
  );
}

function header(appName: string, version: string): string[] {
  return [
    `${appName} ${version}`,
    'Copyright © 2026 MC Monitor',
    'Licensed under the GNU General Public License v3.0 only (GPL-3.0-only).',
    'The full license text is in the LICENSE file distributed with the launcher',
    'and at https://www.gnu.org/licenses/gpl-3.0.html.',
    '',
    'Electron and Chromium licenses are in LICENSE.electron.txt and',
    'LICENSES.chromium.html in the launcher installation folder.',
    '',
    'The launcher includes the following third-party packages.',
  ];
}

function packageSection(item: ThirdPartyPackage): string[] {
  const lines = [rule, `${item.name} ${item.version}`, `License: ${item.license}`];
  if (item.source !== null) {
    lines.push(`Source: ${item.source}`);
  }
  for (const file of item.files) {
    lines.push(thinRule, file.path, '', file.text);
  }
  return lines;
}

export function renderNotices(
  appName: string,
  version: string,
  items: ThirdPartyPackage[],
): string {
  const sections = items.flatMap((item) => ['', ...packageSection(item)]);
  return [...header(appName, version), ...sections, ''].join('\n');
}

function main(): void {
  const dirs = new Set(NOTICES_TARGETS.flatMap(readTargetList));
  const items = collectPackages(dirs);
  const unlicensed = items.filter((item) => item.files.length === 0);
  if (unlicensed.length > 0) {
    const names = unlicensed.map((item) => `${item.name}@${item.version}`).join(', ');
    throw new Error(`notices: no license file in ${names}`);
  }
  const app = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
    productName: string;
    version: string;
  };
  const text = renderNotices(app.productName, app.version, items);
  for (const file of outputFiles) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    console.log(`notices: ${relative(projectRoot, file)} lists ${String(items.length)} packages`);
  }
  rmSync(noticesWorkDir, { recursive: true, force: true });
}

if (import.meta.main) {
  main();
}
