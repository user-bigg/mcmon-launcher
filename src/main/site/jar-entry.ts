// The first of the named entries that fits the limit. The size is checked by the entry header
// before anything is unpacked: the jar sits in the player's folder and nobody verified it.
export async function readJarEntry(
  jar: string,
  names: readonly string[],
  maxBytes: number,
): Promise<Uint8Array | null> {
  const { open, filterEntries, readEntry } = await import('@xmcl/unzip');
  const zip = await open(jar, { lazyEntries: true, autoClose: false });
  try {
    const found = (await filterEntries(zip, [...names])).find(
      (entry) => entry !== undefined && entry.uncompressedSize <= maxBytes,
    );
    return found === undefined ? null : await readEntry(zip, found);
  } finally {
    zip.close();
  }
}
