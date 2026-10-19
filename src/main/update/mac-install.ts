import { execFile, spawn } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { posix as path } from 'node:path';
import { promisify } from 'node:util';
import { compareUpdateVersions } from '@shared/update';

const run = promisify(execFile);

export type MacInstallBlocker = 'move' | 'readonly';

const UNPACK_TIMEOUT_MS = 5 * 60_000;
const CHECK_TIMEOUT_MS = 2 * 60_000;
const SWAP_WAIT_TICKS = 600;

export interface MacBundleCheck {
  signatureValid: (bundle: string) => Promise<boolean>;
  bundleId: (bundle: string) => Promise<string | null>;
}

export function appBundleOf(execPath: string): string | null {
  const bundle = path.resolve(execPath, '..', '..', '..');
  return bundle.endsWith('.app') ? bundle : null;
}

// A disk image and App Translocation are mounted read-only; anywhere else a folder the launcher
// cannot write to is a matter of permissions, not of where it was started from.
export function macInstallBlocker(
  bundle: string | null,
  writable: (target: string) => boolean,
): MacInstallBlocker | null {
  if (bundle === null || bundle.includes('/AppTranslocation/')) {
    return 'move';
  }
  if (writable(bundle) && writable(path.dirname(bundle))) {
    return null;
  }
  return bundle.startsWith('/Volumes/') ? 'move' : 'readonly';
}

export function isWritable(target: string): boolean {
  try {
    accessSync(target, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function stagingDirOf(bundle: string): string {
  return path.join(path.dirname(bundle), `.${path.basename(bundle)}.update`);
}

export const systemBundleCheck: MacBundleCheck = {
  signatureValid: (bundle) =>
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], {
      timeout: CHECK_TIMEOUT_MS,
    }).then(
      () => true,
      () => false,
    ),
  bundleId: (bundle) =>
    run(
      '/usr/bin/plutil',
      [
        '-extract',
        'CFBundleIdentifier',
        'raw',
        '-o',
        '-',
        path.join(bundle, 'Contents', 'Info.plist'),
      ],
      { timeout: CHECK_TIMEOUT_MS },
    ).then(
      ({ stdout }) => stdout.trim(),
      () => null,
    ),
};

function stderrOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  return typeof stderr === 'string' && stderr.trim() !== '' ? stderr.trim() : String(error);
}

export async function unpackBundle(archive: string, staging: string): Promise<string> {
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    await run('/usr/bin/ditto', ['-x', '-k', '--noqtn', archive, staging], {
      timeout: UNPACK_TIMEOUT_MS,
    });
  } catch (error) {
    throw new Error(`ditto could not unpack the update: ${stderrOf(error)}`, { cause: error });
  }
  const bundles = (await readdir(staging)).filter((name) => name.endsWith('.app'));
  if (bundles.length !== 1 || bundles[0] === undefined) {
    throw new Error(`the update archive holds ${String(bundles.length)} applications`);
  }
  return path.join(staging, bundles[0]);
}

export async function assertSameApp(
  next: string,
  appId: string,
  check: MacBundleCheck,
): Promise<void> {
  const id = await check.bundleId(next);
  if (id !== appId) {
    throw new Error(`the update is ${id ?? 'not an application'}, not ${appId}`);
  }
  if (!(await check.signatureValid(next))) {
    throw new Error('the code signature of the update does not verify');
  }
}

export async function prepareBundle(
  archive: string,
  bundle: string,
  appId: string,
  check: MacBundleCheck,
): Promise<string> {
  const staging = stagingDirOf(bundle);
  try {
    const next = await unpackBundle(archive, staging);
    await assertSameApp(next, appId, check);
    return next;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export function failureMarkOf(bundle: string): string {
  return `${stagingDirOf(bundle)}.failed`;
}

// Returns the version a swap after an earlier quit could not put in place, if any. The mark
// stays until the launcher reaches that version, so a failing update is not offered again on
// every other start.
export async function removeLeftovers(
  bundle: string,
  currentVersion: string,
): Promise<string | null> {
  const mark = failureMarkOf(bundle);
  const text = await readFile(mark, 'utf8').then(
    (content) => content.trim(),
    () => '',
  );
  await rm(stagingDirOf(bundle), { recursive: true, force: true });
  if (text !== '' && compareUpdateVersions(text, currentVersion) > 0) {
    return text;
  }
  await rm(mark, { force: true });
  return null;
}

export function isPrepared(next: string | null): next is string {
  return next !== null && existsSync(path.join(next, 'Contents', 'Info.plist'));
}

// The swap runs after the launcher has exited, so it cannot be done from the launcher itself.
// It gives up and touches nothing if the launcher is still running after two minutes. The old
// bundle is put back if the new one does not take its place; the failed version is left in a
// mark for the next start, and a restart asked for opens the launcher either way.
export const SWAP_SCRIPT = `pid="$1"; app="$2"; next="$3"; staging="$4"; relaunch="$5"; version="$6"; ticks="$7"
while /bin/kill -0 "$pid" 2>/dev/null; do
  ticks=$((ticks - 1))
  [ "$ticks" -gt 0 ] || exit 0
  /bin/sleep 0.2
done
status=0
/bin/mkdir -p "$staging/old" && /bin/mv "$app" "$staging/old/" || status=1
if [ "$status" = 0 ]; then
  if ! /bin/mv "$next" "$app"; then
    /bin/mv "$staging/old/$(/usr/bin/basename "$app")" "$app"
    status=1
  fi
fi
if [ "$status" = 0 ]; then
  /bin/rm -rf "$staging"
else
  printf '%s' "$version" > "$staging.failed"
fi
if [ "$relaunch" = 1 ]; then /usr/bin/open "$app"; fi
exit "$status"
`;

export function swapArguments(
  pid: number,
  bundle: string,
  next: string,
  staging: string,
  relaunch: boolean,
  version: string,
  ticks = SWAP_WAIT_TICKS,
): string[] {
  return [
    '-c',
    SWAP_SCRIPT,
    'mcmonitor-update',
    String(pid),
    bundle,
    next,
    staging,
    relaunch ? '1' : '0',
    version,
    String(ticks),
  ];
}

export function startSwap(args: string[]): void {
  spawn('/bin/sh', args, { detached: true, stdio: 'ignore' }).unref();
}
