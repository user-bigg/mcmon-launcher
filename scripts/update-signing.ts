import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import {
  generateUpdateKeys,
  privateKeyFromBase64,
  publicKeyOf,
  SIGNATURE_SUFFIX,
  sha512File,
  signRelease,
  verifyRelease,
  versionFromInstallerName,
} from '../src/main/update/signature.ts';
import { UPDATE_PUBLIC_KEY } from '../src/shared/update-key.ts';

const KEY_ENV = 'UPDATE_SIGNING_KEY';

const USAGE = `usage:
  update-keygen <private-key-file>
  update-sign <installer.exe> [<private-key-file>] [--version <v>] [--public-key <base64>]
  update-verify <installer.exe> [<file.sig>] [--version <v>] [--public-key <base64>]

update-sign reads the private key from the file or from $${KEY_ENV}.`;

class UsageError extends Error {}

interface Options {
  positionals: string[];
  version: string | undefined;
  publicKey: string;
}

function parseOptions(args: string[]): Options {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: { version: { type: 'string' }, 'public-key': { type: 'string' } },
  });
  return {
    positionals,
    version: values.version,
    publicKey: values['public-key'] ?? UPDATE_PUBLIC_KEY,
  };
}

function releaseVersion(installer: string, explicit: string | undefined): string {
  const version = explicit ?? versionFromInstallerName(basename(installer));
  if (version === null) {
    throw new UsageError(
      `cannot read the version from ${basename(installer)}: expected mcmonitor-launcher-<version>-win-x64.exe, -mac-arm64.zip or --version`,
    );
  }
  return version;
}

function readPrivateKey(file: string | undefined): string {
  if (file !== undefined) {
    return readFileSync(file, 'utf8');
  }
  const fromEnv = process.env[KEY_ENV];
  if (fromEnv === undefined || fromEnv.trim() === '') {
    throw new UsageError(`no private key: pass a key file or set ${KEY_ENV}`);
  }
  return fromEnv;
}

function keygen(options: Options): void {
  const [file] = options.positionals;
  if (file === undefined) {
    throw new UsageError('update-keygen needs the private key file path');
  }
  if (existsSync(file)) {
    throw new UsageError(`${file} already exists, refusing to overwrite`);
  }
  const keys = generateUpdateKeys();
  writeFileSync(file, `${keys.privateKey}\n`, { mode: 0o600, flag: 'wx' });
  console.log(`private key: ${file} (store it as the ${KEY_ENV} secret, never commit it)`);
  console.log(`public key for src/shared/update-key.ts: ${keys.publicKey}`);
}

async function signInstaller(options: Options): Promise<void> {
  const [installer, keyFile] = options.positionals;
  if (installer === undefined) {
    throw new UsageError('update-sign needs the installer path');
  }
  const key = privateKeyFromBase64(readPrivateKey(keyFile));
  if (publicKeyOf(key) !== options.publicKey) {
    throw new Error(
      'the signing key does not match the public key built into the launcher (src/shared/update-key.ts)',
    );
  }
  const release = {
    version: releaseVersion(installer, options.version),
    sha512: await sha512File(installer),
  };
  const signature = signRelease(release, key);
  if (!verifyRelease(release, signature, options.publicKey)) {
    throw new Error('the fresh signature does not verify');
  }
  writeFileSync(`${installer}${SIGNATURE_SUFFIX}`, `${signature}\n`);
  console.log(`update-sign: ${installer}${SIGNATURE_SUFFIX} (version ${release.version})`);
}

async function verifyInstaller(options: Options): Promise<boolean> {
  const [installer, signatureFile] = options.positionals;
  if (installer === undefined) {
    throw new UsageError('update-verify needs the installer path');
  }
  const release = {
    version: releaseVersion(installer, options.version),
    sha512: await sha512File(installer),
  };
  const signature = readFileSync(signatureFile ?? `${installer}${SIGNATURE_SUFFIX}`, 'utf8');
  const valid = verifyRelease(release, signature, options.publicKey);
  console.log(
    `update-verify: ${installer} ${valid ? 'OK' : 'INVALID'} (version ${release.version})`,
  );
  return valid;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  switch (command) {
    case 'keygen':
      keygen(options);
      return 0;
    case 'sign':
      await signInstaller(options);
      return 0;
    case 'verify':
      return (await verifyInstaller(options)) ? 0 : 1;
    default:
      throw new UsageError(`unknown command ${command ?? ''}`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`update-signing: ${message}`);
    if (error instanceof UsageError) {
      console.error(USAGE);
    }
    process.exitCode = 2;
  },
);
