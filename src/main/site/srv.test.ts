import { describe, expect, it, vi } from 'vitest';
import { resolveServerSrv, type SrvResolver } from './srv';

describe('resolveServerSrv', () => {
  const record = (
    name: string,
    port: number,
    priority = 0,
    weight = 0,
  ): { name: string; port: number; priority: number; weight: number } => ({
    name,
    port,
    priority,
    weight,
  });

  it('picks the _minecraft._tcp record with the best priority', async () => {
    const resolver = vi.fn<SrvResolver>(() =>
      Promise.resolve([record('backup.example.ru', 25570, 10), record('mc.example.ru.', 25566, 1)]),
    );
    expect(await resolveServerSrv({ host: 'play.example.ru', port: null }, resolver)).toEqual({
      host: 'mc.example.ru',
      port: 25566,
    });
    expect(resolver).toHaveBeenCalledWith('_minecraft._tcp.play.example.ru');
  });

  it('no record, a port given, or an address like IP:address — returned as is', async () => {
    const missing = vi.fn<SrvResolver>(() =>
      Promise.reject(Object.assign(new Error('ENODATA'), { code: 'ENODATA' })),
    );
    const address = { host: 'play.example.ru', port: null };
    expect(await resolveServerSrv(address, missing)).toBe(address);
    const withPort = { host: 'play.example.ru', port: 25565 };
    expect(await resolveServerSrv(withPort, missing)).toBe(withPort);
    expect(await resolveServerSrv({ host: '192.168.0.1', port: null }, missing)).toEqual({
      host: '192.168.0.1',
      port: null,
    });
    expect(missing).toHaveBeenCalledTimes(1);
    const empty: SrvResolver = () => Promise.resolve([]);
    expect(await resolveServerSrv(address, empty)).toBe(address);
  });
});
