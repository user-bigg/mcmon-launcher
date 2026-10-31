import { describe, expect, it, vi } from 'vitest';
import type { CrashUpload } from '@shared/telemetry';
import { CRASH_RETRY_MS, sendCrashReport, type CrashReportsOptions } from './crash-reports';
import type { Posted } from './http';

const report: CrashUpload = {
  launch_id: 'f3c1a3c2-6a0e-4c43-9a3e-1b2f1b2f1b2f',
  minecraft: '26.3',
  loader: 'fabric',
  duration_s: 45,
  problem: 'unknown',
  log_tail: '',
};

function options(answers: Posted[]): CrashReportsOptions & { post: ReturnType<typeof vi.fn> } {
  const post = vi.fn((): Promise<Posted> =>
    Promise.resolve(answers.shift() ?? { ok: true as const }),
  );
  return {
    header: () =>
      Promise.resolve({ install: 'install-1', launcher: '0.2.4', os: 'windows', arch: 'x64' }),
    post,
    sleep: vi.fn(() => Promise.resolve()),
    log: vi.fn(),
  };
}

describe('sendCrashReport', () => {
  it('sends the report with the install header', async () => {
    const opts = options([{ ok: true }]);
    await expect(sendCrashReport(opts, report)).resolves.toBe(true);
    expect(opts.post).toHaveBeenCalledWith({
      install: 'install-1',
      launcher: '0.2.4',
      os: 'windows',
      arch: 'x64',
      ...report,
    });
  });

  it('tries once more after a minute when the site was out of reach', async () => {
    const opts = options([{ ok: false, error: { code: 'offline' } }, { ok: true }]);
    await expect(sendCrashReport(opts, report)).resolves.toBe(true);
    expect(opts.sleep).toHaveBeenCalledWith(CRASH_RETRY_MS);
    expect(opts.post).toHaveBeenCalledTimes(2);
  });

  it('does not repeat a refused report or one without launch_id', async () => {
    const refused = options([{ ok: false, error: { code: 'rate-limited', retryAfterS: 60 } }]);
    await expect(sendCrashReport(refused, report)).resolves.toBe(false);
    const anonymous = options([{ ok: false, error: { code: 'offline' } }]);
    const withoutLaunch: CrashUpload = { ...report };
    delete withoutLaunch.launch_id;
    await expect(sendCrashReport(anonymous, withoutLaunch)).resolves.toBe(false);
    expect(refused.post).toHaveBeenCalledTimes(1);
    expect(anonymous.post).toHaveBeenCalledTimes(1);
  });
});
