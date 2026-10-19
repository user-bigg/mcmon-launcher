import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addMissingOptions,
  FIRST_RUN_OPTIONS,
  firstRunOptions,
  optionsAppendix,
  optionsFile,
  type GameOption,
} from './game-options';

const ONBOARDING: readonly GameOption[] = [['onboardAccessibility', 'false']];
const FIRST_RUN_TEXT =
  'onboardAccessibility:false\nskipMultiplayerWarning:true\ntutorialStep:none\njoinedFirstServer:true\n';

describe('first run options', () => {
  it('no language is added when none was found for the system', () => {
    expect(firstRunOptions(null)).toBe(FIRST_RUN_OPTIONS);
  });
});

describe('lines appended to options.txt', () => {
  it('key already present with any value — appends nothing', () => {
    expect(optionsAppendix('version:4671\nonboardAccessibility:false\n', ONBOARDING)).toBeNull();
    expect(optionsAppendix('version:4671\r\nonboardAccessibility:true\r\n', ONBOARDING)).toBeNull();
    expect(optionsAppendix('onboardAccessibility:true', ONBOARDING)).toBeNull();
  });

  it("only the missing keys are appended, the player's values stay", () => {
    const player =
      'version:4671\nlang:en_gb\ntutorialStep:punch_tree\nskipMultiplayerWarning:false\n';
    expect(optionsAppendix(player, firstRunOptions('ru_ru'))).toBe(
      'onboardAccessibility:false\njoinedFirstServer:true\n',
    );
  });

  it("key is missing — appends the line at the end, using the file's line ending", () => {
    expect(optionsAppendix('version:4671\nlang:ru_ru\n', ONBOARDING)).toBe(
      'onboardAccessibility:false\n',
    );
    expect(optionsAppendix('version:4671\r\nlang:ru_ru\r\n', ONBOARDING)).toBe(
      'onboardAccessibility:false\r\n',
    );
    expect(optionsAppendix('lang:ru_ru', ONBOARDING)).toBe('\nonboardAccessibility:false\n');
    expect(optionsAppendix('', ONBOARDING)).toBe('onboardAccessibility:false\n');
  });

  it("a similar key or another key's value is not mistaken for the key", () => {
    expect(optionsAppendix('xonboardAccessibility:false\n', ONBOARDING)).toBe(
      'onboardAccessibility:false\n',
    );
    expect(optionsAppendix('lastServer:onboardAccessibility:false\n', ONBOARDING)).toBe(
      'onboardAccessibility:false\n',
    );
    expect(optionsAppendix('language:x\n', [['lang', 'ru_ru']])).toBe('lang:ru_ru\n');
  });
});

describe('addMissingOptions', () => {
  let instance: string;

  beforeEach(async () => {
    instance = await mkdtemp(join(tmpdir(), 'mcmonitor-options-'));
  });

  afterEach(async () => {
    await rm(instance, { recursive: true, force: true });
  });

  it('new folder: creates options.txt, a second call changes nothing', async () => {
    const options = firstRunOptions('ru_ru');
    expect(await addMissingOptions(instance, options)).toBe(true);
    expect(await readFile(optionsFile(instance), 'utf8')).toBe(`${FIRST_RUN_TEXT}lang:ru_ru\n`);
    expect(await addMissingOptions(instance, options)).toBe(false);
    expect(await readFile(optionsFile(instance), 'utf8')).toBe(`${FIRST_RUN_TEXT}lang:ru_ru\n`);
  });

  it("player's settings and their bytes stay unchanged", async () => {
    const player = Buffer.concat([
      Buffer.from('version:4671\r\nlastServer:'),
      Buffer.from([0xcf, 0xf0, 0xe8]),
      Buffer.from('\r\nfov:0.5'),
    ]);
    await writeFile(optionsFile(instance), player);
    expect(await addMissingOptions(instance, ONBOARDING)).toBe(true);
    const saved = await readFile(optionsFile(instance));
    expect(saved.subarray(0, player.length).equals(player)).toBe(true);
    expect(saved.subarray(player.length).toString('utf8')).toBe(
      '\r\nonboardAccessibility:false\r\n',
    );
  });
});
