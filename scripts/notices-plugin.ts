import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, Rollup } from 'vite';

export type NoticesTarget = 'main' | 'preload' | 'renderer';

export const NOTICES_TARGETS: readonly NoticesTarget[] = ['main', 'preload', 'renderer'];

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

export const noticesWorkDir = join(projectRoot, 'out', '.notices');

const virtualModulePackages: readonly (readonly [prefix: string, packageName: string])[] = [
  ['vite/', 'vite'],
  ['commonjsHelpers', 'vite'],
  ['plugin-vue:', '@vitejs/plugin-vue'],
];

function withoutQuery(moduleId: string): string {
  const query = moduleId.indexOf('?');
  return query === -1 ? moduleId : moduleId.slice(0, query);
}

function packageDirOfPath(path: string): string | null {
  const normalized = path.replaceAll('\\', '/');
  const marker = '/node_modules/';
  const at = normalized.lastIndexOf(marker);
  if (at === -1) {
    return null;
  }
  const segments = normalized.slice(at + marker.length).split('/');
  const nameLength = segments[0]?.startsWith('@') === true ? 2 : 1;
  if (segments.length <= nameLength) {
    return null;
  }
  return normalized.slice(0, at + marker.length) + segments.slice(0, nameLength).join('/');
}

function packageDirOfVirtualModule(id: string): string | null {
  const match = virtualModulePackages.find(([prefix]) => id.startsWith(prefix));
  return match === undefined ? null : join(projectRoot, 'node_modules', match[1]);
}

export function packageDirOfModule(moduleId: string): string | null {
  const id = withoutQuery(moduleId);
  if (id.startsWith('\0')) {
    const unprefixed = id.slice(1);
    return packageDirOfPath(unprefixed) ?? packageDirOfVirtualModule(unprefixed);
  }
  return packageDirOfPath(id);
}

function sourcesOf(output: Rollup.OutputChunk | Rollup.OutputAsset): readonly string[] {
  return output.type === 'chunk' ? output.moduleIds : output.originalFileNames;
}

export function packageDirsOfBundle(bundle: Rollup.OutputBundle): string[] {
  const dirs = new Set<string>();
  for (const output of Object.values(bundle)) {
    for (const source of sourcesOf(output)) {
      const dir = packageDirOfModule(source);
      if (dir !== null) {
        dirs.add(relative(projectRoot, dir).replaceAll('\\', '/'));
      }
    }
  }
  return [...dirs].sort();
}

export function notices(target: NoticesTarget): Plugin {
  return {
    name: 'mcmonitor-notices',
    apply: 'build',
    generateBundle(_options, bundle): void {
      mkdirSync(noticesWorkDir, { recursive: true });
      const file = join(noticesWorkDir, `${target}.json`);
      writeFileSync(file, `${JSON.stringify(packageDirsOfBundle(bundle), null, 2)}\n`);
    },
  };
}
