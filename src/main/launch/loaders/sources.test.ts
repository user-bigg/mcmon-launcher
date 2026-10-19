import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../json-cache';
import { createFetchText, fetchMavenSha1, LoaderStageError, MAX_TEXT_BYTES } from './sources';

function respond(body: string, init: ResponseInit & { url?: string } = {}): FetchLike {
  return () => {
    const response = new Response(body, init);
    if (init.url !== undefined) {
      Object.defineProperty(response, 'url', { value: init.url });
    }
    return Promise.resolve(response);
  };
}

const signal = new AbortController().signal;
const META = 'https://meta.fabricmc.net/v2/versions/loader';

describe('fetching text from official sources', () => {
  it('an untrusted address is never requested, and a redirect to an untrusted host is an error', async () => {
    await expect(createFetchText(respond('x'))('https://evil.example/a', signal)).rejects.toThrow(
      LoaderStageError,
    );
    const redirected = createFetchText(respond('x', { url: 'https://evil.example/meta' }));
    await expect(redirected(META, signal)).rejects.toThrow(/untrusted host evil\.example/);
  });

  it('an HTTP error carries its status code; an oversized response is rejected', async () => {
    await expect(
      createFetchText(respond('no', { status: 404 }))(META, signal),
    ).rejects.toMatchObject({
      statusCode: 404,
      downloadUrl: META,
    });
    const huge = createFetchText(
      respond('x', { headers: { 'content-length': String(MAX_TEXT_BYTES + 1) } }),
    );
    await expect(huge(META, signal)).rejects.toThrow(LoaderStageError);
  });

  it('an oversized response without content-length is cut off at the limit', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller): void {
        pulled += 1;
        controller.enqueue(chunk);
      },
    });
    const streamed = createFetchText(() => Promise.resolve(new Response(endless)));
    await expect(streamed(META, signal)).rejects.toThrow(LoaderStageError);
    expect(pulled).toBeLessThan(MAX_TEXT_BYTES / chunk.length + 4);
  });

  it('.sha1 from maven: only the hash, otherwise checksum-mismatch', async () => {
    const url = 'https://maven.fabricmc.net/a/b/1/b-1.jar';
    const good = createFetchText(respond(`${'a'.repeat(40)}  b-1.jar\n`));
    await expect(fetchMavenSha1(url, good, signal)).resolves.toBe('a'.repeat(40));
    const bad = createFetchText(respond('<html>'));
    await expect(fetchMavenSha1(url, bad, signal)).rejects.toMatchObject({
      error: { code: 'checksum-mismatch' },
    });
  });
});
