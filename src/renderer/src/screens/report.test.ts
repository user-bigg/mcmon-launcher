// @vitest-environment happy-dom
import { flushPromises, type DOMWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountState } from '@shared/account';
import { fill, formatNumber } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import type { ReportError, ReportReason, ReportResult, ServerReport } from '@shared/report';
import type { SiteError, SiteMeta, SiteResult } from '@shared/site';
import { reportReasons, SERVER_IDS } from '../mock/servers';
import {
  mountAt,
  stubLauncher,
  TEST_NOW,
  TEST_USER,
  testCard,
  type Mounted,
  type Stub,
} from '../testing';

const PATH = `/server/${String(SERVER_IDS.wasteland)}`;
const LOGINS = 'https://mc-mon.ru/account/logins';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.app.unmount();
  mounted = undefined;
  document.body.replaceChildren();
  localStorage.clear();
  vi.useRealTimers();
});

function signedIn(): AccountState {
  return { seq: 1, encryptionAvailable: true, user: TEST_USER, connect: null, error: null };
}

function meta(reasons: ReportReason[] = reportReasons): Promise<SiteResult<SiteMeta>> {
  return Promise.resolve({
    ok: true,
    value: { links: { logins: LOGINS }, connect: null, reportReasons: reasons },
    stale: false,
    fetchedAt: TEST_NOW.toISOString(),
  });
}

function metaFailed(error: SiteError): Promise<SiteResult<SiteMeta>> {
  return Promise.resolve({ ok: false, error });
}

function stubWith(report: ServerReport | null, user = true): Stub {
  const stub = stubLauncher();
  if (user) {
    stub.api.account.state = vi.fn(() => Promise.resolve(signedIn()));
  }
  stub.api.site.meta = vi.fn(() => meta());
  const value = testCard({ report });
  stub.api.site.server = vi.fn(() =>
    Promise.resolve({ ok: true as const, value, stale: false, fetchedAt: TEST_NOW.toISOString() }),
  );
  return stub;
}

function replies(stub: Stub, ...results: ReportResult[]): void {
  stub.api.site.report = vi.fn(() =>
    Promise.resolve(
      results.shift() ?? { ok: false as const, error: { code: 'server_error' as const } },
    ),
  );
}

function refused(error: ReportError): ReportResult {
  return { ok: false, error };
}

async function open(stub: Stub): Promise<Mounted['app']> {
  mounted = await mountAt(PATH, { stub, demo: false });
  return mounted.app;
}

function plain(text: string): string {
  return text.replaceAll('\u00a0', ' ');
}

function counter(count: number): string {
  return fill(ru.report.noteCount, { count, max: formatNumber(1000) });
}

function block(app: Mounted['app']): DOMWrapper<Element> {
  return app.find('[data-report]');
}

function reportLink(app: Mounted['app']): DOMWrapper<Element> | undefined {
  return block(app)
    .findAll('button')
    .find((item) => item.text() === ru.report.link);
}

function submitButton(app: Mounted['app']): DOMWrapper<Element> {
  return app.find('[data-report-submit]');
}

function formButton(app: Mounted['app'], text: string): DOMWrapper<Element> | undefined {
  return app.findAll('[data-report-form] button').find((item) => item.text() === text);
}

async function openForm(app: Mounted['app']): Promise<void> {
  const link = reportLink(app);
  if (link === undefined) {
    throw new Error('report link missing');
  }
  await link.trigger('click');
  await flushPromises();
}

async function choose(app: Mounted['app'], code: string): Promise<void> {
  await app.find(`[data-report-form] input[value="${code}"]`).setValue(true);
}

async function send(app: Mounted['app']): Promise<void> {
  await submitButton(app).trigger('click');
  await flushPromises();
}

describe('report on a server', () => {
  it('a guest sees the same report link, click shows a sign-in hint', async () => {
    const app = await open(stubWith(null, false));
    expect(app.find('[data-report-guest]').exists()).toBe(false);
    const link = reportLink(app);
    expect(link).toBeDefined();
    await link?.trigger('click');
    const hint = app.find('[data-report-guest]');
    expect(hint.exists()).toBe(true);
    expect(plain(hint.text())).toBe('Чтобы отправить жалобу, войдите.');
    expect(hint.find('a').attributes('href')).toBe('/accounts');
  });

  it('a guest hint closes on an outside click', async () => {
    const app = await open(stubWith(null, false));
    await reportLink(app)?.trigger('click');
    expect(app.find('[data-report-guest]').exists()).toBe(true);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    expect(app.find('[data-report-guest]').exists()).toBe(false);
  });

  it('signed in, but the card has no report (cache or offline) — the block is empty', async () => {
    const app = await open(stubWith(null));
    expect(block(app).text()).toBe('');
    expect(reportLink(app)).toBeUndefined();
  });

  it('allowed: the form expands in place, focus on the first reason, no default selection', async () => {
    const stub = stubWith({ mine: null, allowed: true });
    replies(stub, { ok: true, value: { at: '2026-10-03T12:00:00Z' } });
    const app = await open(stub);
    await openForm(app);
    const form = app.find('[data-report-form]');
    expect(form.find('legend').text()).toBe(ru.report.title);
    expect(form.find('[role="radiogroup"]').exists()).toBe(true);
    const radios = form.findAll('input[type="radio"]');
    expect(radios.map((radio) => radio.element.closest('label')?.textContent.trim())).toEqual(
      reportReasons.map((reason) => reason.label),
    );
    expect(radios.some((radio) => (radio.element as HTMLInputElement).checked)).toBe(false);
    expect(document.activeElement).toBe(radios[0]?.element);
    expect(form.text()).toContain(ru.report.noteOptional);
    expect(form.text()).toContain(counter(0));
    expect(submitButton(app).attributes('type')).toBe('submit');
    expect(submitButton(app).attributes('disabled')).toBeDefined();
    await choose(app, 'fake_stats');
    await form.find('textarea').setValue('  Онлайн 5000, на сервере пусто ');
    expect(submitButton(app).attributes('disabled')).toBeUndefined();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await send(app);
    expect(stub.api.site.report).toHaveBeenCalledWith(SERVER_IDS.wasteland, {
      reason: 'fake_stats',
      note: 'Онлайн 5000, на сервере пусто',
    });
    const status = app.find('[data-report-status]');
    expect(status.text()).toBe(ru.report.sent);
    expect(status.attributes('role')).toBeUndefined();
    expect(document.activeElement).toBe(status.element);
    expect(app.find('[data-report-form]').exists()).toBe(false);
    vi.advanceTimersByTime(5000);
    await flushPromises();
    expect(app.find('[data-report-status]').text()).toBe('Вы пожаловались 3 октября');
    expect(reportLink(app)).toBeUndefined();
  });

  it('already reported — a Moscow date instead of a link', async () => {
    const app = await open(stubWith({ mine: { at: '2026-09-30T22:30:00Z' }, allowed: true }));
    expect(app.find('[data-report-status]').text()).toBe('Вы пожаловались 1 октября');
    expect(reportLink(app)).toBeUndefined();
  });

  it('not allowed (own server) — nothing is shown', async () => {
    const app = await open(stubWith({ mine: null, allowed: false }));
    expect(block(app).text()).toBe('');
    expect(reportLink(app)).toBeUndefined();
  });

  it("other: a 'required' label, 'Send' is disabled while the text is shorter than 10", async () => {
    const stub = stubWith({ mine: null, allowed: true });
    const app = await open(stub);
    await openForm(app);
    await choose(app, 'other');
    expect(plain(app.find('[data-report-form]').text())).toContain(
      'Подробности — обязательно, не короче 10 знаков',
    );
    const note = app.find('[data-report-form] textarea');
    expect(note.attributes('aria-required')).toBe('true');
    await note.setValue('   коротко   ');
    expect(submitButton(app).attributes('disabled')).toBeDefined();
    await send(app);
    await app.find('[data-report-form]').trigger('submit');
    await flushPromises();
    expect(stub.api.site.report).not.toHaveBeenCalled();
    await note.setValue('Адрес ведёт на чужой сервер');
    expect(submitButton(app).attributes('disabled')).toBeUndefined();
    expect(app.find('[data-report-form]').text()).toContain(counter(27));
  });

  it("limit reached: the form closes, a single grey line 'the next one is available tomorrow'", async () => {
    const stub = stubWith({ mine: null, allowed: true });
    replies(stub, refused({ code: 'daily_limit', limit: 5, resetsAt: '2026-10-04T07:30:00Z' }));
    const app = await open(stub);
    await openForm(app);
    await choose(app, 'forbidden');
    await send(app);
    expect(app.find('[data-report-form]').exists()).toBe(false);
    const status = app.find('[data-report-status]');
    expect(status.text()).toBe(fill(ru.report.limit, { count: 5, unit: 'жалоб' }));
    expect(document.activeElement).toBe(status.element);
    expect(reportLink(app)).toBeUndefined();
  });

  it("the limit resets today — 'today at HH:MM' Moscow time, after the reset the link comes back", async () => {
    const stub = stubWith({ mine: null, allowed: true });
    replies(stub, refused({ code: 'daily_limit', limit: 3, resetsAt: '2026-10-03T18:30:00Z' }));
    const app = await open(stub);
    await openForm(app);
    await choose(app, 'forbidden');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await send(app);
    expect(app.find('[data-report-status]').text()).toBe(
      fill(ru.report.limitToday, { count: 3, unit: 'жалобы', time: '21:30' }),
    );
    vi.advanceTimersByTime(6.5 * 3600 * 1000 - 1000);
    await flushPromises();
    expect(reportLink(app)).toBeUndefined();
    vi.advanceTimersByTime(1000);
    await flushPromises();
    expect(app.find('[data-report-status]').text()).toBe('');
    expect(reportLink(app)).toBeDefined();
  });

  it("Esc and 'Cancel' close the form, focus returns to the link", async () => {
    const app = await open(stubWith({ mine: null, allowed: true }));
    await openForm(app);
    await app.find('[data-report-form] textarea').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(app.find('[data-report-form]').exists()).toBe(false);
    expect(document.activeElement).toBe(reportLink(app)?.element);
    await openForm(app);
    await formButton(app, ru.report.cancel)?.trigger('click');
    await flushPromises();
    expect(app.find('[data-report-form]').exists()).toBe(false);
  });

  it("during submission Esc and 'Cancel' do not erase the draft", async () => {
    const stub = stubWith({ mine: null, allowed: true });
    let answer: (result: ReportResult) => void = () => undefined;
    stub.api.site.report = vi.fn(
      () =>
        new Promise<ReportResult>((resolve) => {
          answer = resolve;
        }),
    );
    const app = await open(stub);
    await openForm(app);
    await choose(app, 'fake_stats');
    await app.find('[data-report-form] textarea').setValue('Пусто на сервере');
    await send(app);
    const cancel = formButton(app, ru.report.cancel);
    expect(cancel?.attributes('disabled')).toBeDefined();
    await app.find('[data-report-form] textarea').trigger('keydown', { key: 'Escape' });
    await cancel?.trigger('click');
    await flushPromises();
    expect(app.find('[data-report-form]').exists()).toBe(true);
    expect((app.find('[data-report-form] textarea').element as HTMLTextAreaElement).value).toBe(
      'Пусто на сервере',
    );
    answer(refused({ code: 'server_not_found' }));
    await flushPromises();
    expect(app.find('[data-report-error]').text()).toBe(ru.report.errors.server_not_found);
    expect(document.activeElement).toBe(submitButton(app).element);
  });

  it('site rejections — human language with an action', async () => {
    const stub = stubWith({ mine: null, allowed: true });
    replies(
      stub,
      refused({ code: 'email_unverified' }),
      refused({ code: 'note_required' }),
      refused({ code: 'server_not_found' }),
      refused({ code: 'offline' }),
      refused({ code: 'timeout' }),
      refused({ code: 'already_reported', reportedAt: '2026-10-02T10:00:00Z' }),
    );
    const app = await open(stub);
    await openForm(app);
    await choose(app, 'wrong_address');
    await send(app);
    const error = (): DOMWrapper<Element> => app.find('[data-report-error]');
    expect(error().text()).toContain(ru.report.errors.email_unverified);
    const logins = error()
      .findAll('a')
      .find((item) => item.text() === ru.report.openSite);
    expect(document.activeElement).toBe(logins?.element);
    await logins?.trigger('click');
    expect(stub.api.openExternal).toHaveBeenCalledWith(LOGINS);
    await send(app);
    expect(plain(error().text())).toBe('Опишите подробнее: не короче 10 знаков');
    await send(app);
    expect(error().text()).toBe(ru.report.errors.server_not_found);
    await send(app);
    const form = (): DOMWrapper<Element> => app.find('[data-report-form]');
    expect(form().text()).toContain(ru.state.offlineTitle);
    await formButton(app, ru.state.retry)?.trigger('click');
    await flushPromises();
    expect(form().text()).toContain(ru.state.timeoutTitle);
    expect(form().text()).not.toContain(ru.state.offlineTitle);
    await send(app);
    expect(form().exists()).toBe(false);
    expect(app.find('[data-report-status]').text()).toBe('Вы пожаловались 2 октября');
  });

  it('too_frequent — wait and retry, the retry succeeds', async () => {
    const stub = stubWith({ mine: null, allowed: true });
    replies(stub, refused({ code: 'too_frequent', retryAfterS: 2 }), {
      ok: true,
      value: { at: '2026-10-03T12:00:00Z' },
    });
    const app = await open(stub);
    await openForm(app);
    await choose(app, 'donation_fraud');
    await send(app);
    expect(app.find('[data-report-error]').text()).toBe(ru.report.errors.too_frequent);
    expect(document.activeElement).toBe(submitButton(app).element);
    await send(app);
    expect(stub.api.site.report).toHaveBeenCalledTimes(2);
    expect(app.find('[data-report-status]').text()).toBe(ru.report.sent);
  });

  it('own_server on submit — a line instead of a link, focus on it', async () => {
    const stub = stubWith({ mine: null, allowed: true });
    replies(stub, refused({ code: 'own_server' }));
    const app = await open(stub);
    await openForm(app);
    await choose(app, 'donation_fraud');
    await send(app);
    const status = app.find('[data-report-status]');
    expect(status.text()).toBe(ru.report.errors.own_server);
    expect(document.activeElement).toBe(status.element);
    expect(app.find('[data-report-form]').exists()).toBe(false);
    expect(reportLink(app)).toBeUndefined();
  });

  it("/meta did not respond — 'No connection' with focus on 'Retry', the retry bypasses the cache", async () => {
    const stub = stubWith({ mine: null, allowed: true });
    stub.api.site.meta = vi.fn((revalidate?: boolean) =>
      revalidate === true ? meta() : metaFailed({ code: 'offline' }),
    );
    const app = await open(stub);
    await openForm(app);
    const form = app.find('[data-report-form]');
    expect(form.text()).toContain(ru.state.offlineTitle);
    expect(form.find('input[type="radio"]').exists()).toBe(false);
    const retry = formButton(app, ru.state.retry);
    expect(document.activeElement).toBe(retry?.element);
    await retry?.trigger('click');
    await flushPromises();
    expect(stub.api.site.meta).toHaveBeenLastCalledWith(true);
    const radios = app.findAll('[data-report-form] input[type="radio"]');
    expect(radios).toHaveLength(reportReasons.length);
    expect(document.activeElement).toBe(radios[0]?.element);
  });

  it("/meta responded without reasons — 'The site did not provide reasons', the retry re-asks the site", async () => {
    const stub = stubWith({ mine: null, allowed: true });
    stub.api.site.meta = vi.fn((revalidate?: boolean) =>
      meta(revalidate === true ? reportReasons : []),
    );
    const app = await open(stub);
    await openForm(app);
    const form = app.find('[data-report-form]');
    expect(form.text()).toContain(ru.report.reasonsEmptyTitle);
    expect(form.text()).not.toContain(ru.state.offlineTitle);
    expect(submitButton(app).exists()).toBe(false);
    const retry = formButton(app, ru.state.retry);
    expect(document.activeElement).toBe(retry?.element);
    await retry?.trigger('click');
    await flushPromises();
    expect(stub.api.site.meta).toHaveBeenLastCalledWith(true);
    expect(app.findAll('[data-report-form] input[type="radio"]')).toHaveLength(
      reportReasons.length,
    );
  });

  it("demo: sending without network, 'Report sent'", async () => {
    const stub = stubLauncher();
    mounted = await mountAt(PATH, { stub, demo: true });
    const app = mounted.app;
    await openForm(app);
    await choose(app, 'forbidden');
    await send(app);
    expect(stub.api.site.report).not.toHaveBeenCalled();
    expect(app.find('[data-report-status]').text()).toBe(ru.report.sent);
  });
});
