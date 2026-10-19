import { describe, expect, it } from 'vitest';
import { signedExitCode, type CrashAnalysis, type CrashCause, type CrashFix } from './crash';
import { crashDetails, describeCrash, formatMemory } from './crash-text';
import { crashRu } from './i18n/crash.ru';
import { typeset } from './i18n/typography';

function analysis(
  cause: CrashCause,
  fixes: CrashFix[],
  memoryMb: number | null = 3072,
): CrashAnalysis {
  return {
    id: 'a1b2c3d4-e5f6',
    at: '2026-10-03T18:44:21.000Z',
    instance: 'server-12',
    minecraft: '1.21.11',
    memoryMb,
    totalMemoryMb: 16384,
    javaMajor: 21,
    exit: { code: 1, signal: null },
    uptimeMs: 134_000,
    cause,
    rule: null,
    evidence: null,
    fixes,
    autoFixable: false,
    files: { log: true, crashReport: false, jvmReport: false },
  };
}

describe('crash strings', () => {
  it('memory in Russian', () => {
    expect(formatMemory(6144)).toBe('6\u00a0ГБ');
    expect(formatMemory(1536)).toBe('1,5\u00a0ГБ');
    expect(formatMemory(64)).toBe('64\u00a0МБ');
  });

  it("out of memory: 'Not enough memory. Allocate 6 GB?'", () => {
    const text = describeCrash(
      analysis({ code: 'out-of-memory', memoryMb: 3072, area: 'Java heap space', heap: true }, [
        { type: 'set-memory', mb: 6144 },
        { type: 'open-log' },
        { type: 'report' },
      ]),
    );
    expect(text.title).toBe('Игре не хватило памяти');
    expect(text.summary).toBe('Не хватило памяти. Выделить 6\u00a0ГБ?');
    expect(text.text).toContain('3\u00a0ГБ');
    expect(text.fixes[0]).toEqual({
      title: 'Выделить 6\u00a0ГБ вместо 3\u00a0ГБ',
      text: typeset('В компьютере 16 ГБ. Изменится только для этого сервера.'),
      action: 'Выделить и запустить',
    });
  });

  it('graphics in a virtual machine: no promise that a driver update helps', () => {
    const cause: CrashCause = { code: 'graphics', problem: 'pixel-format' };
    const inside = describeCrash(
      analysis(cause, [{ type: 'advice', advice: 'vm-graphics' }, { type: 'open-log' }]),
    );
    expect(inside.text).not.toMatch(/драйвер/i);
    expect(inside.summary).not.toMatch(/драйвер/i);
    expect(inside.fixes[0]?.title).toBe('Windows в виртуальной машине?');
    const outside = describeCrash(
      analysis(cause, [
        { type: 'advice', advice: 'update-driver' },
        { type: 'advice', advice: 'vm-graphics' },
      ]),
    );
    expect(outside.text).toMatch(/драйвер/i);
  });

  it('the system is short on memory: reduce, not allocate', () => {
    const text = describeCrash(
      analysis(
        { code: 'system-memory', memoryMb: 6144, kind: 'insufficient' },
        [
          { type: 'set-memory', mb: 4096 },
          { type: 'advice', advice: 'close-programs' },
        ],
        6144,
      ),
    );
    expect(text.summary).toBe(typeset('Компьютеру не хватило памяти. Уменьшить до 4 ГБ?'));
    expect(text.fixes[0]?.title).toBe('Уменьшить память до 4\u00a0ГБ');
    expect(text.fixes[1]).toMatchObject({ title: 'Закрыть лишние программы', action: null });
  });

  it('Java, mods and an unknown cause substitute names', () => {
    expect(
      describeCrash(
        analysis(
          { code: 'java-version', direction: 'too-old', requiredMajor: 21, currentMajor: 17 },
          [{ type: 'install-java', major: 21 }],
        ),
      ),
    ).toMatchObject({
      text: typeset('Игре нужна Java 21, а она запущена на Java 17.'),
      summary: 'Нужна Java 21. Установить?',
    });
    const dependency = describeCrash(
      analysis({ code: 'mod-dependency', mod: 'Iris', dependency: 'Sodium', range: '≥0.6.0' }, [
        { type: 'advice', advice: 'install-dependency' },
        { type: 'disable-mod', file: 'iris-1.8.1.jar' },
      ]),
    );
    expect(dependency.text).toBe(typeset('Мод Iris требует Sodium ≥0.6.0, а его нет.'));
    expect(dependency.fixes[0]?.title).toBe('Добавить мод Sodium');
    expect(dependency.fixes[1]?.title).toBe('Отключить iris-1.8.1.jar');
    expect(
      describeCrash(
        analysis(
          {
            code: 'mod-version',
            mod: 'Sodium',
            dependency: 'Minecraft',
            range: '1.20.1',
            present: '1.20.4',
          },
          [],
        ),
      ).text,
    ).toBe(typeset('Мод Sodium сделан для Minecraft 1.20.1, а запущена другая версия.'));
    expect(describeCrash(analysis({ code: 'unknown' }, [])).title).toBe('Причина неизвестна');
  });

  it('no unfilled placeholders remain in the texts', () => {
    const causes: CrashCause[] = [
      { code: 'closed' },
      { code: 'out-of-memory', memoryMb: null, area: null, heap: true },
      { code: 'out-of-memory', memoryMb: 2048, area: 'Metaspace', heap: false },
      { code: 'system-memory', memoryMb: null, kind: 'insufficient' },
      { code: 'system-memory', memoryMb: 2048, kind: 'threads' },
      { code: 'system-memory', memoryMb: 2048, kind: 'reserve-32bit' },
      { code: 'graphics', problem: 'not-responding' },
      { code: 'graphics', problem: 'driver-crash' },
      { code: 'mod-version', mod: null, dependency: 'Minecraft', range: null, present: null },
      { code: 'mod-version', mod: 'sodium', dependency: 'Minecraft', range: null, present: null },
      { code: 'mod-crash', mod: null },
      { code: 'mod-crash', mod: 'modmenu' },
      { code: 'java-version', direction: 'too-new', requiredMajor: null, currentMajor: 25 },
      { code: 'graphics', problem: 'display' },
      { code: 'mod-duplicate', mod: null, files: [] },
      { code: 'mod-conflict', mod: 'iris', other: null, mixin: true },
      { code: 'mod-dependency', mod: null, dependency: 'fabric-api', range: null },
      { code: 'mod-version', mod: 'create', dependency: 'flywheel', range: '≥1.0', present: null },
      { code: 'corrupt-file', file: 'C:\\game\\libraries\\a.jar' },
      { code: 'disk-full' },
      { code: 'unknown' },
    ];
    const fixes: CrashFix[] = [
      { type: 'remove-file', path: 'libraries/a.jar' },
      { type: 'open-folder', folder: 'mods' },
      { type: 'reset-java' },
      { type: 'advice', advice: 'paging-file' },
      { type: 'advice', advice: 'update-mod' },
      { type: 'advice', advice: 'java-64bit' },
      { type: 'advice', advice: 'antivirus' },
    ];
    for (const cause of causes) {
      const text = describeCrash(analysis(cause, fixes, null));
      expect(JSON.stringify(text), cause.code).not.toMatch(/\{\w+\}/);
    }
  });

  it("a shortage without a fix does not promise it is 'easy to fix'", () => {
    const text = describeCrash(
      analysis({ code: 'out-of-memory', memoryMb: 6144, area: null, heap: true }, [
        { type: 'advice', advice: 'close-programs' },
      ]),
    );
    expect(text.text).not.toContain('легко');
    expect(text.summary).toBe('Игре не хватило памяти.');
  });

  it("a mod without a name: 'Update mods', not 'Update {mod}'", () => {
    const text = describeCrash(
      analysis({ code: 'mod-crash', mod: null }, [{ type: 'advice', advice: 'update-mod' }]),
    );
    expect(text.fixes[0]?.title).toBe('Обновить моды');
    const named = describeCrash(
      analysis({ code: 'mod-crash', mod: 'Iris' }, [{ type: 'advice', advice: 'update-mod' }]),
    );
    expect(named.fixes[0]?.title).toBe('Обновить Iris');
  });

  it('resetting Java', () => {
    const reset = describeCrash(
      analysis(
        { code: 'java-version', direction: 'too-new', requiredMajor: null, currentMajor: 21 },
        [{ type: 'reset-java' }],
      ),
    );
    expect(reset.summary).toBe(typeset('Нужна другая версия Java. Вернуть Java по версии игры?'));
    expect(reset.fixes[0]?.action).toBe('Вернуть и запустить');
  });

  it('the file in the text and in the fix — name only, no path', () => {
    const text = describeCrash(
      analysis({ code: 'corrupt-file', file: 'C:\\game\\libraries\\a.jar' }, [
        { type: 'remove-file', path: 'libraries\\org\\b.jar' },
      ]),
    );
    expect(text.text).toBe(crashRu.causes['corrupt-file'].text.replace('{file}', 'a.jar'));
    expect(text.fixes[0]?.title).toBe(
      crashRu.fixes['remove-file'].title.replace('{file}', 'b.jar'),
    );
  });

  it('a mod requires a different dependency version, the installed one is unknown', () => {
    const text = describeCrash(
      analysis(
        {
          code: 'mod-version',
          mod: 'create',
          dependency: 'flywheel',
          range: '≥1.0',
          present: null,
        },
        [],
      ),
    );
    expect(text.text).toBe(typeset('Мод create требует flywheel ≥1.0.'));
  });

  it('too new a Java and a hang — their own texts', () => {
    const java = describeCrash(
      analysis(
        { code: 'java-version', direction: 'too-new', requiredMajor: null, currentMajor: 25 },
        [],
      ),
    );
    expect(java.text).toBe(crashRu.causes['java-version'].textTooNew);
    const frozen = describeCrash(analysis({ code: 'graphics', problem: 'not-responding' }, []));
    expect(frozen.summary).toBe(crashRu.causes.graphics.summaryNotResponding);
  });

  it('the folder in the fix is named by its own kind', () => {
    const text = describeCrash(
      analysis({ code: 'unknown' }, [
        { type: 'open-folder', folder: 'mods' },
        { type: 'open-folder', folder: 'crash-reports' },
      ]),
    );
    expect(text.fixes.map((fix) => fix.title)).toEqual(['Папка модов', 'Отчёты о вылетах']);
  });
});

describe('exit code', () => {
  it('a Windows code that Node reports unsigned is shown signed', () => {
    expect(signedExitCode(4294967295)).toBe(-1);
    expect(signedExitCode(3221225477)).toBe(-1073741819);
    expect(signedExitCode(1)).toBe(1);
    expect(signedExitCode(-1)).toBe(-1);
  });
});

describe('joining before the game has loaded', () => {
  it('names the cause and offers the launch without the join', () => {
    const text = describeCrash(
      analysis({ code: 'join-before-load' }, [{ type: 'launch-without-join' }]),
    );
    expect(text.text).toMatch(/«Сразу\s+зайти\s+на\s+сервер»/);
    expect(text.fixes[0]?.action).toBe(crashRu.fixes['launch-without-join'].action);
  });
});

describe('crash details', () => {
  const graphics: CrashCause = { code: 'graphics', problem: 'context' };

  it('a line from the log and the exit code stay as they are', () => {
    const closed = {
      ...analysis(graphics, []),
      rule: 'pixel-format',
      evidence: 'GLFW error 65544',
      exit: { code: 0, signal: null },
    };
    expect(crashDetails(closed)).toEqual({
      evidence: 'GLFW error 65544',
      note: null,
      exit: 'Код выхода 0',
    });
  });

  it('another rule without a line leaves the line empty', () => {
    expect(crashDetails(analysis({ code: 'unknown' }, []))).toMatchObject({
      evidence: null,
      note: null,
    });
  });
});
