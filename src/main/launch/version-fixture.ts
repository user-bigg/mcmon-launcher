import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MinecraftFolder, Version, type ResolvedVersion } from '@xmcl/core';

export const FIXTURE_SHA1 = 'a'.repeat(40);

export interface VersionFixtureOptions {
  id?: string;
  clientSha1?: string;
  librarySha1?: string;
  gameArguments?: string[];
}

export async function writeVersionFixture(
  root: string,
  options: VersionFixtureOptions = {},
): Promise<ResolvedVersion> {
  const id = options.id ?? '26.3';
  const folder = MinecraftFolder.from(root);
  const json = {
    id,
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    releaseTime: '2026-09-01T00:00:00+00:00',
    time: '2026-09-01T00:00:00+00:00',
    assets: '30',
    assetIndex: {
      id: '30',
      sha1: 'b'.repeat(40),
      size: 10,
      totalSize: 10,
      url: 'https://piston-meta.mojang.com/v1/packages/b/30.json',
    },
    downloads: {
      client: {
        sha1: options.clientSha1 ?? FIXTURE_SHA1,
        size: 100,
        url: 'https://piston-data.mojang.com/v1/objects/a/client.jar',
      },
    },
    arguments: {
      game: options.gameArguments ?? [
        '--username',
        '${auth_player_name}',
        '--version',
        '${version_name}',
      ],
      jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
    },
    libraries: [
      {
        name: 'com.example:lib:1.0',
        downloads: {
          artifact: {
            path: 'com/example/lib/1.0/lib-1.0.jar',
            sha1: options.librarySha1 ?? 'c'.repeat(40),
            size: 10,
            url: 'https://libraries.minecraft.net/com/example/lib/1.0/lib-1.0.jar',
          },
        },
      },
    ],
  };
  await mkdir(folder.getVersionRoot(id), { recursive: true });
  await writeFile(join(folder.getVersionRoot(id), `${id}.json`), JSON.stringify(json));
  return Version.parse(folder, id);
}
