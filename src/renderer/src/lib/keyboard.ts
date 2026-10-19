const TEXT_INPUT_TYPES: readonly string[] = [
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'number',
];

export function isCommand(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey;
}

export function isCommandLetter(event: KeyboardEvent, letter: string): boolean {
  if (!isCommand(event)) {
    return false;
  }
  const key = event.key.toLowerCase();
  // Latin layouts (AZERTY too) report the letter in event.key; on the Russian layout it is
  // Cyrillic, so the physical key position in event.code is the fallback.
  return key === letter || (!/^[a-z]$/.test(key) && event.code === `Key${letter.toUpperCase()}`);
}

export function isSlash(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  // On the Russian layout the "/" key types "." and "/" itself is Shift+\, so the key from the
  // hint is recognised by its physical position too.
  return event.key === '/' || (event.code === 'Slash' && !event.shiftKey);
}

export function isTextField(target: Element | null): boolean {
  if (target === null) {
    return false;
  }
  if (target instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.includes(target.type);
  }
  return (
    target.closest('textarea, select, [contenteditable]:not([contenteditable="false"])') !== null
  );
}

export function modalOpen(root: Document): boolean {
  return root.querySelector('[aria-modal="true"]') !== null;
}
