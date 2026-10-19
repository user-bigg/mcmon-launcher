import { execFile } from 'node:child_process';
import { win32 } from 'node:path';

const REG_TIMEOUT_MS = 20_000;
const REG_MAX_OUTPUT_BYTES = 64 * 1024;

export const MACHINE_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Cryptography';
export const MACHINE_VALUE = 'MachineGuid';
export const BIOS_KEY = 'HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS';
export const ENVIRONMENT_KEY =
  'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
export const ARCH_VALUE = 'PROCESSOR_ARCHITECTURE';

export type RegValues = Record<string, string>;
export type RegRun = (file: string, args: readonly string[]) => Promise<string>;

export class ReadFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export function systemRoot(env: NodeJS.ProcessEnv): string | null {
  const root = [env.SystemRoot, env.windir].map((item) => item?.trim() ?? '').find(Boolean) ?? '';
  return /^[A-Za-z]:\\/.test(root) ? root : null;
}

export function systemDrive(env: NodeJS.ProcessEnv): string | null {
  const root = systemRoot(env);
  return root === null ? null : `${root.slice(0, 2)}\\`;
}

export function regExePath(env: NodeJS.ProcessEnv): string | null {
  const root = systemRoot(env);
  return root === null ? null : win32.join(root, 'System32', 'reg.exe');
}

export function regQueryArgs(key: string, value: string | null): string[] {
  return ['query', key, ...(value === null ? [] : ['/v', value]), '/reg:64'];
}

const VALUE_LINE = /^ {4}(.+?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/;

export function parseRegQuery(output: string): RegValues {
  const values: RegValues = {};
  for (const line of output.split(/\r?\n/)) {
    const match = VALUE_LINE.exec(line.trimEnd());
    if (match?.[1] !== undefined && match[2] === 'REG_SZ') {
      values[match[1]] = (match[3] ?? '').trim();
    }
  }
  return values;
}

export function failureReason(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return 'failed';
  }
  const { code, killed, signal } = error as { code?: unknown; killed?: unknown; signal?: unknown };
  if (killed === true || typeof signal === 'string') {
    return 'timeout';
  }
  if (typeof code === 'number') {
    return `exit-${String(code)}`;
  }
  return typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? code.toLowerCase() : 'failed';
}

export const runRegExe: RegRun = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        cwd: win32.dirname(file),
        timeout: REG_TIMEOUT_MS,
        maxBuffer: REG_MAX_OUTPUT_BYTES,
        windowsHide: true,
        shell: false,
        encoding: 'utf8',
      },
      (error, stdout) => {
        if (error === null) {
          resolve(stdout);
        } else {
          reject(new ReadFailure(failureReason(error)));
        }
      },
    );
  });

export async function queryRegistry(
  run: RegRun,
  env: NodeJS.ProcessEnv,
  key: string,
  value: string | null,
): Promise<RegValues> {
  const exe = regExePath(env);
  if (exe === null) {
    throw new ReadFailure('no-system-root');
  }
  const values = parseRegQuery(await run(exe, regQueryArgs(key, value)));
  if (Object.keys(values).length === 0) {
    throw new ReadFailure('empty');
  }
  return values;
}
