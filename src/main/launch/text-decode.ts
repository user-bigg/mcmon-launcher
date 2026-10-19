const utf8 = new TextDecoder('utf-8', { fatal: true });

const CP1251_HIGH =
  'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—\u0098™љ›њќћџ\u00a0ЎўЈ¤Ґ¦§Ё©Є«¬\u00ad®Ї°±Ііґµ¶·ё№є»јЅѕї';
const CYRILLIC_CAPITAL_A = 0x0410;

function systemCp1251(): { decode: (bytes: Uint8Array) => string } | null {
  try {
    return new TextDecoder('windows-1251');
  } catch {
    return null;
  }
}

const cp1251 = systemCp1251();

function decodeCp1251Table(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    if (byte < 0x80) {
      text += String.fromCharCode(byte);
    } else if (byte >= 0xc0) {
      text += String.fromCharCode(CYRILLIC_CAPITAL_A + byte - 0xc0);
    } else {
      text += CP1251_HIGH[byte - 0x80] ?? '�';
    }
  }
  return text;
}

export function decodeCp1251(bytes: Uint8Array): string {
  return cp1251 === null ? decodeCp1251Table(bytes) : cp1251.decode(bytes);
}

// On Windows Java writes output, reports and hs_err in the system code page (cp1251 on
// Russian Windows) unless flags switch it. Invalid UTF-8 is the sign of such a line.
export function decodeText(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    return decodeCp1251(bytes);
  }
}

export function decodeLines(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    const lines: string[] = [];
    let start = 0;
    for (let index = 0; index <= bytes.length; index += 1) {
      if (index === bytes.length || bytes[index] === 0x0a) {
        lines.push(decodeText(bytes.subarray(start, index)));
        start = index + 1;
      }
    }
    return lines.join('\n');
  }
}

export function completeLinesAfter(bytes: Uint8Array): Uint8Array {
  const firstBreak = bytes.indexOf(0x0a);
  return firstBreak === -1 ? bytes : bytes.subarray(firstBreak + 1);
}

export function completeLinesBefore(bytes: Uint8Array): Uint8Array {
  const lastBreak = bytes.lastIndexOf(0x0a);
  return lastBreak === -1 ? bytes : bytes.subarray(0, lastBreak + 1);
}
