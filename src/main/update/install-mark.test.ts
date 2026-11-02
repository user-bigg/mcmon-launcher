import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  failedRelaunch,
  HIDDEN_RELAUNCH_MS,
  installOutcome,
  parseInstallMark,
  relaunchesHidden,
  takeInstallMark,
  writeInstallMark,
  type InstallMark,
} from './install-mark';

const MARK: InstallMark = { from: '0.2.7', to: '0.2.8', via: 'tray', at: 1_000_000 };

describe('update install mark', () => {
  it('is read once and removed', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mark-')), 'update-install.json');
    writeInstallMark(file, MARK);
    expect(takeInstallMark(file)).toEqual(MARK);
    expect(existsSync(file)).toBe(false);
    expect(takeInstallMark(file)).toBeNull();
  });

  it('a damaged or foreign file is no mark', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mark-')), 'update-install.json');
    writeFileSync(file, '{"from":"0.2.7"');
    expect(takeInstallMark(file)).toBeNull();
    expect(parseInstallMark({ ...MARK, via: 'cron' })).toBeNull();
    expect(parseInstallMark({ ...MARK, to: '../x' })).toBeNull();
  });

  it('hides the window only right after a quiet install from the tray', () => {
    expect(relaunchesHidden(MARK, '0.2.8', MARK.at + 30_000)).toBe(true);
    expect(relaunchesHidden(MARK, '0.2.7', MARK.at + 30_000)).toBe(false);
    expect(relaunchesHidden(MARK, '0.2.8', MARK.at + HIDDEN_RELAUNCH_MS)).toBe(false);
    expect(relaunchesHidden(MARK, '0.2.8', MARK.at - 1)).toBe(false);
    expect(relaunchesHidden({ ...MARK, via: 'restart' }, '0.2.8', MARK.at + 30_000)).toBe(false);
    expect(relaunchesHidden(null, '0.2.8', MARK.at)).toBe(false);
  });

  it('remembers a version that a restart for the update did not put in place', () => {
    expect(failedRelaunch(MARK, '0.2.7')).toBe('0.2.8');
    expect(failedRelaunch({ ...MARK, via: 'restart' }, '0.2.7')).toBe('0.2.8');
    expect(failedRelaunch({ ...MARK, via: 'quit' }, '0.2.7')).toBeNull();
    expect(failedRelaunch(MARK, '0.2.8')).toBeNull();
    expect(failedRelaunch(null, '0.2.7')).toBeNull();
  });

  it('tells an installed version from a start of the old one', () => {
    expect(installOutcome(MARK, '0.2.8')).toEqual({
      stage: 'installed',
      to: '0.2.8',
      from: '0.2.7',
      via: 'tray',
      error_code: null,
    });
    expect(installOutcome(MARK, '0.2.7')).toMatchObject({
      stage: 'failed',
      error_code: 'not_installed',
    });
  });
});
