import { isCommandLetter, isTextField } from './keyboard';

interface SelectionMark {
  anchorNode: Node | null;
  anchorOffset: number;
  focusNode: Node | null;
  focusOffset: number;
  text: string;
}

function markOf(selection: Selection | null): SelectionMark | null {
  if (selection === null || selection.isCollapsed) {
    return null;
  }
  return {
    anchorNode: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode,
    focusOffset: selection.focusOffset,
    text: selection.toString(),
  };
}

function sameMark(a: SelectionMark | null, b: SelectionMark | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    a.anchorNode === b.anchorNode &&
    a.anchorOffset === b.anchorOffset &&
    a.focusNode === b.focusNode &&
    a.focusOffset === b.focusOffset &&
    a.text === b.text
  );
}

function selectionInside(selection: Selection | null, link: Element): boolean {
  if (selection === null || selection.isCollapsed) {
    return false;
  }
  return [selection.anchorNode, selection.focusNode].some(
    (node) => node !== null && link.contains(node),
  );
}

export function keepSelectionOnLinks(root: Document): void {
  let beforePress: SelectionMark | null = null;
  root.addEventListener(
    'mousedown',
    () => {
      beforePress = markOf(root.getSelection());
    },
    { capture: true },
  );
  root.addEventListener(
    'click',
    (event) => {
      const before = beforePress;
      beforePress = null;
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest('a[href]') ?? null;
      // Keyboard activation (Enter) dispatches a click with detail 0 and must always navigate.
      const byKeyboard = event instanceof MouseEvent && event.detail === 0;
      const selection = root.getSelection();
      if (link === null || byKeyboard || !selectionInside(selection, link)) {
        return;
      }
      // A drag that selected the link's text ends in a click on it: keep the selection, skip
      // navigation. Chromium does not clear a selection on mousedown over user-select: none, so a
      // selection left from an earlier drag must not swallow later clicks on the same card.
      if (sameMark(before, markOf(selection))) {
        selection?.removeAllRanges();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true },
  );
}

export function limitSelectAll(root: Document): void {
  root.addEventListener('keydown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!isCommandLetter(event, 'a') || isTextField(target)) {
      return;
    }
    event.preventDefault();
    const region = target?.closest('.selectable') ?? null;
    if (region !== null) {
      root.getSelection()?.selectAllChildren(region);
    }
  });
}
