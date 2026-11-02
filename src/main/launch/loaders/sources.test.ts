import { beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../json-cache';
import {
  createFetchText,
  fetchMavenSha1,
  forgetUnreachableHosts,
  isTrustedSource,
  LoaderStageError,
  MAX_TEXT_BYTES,
  mirrorOf,
  sourcesOf,
} from './sources';

beforeEach(() => {
  forgetUnreachableHosts();
});

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

describe('the copy of the Fabric hosts on the site', () => {
  const MIRRORED =
    'https://mc-mon.ru/mirror/fabric-meta/v2/versions/loader/26.3/0.19.5/profile/json';
  const PROFILE = `${META}/26.3/0.19.5/profile/json`;

  function recording(answer: (url: string) => Promise<Response>): {
    fetch: FetchLike;
    urls: string[];
  } {
    const urls: string[] = [];
    return {
      urls,
      fetch: (url): Promise<Response> => {
        urls.push(url);
        return answer(url);
      },
    };
  }

  it('maps only the Fabric hosts and trusts only the mirror paths', () => {
    expect(mirrorOf(PROFILE)).toBe(MIRRORED);
    expect(mirrorOf('https://maven.fabricmc.net/net/fabricmc/x.jar')).toBe(
      'https://mc-mon.ru/mirror/fabric-maven/net/fabricmc/x.jar',
    );
    expect(mirrorOf('https://libraries.minecraft.net/x.jar')).toBeNull();
    expect(mirrorOf('https://maven.fabricmc.net/x.jar?y=1')).toBeNull();
    expect(isTrustedSource(MIRRORED)).toBe(true);
    expect(isTrustedSource('https://mc-mon.ru/storage/x.jar')).toBe(false);
    expect(isTrustedSource('http://mc-mon.ru/mirror/fabric-meta/x')).toBe(false);
  });

  it('a network failure or a server error goes to the copy', async () => {
    const offline = recording((url) =>
      url === PROFILE
        ? Promise.reject(new TypeError('fetch failed'))
        : Promise.resolve(new Response('{}')),
    );
    await expect(createFetchText(offline.fetch)(PROFILE, signal)).resolves.toBe('{}');
    expect(offline.urls).toEqual([PROFILE, MIRRORED]);
    const broken = recording((url) =>
      Promise.resolve(url === PROFILE ? new Response('', { status: 502 }) : new Response('ok')),
    );
    await expect(createFetchText(broken.fetch)(PROFILE, signal)).resolves.toBe('ok');
  });

  it('a refusal or a redirect elsewhere on the way to the host goes to the copy', async () => {
    const refused = recording((url) =>
      Promise.resolve(url === PROFILE ? new Response('', { status: 451 }) : new Response('ok')),
    );
    await expect(createFetchText(refused.fetch)(PROFILE, signal)).resolves.toBe('ok');
    forgetUnreachableHosts();
    const portal = recording((url) => {
      const response = new Response(url === PROFILE ? 'portal' : 'ok');
      if (url === PROFILE) {
        Object.defineProperty(response, 'url', { value: 'https://portal.example/login' });
      }
      return Promise.resolve(response);
    });
    await expect(createFetchText(portal.fetch)(PROFILE, signal)).resolves.toBe('ok');
    expect(portal.urls).toEqual([PROFILE, MIRRORED]);
  });

  it('when both fail the error of the original host stands', async () => {
    const both = recording((url) =>
      url === PROFILE
        ? Promise.reject(Object.assign(new TypeError('fetch failed'), { code: 'ECONNRESET' }))
        : Promise.resolve(new Response('', { status: 404 })),
    );
    await expect(createFetchText(both.fetch)(PROFILE, signal)).rejects.toMatchObject({
      code: 'ECONNRESET',
    });
  });

  it('a host that did not answer is asked after its copy for the rest of the session', async () => {
    const offline = recording((url) =>
      url.startsWith('https://meta.fabricmc.net')
        ? Promise.reject(new TypeError('fetch failed'))
        : Promise.resolve(new Response('{}')),
    );
    const fetchText = createFetchText(offline.fetch);
    await fetchText(PROFILE, signal);
    await fetchText(PROFILE, signal);
    expect(offline.urls).toEqual([PROFILE, MIRRORED, MIRRORED]);
    expect(sourcesOf(PROFILE)).toEqual([MIRRORED, PROFILE]);
    expect(sourcesOf('https://maven.fabricmc.net/a.jar')[0]).toBe(
      'https://maven.fabricmc.net/a.jar',
    );
  });

  it('an encoded step out of the mirror prefix is not trusted', () => {
    for (const path of ['..%2f..%2fapi', '%2e%2e/api', 'a%5Cb', 'a//b']) {
      expect(isTrustedSource(`https://mc-mon.ru/mirror/fabric-maven/${path}`)).toBe(false);
    }
    expect(isTrustedSource('https://mc-mon.ru:8443/mirror/fabric-maven/a.jar')).toBe(false);
  });

  it('an unknown version answer is final and is not asked of the copy', async () => {
    const missing = recording(() => Promise.resolve(new Response('', { status: 400 })));
    await expect(createFetchText(missing.fetch)(PROFILE, signal)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(missing.urls).toEqual([PROFILE]);
  });
});
