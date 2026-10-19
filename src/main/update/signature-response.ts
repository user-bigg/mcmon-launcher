import type { SignatureFetch } from './controller';
import { MAX_SIGNATURE_FILE_BYTES } from './signature';

const TOO_LARGE = Symbol('too-large');

async function readLimited(
  response: Response,
  limit: number,
): Promise<Uint8Array | typeof TOO_LARGE> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > limit) {
    await response.body?.cancel();
    return TOO_LARGE;
  }
  if (response.body === null) {
    return new Uint8Array();
  }
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return Buffer.concat(chunks);
    }
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return TOO_LARGE;
    }
    chunks.push(value);
  }
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

export async function signatureFromResponse(response: Response): Promise<SignatureFetch> {
  if (response.status === 404 || response.status === 410) {
    await discard(response);
    return { ok: false, reason: 'missing' };
  }
  if (!response.ok) {
    await discard(response);
    return { ok: false, reason: 'offline' };
  }
  let body: Uint8Array | typeof TOO_LARGE;
  try {
    body = await readLimited(response, MAX_SIGNATURE_FILE_BYTES);
  } catch {
    return { ok: false, reason: 'offline' };
  }
  if (body === TOO_LARGE) {
    return { ok: false, reason: 'missing' };
  }
  return { ok: true, text: Buffer.from(body).toString('utf8') };
}
