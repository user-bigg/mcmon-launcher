import { rm } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomic } from '../json-cache';

export interface SkinSource {
  name: string;
  type: string;
  root?: string;
}

export interface SkinLoaderConfig {
  loadlist: SkinSource[];
  forceLoadAllTextures: boolean;
  enableCape: boolean;
}

// The mod overwrites type and root of any source whose name equals one of its built-in
// sites (Mojang, ElyBy, LittleSkin and others), so our source carries a name of its own.
export const SERVICE_SOURCE_NAME = 'MC Monitor';

export function skinConfigFile(instance: string): string {
  return path.join(instance, 'CustomSkinLoader', 'CustomSkinLoader.json');
}

// version and buildNumber are left out on purpose: the mod then fills in its own and treats
// the file as current. It adds its default sources (MojangAPI among them) only when the file
// is missing or is not valid JSON, never because of a version.
export function skinConfig(serviceRoot: string): SkinLoaderConfig {
  return {
    loadlist: [
      { name: SERVICE_SOURCE_NAME, type: 'ElyByAPI', root: serviceRoot },
      { name: 'GameProfile', type: 'GameProfile' },
    ],
    forceLoadAllTextures: false,
    enableCape: true,
  };
}

export function extraListDir(instance: string): string {
  return path.join(instance, 'CustomSkinLoader', 'ExtraList');
}

// At start the mod puts every file from ExtraList in front of the load list: a stray file
// there would send the nicknames of everyone the player meets to somebody else's server.
export async function writeSkinConfig(instance: string, serviceRoot: string): Promise<void> {
  await rm(extraListDir(instance), { recursive: true, force: true });
  await writeJsonAtomic(skinConfigFile(instance), skinConfig(serviceRoot));
}
