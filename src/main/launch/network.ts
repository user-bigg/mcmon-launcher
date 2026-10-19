export interface NetworkSetup {
  proxyUrl: string | null;
}

export const DIRECT_NETWORK: NetworkSetup = { proxyUrl: null };

// Chromium in Electron (net.fetch) picks up the system proxy and root certificates itself,
// undici does not: without this, downloads fail behind a corporate proxy and with antivirus
// TLS interception.
export function proxyFromPac(rule: string): string | null {
  for (const entry of rule.split(';')) {
    const [kind, hostPort] = entry.trim().split(/\s+/);
    if (hostPort === undefined || !/^[A-Za-z0-9.\-[\]:]+:\d{1,5}$/.test(hostPort)) {
      continue;
    }
    if (kind === 'PROXY' || kind === 'HTTP') {
      return `http://${hostPort}`;
    }
    if (kind === 'HTTPS') {
      return `https://${hostPort}`;
    }
  }
  return null;
}
