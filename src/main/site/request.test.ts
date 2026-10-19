import { describe, expect, it } from 'vitest';
import { checkAddress, checkLiveIds, checkScene, checkServerQuery } from './request';

describe('parameters from the renderer', () => {
  it('catalog request', () => {
    expect(checkServerQuery({ q: ' sky ', sort: 'growth', page: 2, per_page: 50 })).toEqual({
      ok: true,
      value: { q: 'sky', sort: 'growth', page: 2, per_page: 50 },
    });
    expect(checkServerQuery(undefined)).toEqual({ ok: true, value: {} });
    expect(checkServerQuery({ per_page: 51 })).toMatchObject({ ok: false });
    expect(checkServerQuery({ sort: 'votes', per_page: 6 })).toEqual({
      ok: true,
      value: { sort: 'votes', per_page: 6 },
    });
    expect(checkServerQuery({ sort: 'likes' })).toMatchObject({ ok: false });
    expect(checkServerQuery({ q: 'x'.repeat(65) })).toMatchObject({ ok: false });
    expect(checkServerQuery({ q: 'a\u0000b' })).toMatchObject({ ok: false });
    expect(checkServerQuery({ url: 'https://evil/' })).toMatchObject({ ok: false });
    expect(checkServerQuery({ mode: ['survival', '../x'] })).toMatchObject({ ok: false });
    expect(checkServerQuery({ version: '1.20–26.2' })).toMatchObject({ ok: true });
  });

  it('ids for live: from 1 to 20 real ids', () => {
    expect(checkLiveIds([3, 3, 4])).toEqual({ ok: true, value: [3, 4] });
    expect(checkLiveIds([])).toMatchObject({ ok: false });
    expect(checkLiveIds(Array.from({ length: 21 }, (_, index) => index + 1))).toMatchObject({
      ok: false,
    });
    expect(checkLiveIds([1, -2])).toMatchObject({ ok: false });
    expect(checkLiveIds('1,2')).toMatchObject({ ok: false });
  });

  it('scene and time', () => {
    expect(checkScene('taiga', 'day')).toEqual({
      ok: true,
      value: { scene: 'taiga', time: 'day' },
    });
    expect(checkScene('../taiga', 'day')).toMatchObject({ ok: false });
    expect(checkScene('taiga', 'auto')).toMatchObject({ ok: false });
  });

  it('address for ping', () => {
    expect(checkAddress('play.example.ru:25565')).toEqual({
      ok: true,
      value: { host: 'play.example.ru', port: 25565 },
    });
    expect(checkAddress('http://x')).toMatchObject({ ok: false });
    expect(checkAddress(42)).toMatchObject({ ok: false });
  });
});
