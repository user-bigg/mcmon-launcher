import { describe, expect, it } from 'vitest';
import { MAX_SIGNATURE_FILE_BYTES } from './signature';
import { signatureFromResponse } from './signature-response';

function streamOf(chunks: string[], failAfter = Infinity): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller): void {
      if (index >= failAfter) {
        controller.error(new Error('net::ERR_CONNECTION_RESET'));
        return;
      }
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(new TextEncoder().encode(chunk));
    },
  });
}

describe('response with .sig', () => {
  it('a short file is read as text', async () => {
    expect(await signatureFromResponse(new Response('c2ln\n'))).toEqual({
      ok: true,
      text: 'c2ln\n',
    });
  });

  it('404 — no file, 5xx — no connection', async () => {
    expect(await signatureFromResponse(new Response('', { status: 404 }))).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(await signatureFromResponse(new Response('', { status: 503 }))).toEqual({
      ok: false,
      reason: 'offline',
    });
  });

  it('the 404 and 5xx response body is not read, it is cancelled', async () => {
    for (const status of [404, 503]) {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        cancel(): void {
          cancelled = true;
        },
      });
      await signatureFromResponse(new Response(body, { status }));
      expect(cancelled).toBe(true);
    }
  });

  it('a drop mid-body — no connection, not a signature failure', async () => {
    const response = new Response(streamOf(['c2', 'ln'], 1));
    expect(await signatureFromResponse(response)).toEqual({ ok: false, reason: 'offline' });
  });

  it('over 512 bytes: not read per content-length, without it it cuts off at the limit', async () => {
    const declared = new Response(streamOf(['x']), {
      headers: { 'content-length': String(MAX_SIGNATURE_FILE_BYTES + 1) },
    });
    expect(await signatureFromResponse(declared)).toEqual({ ok: false, reason: 'missing' });
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller): void {
        pulled += 1;
        controller.enqueue(new Uint8Array(256));
      },
    });
    expect(await signatureFromResponse(new Response(endless))).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(pulled).toBeLessThan(10);
  });
});
