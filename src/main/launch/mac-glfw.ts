import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedVersion } from '@xmcl/core';
import { readJarEntry } from '../site/jar-entry';
import { filesPlan, type TrackedRuntime } from './download';
import { failure } from './errors';
import type { GameLayout } from './layout';

// Mojang gives 1.14–1.18.2 on macOS LWJGL 3.2.1. Its GLFW cannot open a window on current macOS
// ("Cocoa: Failed to find service port for display"), and these versions stop on any GLFW
// error. GLFW 3.3.10 names displays through NSScreen and keeps the 3.3 API that LWJGL 3.2.1
// binds; LWJGL 3.3 brings a GLFW that reports the window icon as an error instead.
const LWJGL_GROUP = 'org.lwjgl';
const GLFW_BINDING = 'lwjgl-glfw';
const OLD_LWJGL = '3.2.1';
const GLFW_VERSION = '3.3.10';
const ARCHIVE = {
  url: `https://github.com/glfw/glfw/releases/download/${GLFW_VERSION}/glfw-${GLFW_VERSION}.bin.MACOS.zip`,
  sha1: 'a5cb5f736fa6d768f92b53557905e6a43302252a',
  size: 1261810,
};
const LIBRARY_FILE = 'libglfw.3.dylib';
const LIBRARY_ENTRY = `glfw-${GLFW_VERSION}.bin.MACOS/lib-universal/${LIBRARY_FILE}`;
const LIBRARY_SHA256 = '52f8f729fff6393ba2b16037e64b0445d8dc621027a01f0854b003a01595dbb5';
const LIBRARY_MAX_BYTES = 4 * 1024 * 1024;

export function needsMacGlfw(version: ResolvedVersion, platform: NodeJS.Platform): boolean {
  return (
    platform === 'darwin' &&
    version.libraries.some(
      (library) =>
        library.groupId === LWJGL_GROUP &&
        library.artifactId === GLFW_BINDING &&
        library.version === OLD_LWJGL,
    )
  );
}

export function macGlfwJvmArgs(library: string | null): string[] {
  return library === null ? [] : [`-Dorg.lwjgl.glfw.libname=${library}`];
}

function glfwDir(layout: GameLayout): string {
  return path.join(layout.runtime, 'glfw', GLFW_VERSION);
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

async function verified(file: string, expected: string): Promise<boolean> {
  const data = await readFile(file).catch(() => null);
  return data !== null && sha256(data) === expected;
}

export async function prepareMacGlfw(
  layout: GameLayout,
  transfer: TrackedRuntime,
  expected: string = LIBRARY_SHA256,
): Promise<string> {
  const dir = glfwDir(layout);
  const library = path.join(dir, LIBRARY_FILE);
  if (await verified(library, expected)) {
    return library;
  }
  const archive = path.join(dir, path.basename(ARCHIVE.url));
  await transfer.execute(
    filesPlan('glfw', [
      {
        path: archive,
        urls: [ARCHIVE.url],
        size: ARCHIVE.size,
        checksum: { algorithm: 'sha1', value: ARCHIVE.sha1 },
      },
    ]),
  );
  const data = await readJarEntry(archive, [LIBRARY_ENTRY], LIBRARY_MAX_BYTES).catch(() => null);
  if (data === null || sha256(data) !== expected) {
    throw failure({ code: 'checksum-mismatch', file: LIBRARY_FILE });
  }
  await mkdir(dir, { recursive: true });
  const temporary = `${library}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, library);
  return library;
}
