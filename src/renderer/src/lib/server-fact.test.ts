import { describe, expect, it } from 'vitest';
import type { ServerRow } from '@shared/catalog';
import type { InstalledRuntime } from '@shared/instance';
import { fill } from '@shared/i18n/format';
import { ru } from '@shared/i18n/ru';
import { serverEntry } from '../composables/useLibrary';
import { servers } from '../mock/servers';
import { pendingUpdate, runtimeLabel, serverFact, updateText } from './server-fact';

const NOW = new Date('2026-10-03T12:00:00Z');
const vanilla = (minecraft: string): InstalledRuntime => ({
  minecraft,
  loader: { kind: 'vanilla', version: null },
});

function server(patch: Partial<ServerRow>): ServerRow {
  const first = servers[0];
  if (first === undefined) {
    throw new Error('mock servers missing');
  }
  return { ...first, wipe_label: null, ...patch };
}

describe('fact in a favorites card', () => {
  it('without facts there is no line', () => {
    expect(serverFact(server({}), NOW)).toBeNull();
    expect(serverFact(server({ down_since: null }), NOW)).toBeNull();
  });

  it("offline without down_since — 'Not responding' without a date, outranks a wipe", () => {
    const row = server({ status: 'offline', down_since: null, wipe_label: 'вайп завтра' });
    expect(serverFact(row, NOW)).toBe(ru.home.factDownUnknown);
  });

  it('not responding outranks a wipe: today — a time, earlier — a date', () => {
    const today = server({ wipe_label: 'вайп завтра', down_since: '2026-10-03T06:15:00Z' });
    expect(serverFact(today, NOW)).toBe(fill(ru.home.factDown, { since: '09:15' }));
    const earlier = server({ down_since: '2026-10-01T06:15:00Z' });
    expect(serverFact(earlier, NOW)).toBe(fill(ru.home.factDown, { since: '1 октября' }));
  });

  it('a malformed date is not shown', () => {
    expect(serverFact(server({ down_since: 'вчера', wipe_label: 'вайп завтра' }), NOW)).toBe(
      'Вайп завтра',
    );
  });

  it("the build differs from the catalog — 'will update on join', after a wipe and no response", () => {
    const current = server({ launch: { kind: 'direct', minecraft: '26.2' } });
    expect(serverFact(current, NOW, vanilla('26.1'))).toBe(ru.home.factUpdate);
    expect(serverFact(current, NOW, vanilla('26.2'))).toBeNull();
    expect(serverFact(current, NOW, null)).toBeNull();
    expect(serverFact(current, NOW)).toBeNull();
    const wipe = server({ wipe_label: 'вайп завтра', launch: current.launch });
    expect(serverFact(wipe, NOW, vanilla('26.1'))).toBe('Вайп завтра');
    const down = server({ down_since: '2026-10-03T06:15:00Z', launch: current.launch });
    expect(serverFact(down, NOW, vanilla('26.1'))).toBe(fill(ru.home.factDown, { since: '09:15' }));
  });

  it('the version is compared as a raw string, the loader — by kind and version', () => {
    const current = server({ launch: { kind: 'direct', minecraft: '1.21.10' } });
    expect(pendingUpdate(current, vanilla('1.21.1'))).not.toBeNull();
    expect(pendingUpdate(current, vanilla('1.21.10'))).toBeNull();
    const fabric: InstalledRuntime = {
      minecraft: '1.21.10',
      loader: { kind: 'fabric', version: '0.19.5' },
    };
    expect(pendingUpdate(current, fabric)).toEqual({ from: fabric, to: vanilla('1.21.10') });
    expect(pendingUpdate(server({ launch: { kind: 'none' } }), vanilla('1.20'))).toBeNull();
  });

  it('update label: version, for a loader — name and version', () => {
    expect(updateText({ from: vanilla('26.1'), to: vanilla('26.2') })).toBe(
      fill(ru.install.updateFrom, { old: '26.1', new: '26.2' }),
    );
    expect(runtimeLabel({ minecraft: '26.3', loader: { kind: 'fabric', version: '0.19.5' } })).toBe(
      '26.3, Fabric 0.19.5',
    );
  });
});

describe('server folder in the library', () => {
  const info = {
    folderId: 'server-1',
    serverId: 1,
    sizeBytes: 0,
    lastPlayedAt: null,
  } as const;
  const catalog = server({ launch: { kind: 'direct', minecraft: '26.3' } });

  it('version — the installed one, without a record — from the catalog', () => {
    const fabric = { minecraft: '26.2', loader: { kind: 'fabric', version: '0.19.5' } } as const;
    expect(serverEntry({ ...info, installed: fabric }, catalog)).toMatchObject({
      minecraft: '26.2',
    });
    expect(serverEntry({ ...info, installed: null }, catalog)).toMatchObject({
      minecraft: '26.3',
    });
  });
});
