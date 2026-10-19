import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(import.meta.dirname, '../../../scripts/update-yml-check');
const BODY = 'installer bytes';

function yml(version: string, sha512 = createHash('sha512').update(BODY).digest('base64')): string {
  const file = `mcmonitor-launcher-${version}-win-x64.exe`;
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${file}`,
    `    sha512: ${sha512}`,
    `    size: ${String(Buffer.byteLength(BODY))}`,
    `path: ${file}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-10-03T10:00:00.000Z'",
    '',
  ].join('\n');
}

describe('scripts/update-yml-check', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yml-check-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(version: string): number | null {
    writeFileSync(join(dir, `mcmonitor-launcher-${version}-win-x64.exe`), BODY);
    return spawnSync('bash', [SCRIPT, dir, version], { encoding: 'utf8' }).status;
  }

  it('stable: latest.yml and beta.yml point to this file', () => {
    writeFileSync(join(dir, 'latest.yml'), yml('0.2.0'));
    writeFileSync(join(dir, 'beta.yml'), yml('0.2.0'));
    expect(run('0.2.0')).toBe(0);
  });

  it('the file changed after the build (Windows signing) — sha512 in yml is stale', () => {
    const stale = createHash('sha512').update('unsigned').digest('base64');
    writeFileSync(join(dir, 'latest.yml'), yml('0.2.0', stale));
    writeFileSync(join(dir, 'beta.yml'), yml('0.2.0', stale));
    expect(run('0.2.0')).toBe(1);
  });

  it('beta: only beta.yml, latest.yml — an error', () => {
    writeFileSync(join(dir, 'beta.yml'), yml('0.3.0-beta.1'));
    expect(run('0.3.0-beta.1')).toBe(0);
    writeFileSync(join(dir, 'latest.yml'), yml('0.3.0-beta.1'));
    expect(run('0.3.0-beta.1')).toBe(1);
  });

  it('macOS: the zip in latest-mac.yml, listed after the disk image', () => {
    const version = '0.2.0';
    const zip = `mcmonitor-launcher-${version}-mac-arm64.zip`;
    const dmg = `mcmonitor-launcher-${version}-mac-arm64.dmg`;
    const sha512 = createHash('sha512').update(BODY).digest('base64');
    const macYml = (size: number): string =>
      [
        `version: ${version}`,
        'files:',
        `  - url: ${dmg}`,
        '    sha512: x',
        '    size: 999',
        `  - url: ${zip}`,
        `    sha512: ${sha512}`,
        `    size: ${String(size)}`,
        `path: ${zip}`,
        `sha512: ${sha512}`,
        '',
      ].join('\n');
    writeFileSync(join(dir, zip), BODY);
    const check = (): number | null =>
      spawnSync('bash', [SCRIPT, dir, version, 'mac'], { encoding: 'utf8' }).status;
    writeFileSync(join(dir, 'latest-mac.yml'), macYml(Buffer.byteLength(BODY)));
    writeFileSync(join(dir, 'beta-mac.yml'), macYml(Buffer.byteLength(BODY)));
    expect(check()).toBe(0);
    writeFileSync(join(dir, 'beta-mac.yml'), macYml(1));
    expect(check()).toBe(1);
  });
});
