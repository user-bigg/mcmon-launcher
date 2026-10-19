// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerCard, ServerList } from '@shared/catalog';
import type { CrashAnalysis } from '@shared/crash';
import { crashes } from '../mock/player';
import { mountAt, stubLauncher, testCard, TEST_NOW, type Mounted } from '../testing';

const PAYLOAD =
  '<script>alert(1)</script><img src=x onerror=alert(1)><svg onload=alert(1)>{{ 7*7 }}${7*7}%s%n';

const HOSTILE_MARKDOWN = [
  `## ${PAYLOAD}`,
  '[клик](javascript:alert(1)) [данные](data:text/html,<script>alert(1)</script>) [файл](file:///C:/Windows/System32/calc.exe)',
  '[[вложенная](javascript:alert(1))](https://ok.example) ![<img src=x onerror=alert(1)>](https://evil.example/t.png)',
  '- <iframe src="javascript:alert(1)"></iframe>\n- `<script>alert(2)</script>`\n- [сайт](https://ok.example/путь)',
  '<a href="javascript:alert(1)">ссылка</a> <style>*{display:none}</style> \u0000 \u202Eexe.txt',
].join('\n\n');

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.app.unmount();
  mounted = undefined;
  document.body.replaceChildren();
  localStorage.clear();
});

function hostile(): ServerCard {
  return testCard({
    name: `Сервер ${PAYLOAD}`,
    description: PAYLOAD,
    description_md: HOSTILE_MARKDOWN,
    rules_md: PAYLOAD,
    tags: ['pvp', '<script>', 'javascript:alert(1)', 'a'.repeat(33)],
    wipe_label: PAYLOAD.slice(0, 80),
    icon_url: 'app://launcher/cache/icons/0123456789abcdef0123456789abcdef.png',
    links: { youtube: 'https://youtube.com/@ok' },
    site_url: 'https://evil.example/',
    launch: {
      kind: 'own_launcher',
      url: 'https://evil.example/launcher',
      label: PAYLOAD.slice(0, 80),
    },
    topSlot: { tier: 'gold' },
  });
}

function hostileList(): ServerList {
  const card = hostile();
  return {
    data: [card, { ...card, id: 4 }],
    topSlots: { diamond: [], gold: [{ ...card, id: 5 }] },
    topSlotsFree: { diamond: 0, gold: 0 },
    meta: { page: 1, per_page: 30, total: 3 },
  };
}

function fetched<T>(value: T): Promise<{ ok: true; value: T; stale: false; fetchedAt: string }> {
  return Promise.resolve({ ok: true, value, stale: false, fetchedAt: TEST_NOW.toISOString() });
}

// outerHTML keeps '<' unescaped inside attribute values, and a quoted value is inert text, so the
// markup is checked with labels and titles blanked; text nodes are escaped by the serializer, and
// href and src are checked on their own below.
function markup(root: Element): string {
  const copy = root.cloneNode(true) as Element;
  for (const element of [copy, ...copy.querySelectorAll('*')]) {
    for (const name of element.getAttributeNames()) {
      if (name !== 'href' && name !== 'src') {
        element.setAttribute(name, '');
      }
    }
  }
  return new XMLSerializer().serializeToString(copy);
}

function expectInert(root: Element): void {
  const html = markup(root);
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/<[a-z][^>]*\son\w+=/i);
  expect(
    root.querySelectorAll('script, iframe, object, embed, base, style, link, meta'),
  ).toHaveLength(0);
  for (const element of root.querySelectorAll('*')) {
    const handlers = element.getAttributeNames().filter((name) => name.startsWith('on'));
    expect(handlers).toEqual([]);
  }
  for (const link of root.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href') ?? '';
    const allowed = href === '' || /^(https:\/\/|\/(?!\/)|#\/)/.test(href);
    expect({ href, allowed }).toEqual({ href, allowed: true });
  }
  for (const image of root.querySelectorAll('img')) {
    const src = image.getAttribute('src') ?? '';
    expect(
      src.startsWith('https:') || src.startsWith('http:') || src.startsWith('javascript:'),
    ).toBe(false);
    expect(src.startsWith('data:text') || src.startsWith('data:image/svg')).toBe(false);
  }
}

describe('hostile site strings in the interface', () => {
  it('server page: HTML, templates and links from the description render as plain text', async () => {
    const card = hostile();
    const stub = stubLauncher();
    stub.api.site.server = vi.fn(() => fetched(card));
    mounted = await mountAt(`/server/${String(card.id)}`, { stub, demo: false });
    const root = mounted.app.element as Element;
    expectInert(document.body);
    expect(mounted.app.find('h1').text()).toBe(`Сервер ${PAYLOAD}`);
    expect(mounted.app.find('.prose').text()).toContain('<script>alert(1)</script>');
    expect(mounted.app.find('.prose').text()).toContain('{{ 7*7 }}');
    expect(mounted.app.find('.prose').text()).not.toContain('49');
    const links = mounted.app.findAll('.prose a').map((link) => link.attributes('href'));
    expect(links).toEqual(['https://ok.example/путь']);
    expect(root.querySelector('.server-icon')?.getAttribute('src')).toMatch(
      /^app:\/\/launcher\/cache\/icons\/[0-9a-f]{32}\.png$/,
    );
  });

  it('clicking a link from the description goes through openExternal, not navigation', async () => {
    const card = hostile();
    const stub = stubLauncher();
    stub.api.site.server = vi.fn(() => fetched(card));
    mounted = await mountAt(`/server/${String(card.id)}`, { stub, demo: false });
    for (const link of mounted.app.findAll('a[href^="https://"]')) {
      await link.trigger('click');
    }
    for (const [url] of vi.mocked(stub.api.openExternal).mock.calls) {
      expect(url.startsWith('https://')).toBe(true);
    }
    expect(mounted.router.currentRoute.value.path).toBe(`/server/${String(card.id)}`);
  });

  it('catalog and home screen: the same strings — as plain text', async () => {
    const list = hostileList();
    const stub = stubLauncher();
    stub.api.site.servers = vi.fn(() => fetched(list));
    mounted = await mountAt('/servers', { stub, demo: false });
    expectInert(document.body);
    expect(mounted.app.text()).toContain(`Сервер ${PAYLOAD}`);
    await mounted.router.push('/');
    await flushPromises();
    expectInert(document.body);
    expect(mounted.app.text()).toContain(`Сервер ${PAYLOAD}`);
  });

  it('crash: mod names, the clue and the game log — as plain text', async () => {
    const [sample] = crashes;
    if (sample === undefined) {
      throw new Error('mock crash missing');
    }
    const analysis: CrashAnalysis = {
      ...sample,
      cause: { code: 'mod-conflict', mod: PAYLOAD, other: `${PAYLOAD}\u202Egpj.exe`, mixin: false },
      evidence: `${PAYLOAD}\n\u0000\u001b[31m`,
      fixes: [
        { type: 'disable-mod', file: `${PAYLOAD}.jar` },
        { type: 'remove-file', path: 'libraries/<img src=x onerror=alert(1)>.jar' },
        { type: 'report' },
      ],
    };
    const stub = stubLauncher();
    stub.api.crash.last = vi.fn(() => Promise.resolve({ ok: true as const, value: analysis }));
    stub.api.launch.logTail = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: [PAYLOAD, '\u001b[0m<script>alert(2)</script>'],
      }),
    );
    mounted = await mountAt(`/crash/${analysis.instance}`, { stub, demo: false });
    expectInert(document.body);
    expect(mounted.app.text()).toContain('<script>alert(1)</script>');
  });
});
