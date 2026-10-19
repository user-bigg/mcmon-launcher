import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gameLayout } from '../layout';
import { firstChangedPin, mergePins, PinCollector, pinsFile, readPins, writePins } from './pins';
import { LoaderStageError } from './sources';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcmonitor-pins-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

describe('pinned loader hashes', () => {
  it('paths are relative to the data folder; a file outside it is not pinned', () => {
    const pins = new PinCollector(root);
    pins.add(join(root, 'libraries', 'a.jar'), 'a'.repeat(40));
    expect(pins.toPins('v').files).toEqual({
      'libraries/a.jar': { sha1: 'a'.repeat(40) },
    });
    expect(() => {
      pins.add(join(root, '..', 'x.jar'), 'a'.repeat(40));
    }).toThrow(LoaderStageError);
  });

  it('a file from maven stays the same across installs', () => {
    const before = {
      schemaVersion: 1 as const,
      version: 'v',
      files: { 'libraries/a.jar': { sha1: 'a'.repeat(40) } },
    };
    expect(mergePins(before, before)).toBe(before);
    const swapped = { ...before, files: { 'libraries/a.jar': { sha1: 'd'.repeat(40) } } };
    expect(() => mergePins(before, swapped)).toThrow(LoaderStageError);
    expect(mergePins(null, swapped)).toBe(swapped);
  });

  it('only its own file with safe paths is read', async () => {
    const layout = gameLayout(root);
    const file = pinsFile(layout, 'fabric-loader-0.19.5-26.3');
    await mkdir(join(root, 'versions', 'fabric-loader-0.19.5-26.3'), { recursive: true });
    await writePins(file, {
      schemaVersion: 1,
      version: 'fabric-loader-0.19.5-26.3',
      files: {
        'libraries/a.jar': { sha1: 'a'.repeat(40) },
        '../escape.jar': { sha1: 'a'.repeat(40) },
      },
    });
    expect((await readPins(file, 'fabric-loader-0.19.5-26.3'))?.files).toEqual({
      'libraries/a.jar': { sha1: 'a'.repeat(40) },
    });
    expect(await readPins(file, 'other')).toBeNull();
  });

  it('verification detects a file that is missing or changed since it was recorded', async () => {
    const file = join(root, 'libraries', 'net', 'loader.jar');
    await mkdir(join(root, 'libraries', 'net'), { recursive: true });
    await writeFile(file, 'good');
    const pins = {
      schemaVersion: 1 as const,
      version: 'v',
      files: { 'libraries/net/loader.jar': { sha1: sha1('good') } },
    };
    const signal = new AbortController().signal;
    expect(await firstChangedPin(root, pins, undefined, signal)).toBeNull();
    await writeFile(file, 'evil');
    const old = new Date(Date.now() - 60_000);
    await utimes(file, old, old);
    expect(await firstChangedPin(root, pins, Date.now(), signal)).toBeNull();
    expect(await firstChangedPin(root, pins, undefined, signal)).toBe(file);
    await rm(file);
    expect(await firstChangedPin(root, pins, Date.now(), signal)).toBe(file);
  });
});
