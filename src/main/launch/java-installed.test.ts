import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installedJavaMajors } from './java-installed';
import { gameLayout } from './layout';

const roots: string[] = [];

async function gameRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'mcm-java-'));
  roots.push(root);
  return root;
}

async function putJava(root: string, ...segments: string[]): Promise<void> {
  const file = path.join(root, 'runtime', ...segments);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '', { mode: 0o755 });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('installedJavaMajors', () => {
  it('reads the runtime folder of the game on disk', async () => {
    const root = await gameRoot();
    await putJava(root, 'java-runtime-delta', 'bin', 'java');
    await putJava(root, 'jre-legacy', 'bin', 'java');
    expect(await installedJavaMajors(gameLayout(root), 'linux')).toEqual([21, 8]);
  });

  it('a folder without the executable is not an installed Java', async () => {
    const root = await gameRoot();
    await putJava(root, 'java-runtime-epsilon', 'release');
    expect(await installedJavaMajors(gameLayout(root), 'linux')).toEqual([]);
  });

  it('counts Java 17 under its older component name', async () => {
    const root = await gameRoot();
    await putJava(root, 'java-runtime-beta', 'bin', 'java');
    expect(await installedJavaMajors(gameLayout(root), 'linux')).toEqual([17]);
  });

  it('on Windows looks into the folder of the ARM runtime too', async () => {
    const asked: string[] = [];
    const layout = gameLayout('C:\\game', path.win32);
    const arm = 'C:\\game\\runtime\\windows-arm64\\java-runtime-epsilon\\bin\\javaw.exe';
    const installed = await installedJavaMajors(
      layout,
      'win32',
      (paths) => {
        asked.push(...paths);
        return Promise.resolve(paths.includes(arm) ? arm : null);
      },
      path.win32,
    );
    expect(installed).toEqual([25]);
    expect(asked).toContain('C:\\game\\runtime\\java-runtime-delta\\bin\\javaw.exe');
    expect(asked).toContain('C:\\game\\runtime\\windows-x64\\jre-legacy\\bin\\java.exe');
  });
});
