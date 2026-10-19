import { resolveSrv as dnsResolveSrv } from 'node:dns/promises';
import { parseServerAddress, type ServerAddress } from '@shared/server-address';

export type SrvResolver = (
  name: string,
) => Promise<{ name: string; port: number; priority: number; weight: number }[]>;

function bestSrvRecord<T extends { priority: number; weight: number }>(
  records: T[],
): T | undefined {
  return [...records].sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0];
}

// The launcher's own ping of an address without a port follows the _minecraft._tcp SRV record,
// as the game's server list does.
export async function resolveServerSrv(
  address: ServerAddress,
  resolver: SrvResolver = dnsResolveSrv,
): Promise<ServerAddress> {
  if (address.port !== null || address.host.startsWith('[') || isIpLiteral(address.host)) {
    return address;
  }
  let records;
  try {
    records = await resolver(`_minecraft._tcp.${address.host}`);
  } catch {
    return address;
  }
  const record = bestSrvRecord(records);
  if (record === undefined) {
    return address;
  }
  const target = parseServerAddress(`${record.name}:${String(record.port)}`);
  return target ?? address;
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}
