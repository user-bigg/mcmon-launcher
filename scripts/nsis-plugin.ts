import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Toolchain {
  cc: string;
  windres: string;
  path: string | undefined;
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const pluginDir = join(projectRoot, 'build', 'nsis-plugin');
const output = join(projectRoot, 'build', 'x86-unicode', 'McmPhrases.dll');
const mingwBin = process.env.NSIS_PLUGIN_MINGW_BIN ?? 'C:\\msys64\\mingw32\\bin';

function onPath(command: string): boolean {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// The MSYS2 compiler runs cc1.exe from another folder, and cc1.exe finds its DLLs only through PATH.
function toolchain(): Toolchain {
  if (process.env.NSIS_PLUGIN_MINGW_BIN === undefined && onPath('i686-w64-mingw32-gcc')) {
    return { cc: 'i686-w64-mingw32-gcc', windres: 'i686-w64-mingw32-windres', path: undefined };
  }
  if (existsSync(join(mingwBin, 'gcc.exe'))) {
    return {
      cc: join(mingwBin, 'gcc.exe'),
      windres: join(mingwBin, 'windres.exe'),
      path: mingwBin + delimiter + (process.env.PATH ?? ''),
    };
  }
  throw new Error(
    'No 32-bit MinGW compiler: brew install mingw-w64 (macOS), or mingw-w64-i686-gcc in MSYS2 with NSIS_PLUGIN_MINGW_BIN set to its mingw32\\bin',
  );
}

function build(): void {
  const tools = toolchain();
  const env = tools.path === undefined ? process.env : { ...process.env, PATH: tools.path };
  const work = mkdtempSync(join(tmpdir(), 'nsis-plugin-'));
  try {
    const resource = join(work, 'phrases.res.o');
    execFileSync(tools.windres, [join(pluginDir, 'phrases.rc'), '-O', 'coff', '-o', resource], {
      env,
      stdio: 'inherit',
    });
    mkdirSync(dirname(output), { recursive: true });
    execFileSync(
      tools.cc,
      [
        '-shared',
        '-municode',
        '-O2',
        '-s',
        '-Wall',
        '-Wextra',
        '-nostdlib',
        '-e',
        '_DllMain@12',
        '-fno-asynchronous-unwind-tables',
        '-Wl,--no-insert-timestamp',
        '-o',
        output,
        join(pluginDir, 'phrases.c'),
        resource,
        '-lkernel32',
        '-luser32',
      ],
      { env, stdio: 'inherit' },
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  process.stdout.write(`nsis-plugin: ${output}\n`);
}

build();
