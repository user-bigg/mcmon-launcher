import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const IMPORT_BOTH = [
  "const installer = await import('@xmcl/installer');",
  "const unzip = await import('@xmcl/unzip');",
  "const cjs = (await import('node:module')).createRequire(process.cwd() + '/');",
  "cjs('@xmcl/installer'); cjs('@xmcl/unzip');",
  'console.log(typeof installer.diagnoseInstallation, typeof unzip.open);',
].join('\n');

// @xmcl/installer 6.3.4 and @xmcl/unzip 2.2.0 were published broken and only work with the
// patches in patches/. The import runs in a separate Node, as in main, not via the Vite resolver.
describe('@xmcl patches from patches/', () => {
  it('after an XMCL update, the patch still fixes loading as both ESM and CommonJS', () => {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', IMPORT_BOTH], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(output.trim()).toBe('function function');
  });
});
