import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appBundleOf,
  assertSameApp,
  failureMarkOf,
  macInstallBlocker,
  prepareBundle,
  removeLeftovers,
  stagingDirOf,
  swapArguments,
  unpackBundle,
  type MacBundleCheck,
} from './mac-install';

const BUNDLE = '/Applications/MC Monitor Launcher.app';
const APP_ID = 'com.mcmonitor.launcher';
const ours: MacBundleCheck = {
  signatureValid: () => Promise.resolve(true),
  bundleId: () => Promise.resolve(APP_ID),
};

describe('where the launcher lives', () => {
  it('finds the bundle from the executable inside it', () => {
    expect(appBundleOf(`${BUNDLE}/Contents/MacOS/MC Monitor Launcher`)).toBe(BUNDLE);
    expect(appBundleOf('/usr/local/bin/electron')).toBeNull();
  });

  it('asks to move a launcher run from a disk image or translocation', () => {
    const writable = (): boolean => true;
    const readOnly = (): boolean => false;
    expect(macInstallBlocker(BUNDLE, writable)).toBeNull();
    expect(
      macInstallBlocker('/Volumes/MC Monitor Launcher/MC Monitor Launcher.app', readOnly),
    ).toBe('move');
    expect(
      macInstallBlocker(
        '/private/var/folders/x/T/AppTranslocation/1/d/MC Monitor Launcher.app',
        writable,
      ),
    ).toBe('move');
    expect(macInstallBlocker(null, writable)).toBe('move');
  });

  it('updates on another disk it can write to, and reports a folder it cannot', () => {
    expect(macInstallBlocker('/Volumes/Games/MC Monitor Launcher.app', () => true)).toBeNull();
    expect(macInstallBlocker(BUNDLE, (target) => target !== '/Applications')).toBe('readonly');
    expect(macInstallBlocker(BUNDLE, (target) => target !== BUNDLE)).toBe('readonly');
  });

  it('unpacks next to the bundle, on the same volume', () => {
    expect(stagingDirOf(BUNDLE)).toBe('/Applications/.MC Monitor Launcher.app.update');
  });
});

describe('the unpacked update', () => {
  it('is accepted only as our application with a valid signature', async () => {
    await expect(assertSameApp('/tmp/next.app', APP_ID, ours)).resolves.toBeUndefined();
    await expect(
      assertSameApp('/tmp/next.app', APP_ID, {
        ...ours,
        bundleId: () => Promise.resolve('com.other.app'),
      }),
    ).rejects.toThrow(/com\.other\.app, not com\.mcmonitor\.launcher/);
    await expect(
      assertSameApp('/tmp/next.app', APP_ID, { ...ours, bundleId: () => Promise.resolve(null) }),
    ).rejects.toThrow(/not an application/);
    await expect(
      assertSameApp('/tmp/next.app', APP_ID, {
        ...ours,
        signatureValid: () => Promise.resolve(false),
      }),
    ).rejects.toThrow(/signature/);
  });
});

describe.skipIf(process.platform !== 'darwin')('unpacking and swapping on macOS', () => {
  let work = '';

  beforeEach(() => {
    work = realpathSync(mkdtempSync(join(tmpdir(), 'mac-update-')));
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  function fakeApp(root: string, version: string): string {
    const bundle = join(root, 'MC Monitor Launcher.app');
    mkdirSync(join(bundle, 'Contents'), { recursive: true });
    writeFileSync(join(bundle, 'Contents', 'Info.plist'), version);
    return bundle;
  }

  function versionOf(bundle: string): string {
    return readFileSync(join(bundle, 'Contents', 'Info.plist'), 'utf8');
  }

  function zipOf(source: string, archive: string): void {
    const result = spawnSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', source, archive]);
    expect(result.status).toBe(0);
  }

  function finishedPid(): number {
    return spawnSync('/usr/bin/true').pid;
  }

  it('unpacks exactly one application and refuses an archive without one', async () => {
    zipOf(fakeApp(join(work, 'source'), '0.2.0'), join(work, 'update.zip'));
    const next = await unpackBundle(join(work, 'update.zip'), join(work, 'staging'));
    expect(versionOf(next)).toBe('0.2.0');

    mkdirSync(join(work, 'empty'));
    writeFileSync(join(work, 'empty', 'readme.txt'), 'no app');
    zipOf(join(work, 'empty'), join(work, 'empty.zip'));
    await expect(unpackBundle(join(work, 'empty.zip'), join(work, 'staging'))).rejects.toThrow(
      /holds 0 applications/,
    );
  });

  it('leaves nothing behind when the update is not ours', async () => {
    const bundle = fakeApp(join(work, 'Applications'), '0.1.0');
    zipOf(fakeApp(join(work, 'source'), '0.2.0'), join(work, 'update.zip'));
    const foreign: MacBundleCheck = { ...ours, bundleId: () => Promise.resolve('com.other.app') };
    await expect(prepareBundle(join(work, 'update.zip'), bundle, APP_ID, foreign)).rejects.toThrow(
      /com\.other\.app/,
    );
    expect(existsSync(stagingDirOf(bundle))).toBe(false);
  });

  it('waits for the launcher to exit, then swaps the bundle and cleans up', async () => {
    const bundle = fakeApp(join(work, 'Applications'), '0.1.0');
    const staging = stagingDirOf(bundle);
    zipOf(fakeApp(join(work, 'source'), '0.2.0'), join(work, 'update.zip'));
    const next = await prepareBundle(join(work, 'update.zip'), bundle, APP_ID, ours);
    const launcher = spawn('/bin/sleep', ['1']);
    const swap = spawn(
      '/bin/sh',
      swapArguments(launcher.pid ?? 0, bundle, next, staging, false, '0.2.0'),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(versionOf(bundle)).toBe('0.1.0');
    const code = await new Promise((resolve) => swap.on('exit', resolve));
    expect(code).toBe(0);
    expect(versionOf(bundle)).toBe('0.2.0');
    expect(existsSync(staging)).toBe(false);
  });

  it('puts the old bundle back when the new one cannot take its place', () => {
    const bundle = fakeApp(join(work, 'Applications'), '0.1.0');
    const staging = stagingDirOf(bundle);
    mkdirSync(staging);
    const missing = join(staging, 'gone.app');
    const result = spawnSync(
      '/bin/sh',
      swapArguments(finishedPid(), bundle, missing, staging, false, '0.2.0'),
    );
    expect(result.status).toBe(1);
    expect(versionOf(bundle)).toBe('0.1.0');
  });

  it('marks the version that could not replace the app until the launcher reaches it', async () => {
    const bundle = fakeApp(join(work, 'Applications'), '0.1.0');
    const staging = stagingDirOf(bundle);
    mkdirSync(staging);
    spawnSync(
      '/bin/sh',
      swapArguments(finishedPid(), bundle, join(staging, 'gone.app'), staging, false, '0.2.0'),
    );
    expect(readFileSync(failureMarkOf(bundle), 'utf8')).toBe('0.2.0');
    expect(await removeLeftovers(bundle, '0.1.0')).toBe('0.2.0');
    expect(existsSync(staging)).toBe(false);
    expect(await removeLeftovers(bundle, '0.1.0')).toBe('0.2.0');
    expect(await removeLeftovers(bundle, '0.2.0')).toBeNull();
    expect(existsSync(failureMarkOf(bundle))).toBe(false);
  });

  it('touches nothing while the launcher keeps running past the wait', async () => {
    const bundle = fakeApp(join(work, 'Applications'), '0.1.0');
    const staging = stagingDirOf(bundle);
    zipOf(fakeApp(join(work, 'source'), '0.2.0'), join(work, 'update.zip'));
    const next = await prepareBundle(join(work, 'update.zip'), bundle, APP_ID, ours);
    const launcher = spawn('/bin/sleep', ['5']);
    const result = spawnSync(
      '/bin/sh',
      swapArguments(launcher.pid ?? 0, bundle, next, staging, false, '0.2.0', 2),
    );
    launcher.kill();
    expect(result.status).toBe(0);
    expect(versionOf(bundle)).toBe('0.1.0');
    expect(existsSync(failureMarkOf(bundle))).toBe(false);
  });
});
