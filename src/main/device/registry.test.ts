import { describe, expect, it } from 'vitest';
import {
  BIOS_KEY,
  failureReason,
  MACHINE_KEY,
  MACHINE_VALUE,
  parseRegQuery,
  queryRegistry,
  ReadFailure,
  regExePath,
  regQueryArgs,
  systemDrive,
  type RegRun,
} from './registry';

const MACHINE_OUTPUT = [
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography',
  '    MachineGuid    REG_SZ    1a2b3c4d-5e6f-4a1b-8c2d-0123456789ab',
  '',
  '',
].join('\r\n');

const BIOS_OUTPUT = [
  '',
  'HKEY_LOCAL_MACHINE\\HARDWARE\\DESCRIPTION\\System\\BIOS',
  '    BiosMajorRelease    REG_DWORD    0x5',
  '    BIOSVendor    REG_SZ    American Megatrends Inc.',
  '    BIOSVersion    REG_SZ    F.21',
  '    BIOSReleaseDate    REG_SZ    03/14/2025',
  '    SystemManufacturer    REG_SZ    Micro-Star International Co., Ltd.',
  '    SystemProductName    REG_SZ    MS-7C91',
  '    SystemSKU    REG_SZ',
  '    BaseBoardManufacturer    REG_SZ    Micro-Star International Co., Ltd.',
  '    BaseBoardProduct    REG_SZ    MAG B550 TOMAHAWK (MS-7C91)',
  '',
].join('\r\n');

const WINDOWS = { SystemRoot: 'D:\\Windows' };

describe('reg.exe output', () => {
  it('reads one value and a whole key, keeps only strings', () => {
    expect(parseRegQuery(MACHINE_OUTPUT)).toEqual({
      MachineGuid: '1a2b3c4d-5e6f-4a1b-8c2d-0123456789ab',
    });
    expect(parseRegQuery(BIOS_OUTPUT)).toEqual({
      BIOSVendor: 'American Megatrends Inc.',
      BIOSVersion: 'F.21',
      BIOSReleaseDate: '03/14/2025',
      SystemManufacturer: 'Micro-Star International Co., Ltd.',
      SystemProductName: 'MS-7C91',
      SystemSKU: '',
      BaseBoardManufacturer: 'Micro-Star International Co., Ltd.',
      BaseBoardProduct: 'MAG B550 TOMAHAWK (MS-7C91)',
    });
  });

  it('empty and error output give no values', () => {
    expect(parseRegQuery('')).toEqual({});
    expect(parseRegQuery('\r\n\r\n')).toEqual({});
    expect(
      parseRegQuery('ERROR: The system was unable to find the specified registry key or value.'),
    ).toEqual({});
    expect(parseRegQuery('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n')).toEqual({});
  });
});

describe('reg.exe call', () => {
  it('runs reg.exe by its full path under SystemRoot with the 64-bit view', async () => {
    const calls: { file: string; args: readonly string[] }[] = [];
    const run: RegRun = (file, args) => {
      calls.push({ file, args });
      return Promise.resolve(MACHINE_OUTPUT);
    };
    await queryRegistry(run, WINDOWS, MACHINE_KEY, MACHINE_VALUE);
    await queryRegistry(run, WINDOWS, BIOS_KEY, null).catch(() => undefined);
    expect(calls).toEqual([
      {
        file: 'D:\\Windows\\System32\\reg.exe',
        args: ['query', MACHINE_KEY, '/v', 'MachineGuid', '/reg:64'],
      },
      { file: 'D:\\Windows\\System32\\reg.exe', args: ['query', BIOS_KEY, '/reg:64'] },
    ]);
    expect(regQueryArgs(BIOS_KEY, null)).not.toContain('/v');
  });

  it('the system drive comes from SystemRoot, not from a fixed letter', () => {
    expect(systemDrive(WINDOWS)).toBe('D:\\');
    expect(systemDrive({ windir: 'C:\\WINDOWS' })).toBe('C:\\');
    expect(systemDrive({})).toBeNull();
    expect(regExePath({ SystemRoot: 'Windows' })).toBeNull();
  });

  it('an empty SystemRoot falls back to windir', () => {
    expect(systemDrive({ SystemRoot: '', windir: 'E:\\Windows' })).toBe('E:\\');
    expect(systemDrive({ SystemRoot: '  ', windir: '' })).toBeNull();
  });

  it('a failed run is reduced to a short reason without the command or its output', () => {
    const guid = '1a2b3c4d-5e6f-4a1b-8c2d-0123456789ab';
    const error = (extra: object): Error =>
      Object.assign(new Error(`Command failed: reg.exe ${guid}`), { cmd: guid, ...extra });
    expect(failureReason(error({ code: 1 }))).toBe('exit-1');
    expect(failureReason(error({ code: 'EACCES' }))).toBe('eacces');
    expect(failureReason(error({ killed: true, signal: 'SIGTERM' }))).toBe('timeout');
    expect(failureReason(error({ code: guid }))).toBe('failed');
    expect(failureReason(guid)).toBe('failed');
  });

  it('fails with a short reason when there is no SystemRoot or no values', async () => {
    const run: RegRun = () => Promise.resolve('');
    await expect(queryRegistry(run, {}, MACHINE_KEY, MACHINE_VALUE)).rejects.toMatchObject({
      reason: 'no-system-root',
    });
    await expect(queryRegistry(run, WINDOWS, MACHINE_KEY, MACHINE_VALUE)).rejects.toMatchObject({
      reason: 'empty',
    });
    const denied: RegRun = () => Promise.reject(new ReadFailure('exit-1'));
    await expect(queryRegistry(denied, WINDOWS, MACHINE_KEY, MACHINE_VALUE)).rejects.toMatchObject({
      reason: 'exit-1',
    });
  });
});
