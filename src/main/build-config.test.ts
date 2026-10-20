import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UPDATE_BASE_URL } from '@shared/update';

const config = readFileSync(resolve(import.meta.dirname, '../../electron-builder.yml'), 'utf8');

function fuse(name: string): string | undefined {
  return new RegExp(`^\\s+${name}:\\s*(\\S+)`, 'm').exec(config)?.[1];
}

describe('electron-builder.yml', () => {
  it('dangerous fuses are off, ASAR integrity check is on', () => {
    expect(fuse('runAsNode')).toBe('false');
    expect(fuse('enableNodeOptionsEnvironmentVariable')).toBe('false');
    expect(fuse('enableNodeCliInspectArguments')).toBe('false');
    expect(fuse('grantFileProtocolExtraPrivileges')).toBe('false');
    expect(fuse('enableCookieEncryption')).toBe('true');
    expect(fuse('enableEmbeddedAsarIntegrityValidation')).toBe('true');
    expect(fuse('onlyLoadAppFromAsar')).toBe('true');
  });

  it('updates are not checked against a Windows publisher: releases are unsigned', () => {
    expect(config).not.toMatch(/publisherName/);
    expect(config).not.toMatch(/verifyUpdateCodeSignature/);
  });

  it('only the build goes into the installer: node_modules are bundled into main', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(config).not.toMatch(/node_modules/);
  });

  it('asar only, NSIS x64 target', () => {
    expect(config).toMatch(/^asar: true$/m);
    expect(config).toMatch(/target: nsis/);
    expect(config).toMatch(/- x64/);
  });

  it('updates: generic provider at the UPDATE_BASE_URL address, channel by version, files for all channels', () => {
    const publish = /^publish:\n((?: {2}.+\n)+)/m.exec(config)?.[1] ?? '';
    expect(publish).toMatch(/^ {2}provider: generic$/m);
    expect(publish).toMatch(
      new RegExp(`^ {2}url: ${UPDATE_BASE_URL.replace(/[.]/g, '\\.')}$`, 'm'),
    );
    expect(publish).not.toMatch(/channel:/);
    expect(config).not.toMatch(/^\s*channel:/m);
    expect(config).not.toMatch(/detectUpdateChannel/);
    expect(config).toMatch(/^generateUpdatesFilesForAllChannels: true$/m);
  });
});
