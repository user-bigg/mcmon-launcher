// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { keepSelectionOnLinks, limitSelectAll } from './selection';

interface Page {
  link: HTMLAnchorElement;
  linkText: Text;
  outsideText: Text;
}

function page(): Page {
  const link = document.createElement('a');
  link.href = '#/server/1';
  const linkText = document.createTextNode('SkyWorld');
  link.append(linkText);
  const outsideText = document.createTextNode(' and more');
  const paragraph = document.createElement('p');
  paragraph.append(link, outsideText);
  document.body.replaceChildren(paragraph);
  return { link, linkText, outsideText };
}

function click(target: Element, detail = 1): boolean {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function press(target: Element): void {
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1 }));
}

function select(node: Node, from: number, to: number): void {
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, to);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe('selection inside a link', () => {
  beforeAll(() => {
    keepSelectionOnLinks(document);
  });

  it("a click after selecting a link's text does not navigate it", () => {
    const { link, linkText } = page();
    document.getSelection()?.removeAllRanges();
    press(link);
    select(linkText, 0, 3);
    expect(click(link)).toBe(true);
  });

  it('the next click on the same link navigates, if the selection did not change', () => {
    const { link, linkText } = page();
    document.getSelection()?.removeAllRanges();
    press(link);
    select(linkText, 0, 3);
    expect(click(link)).toBe(true);
    press(link);
    expect(click(link)).toBe(false);
    expect(document.getSelection()?.isCollapsed ?? true).toBe(true);
    press(link);
    select(linkText, 0, 3);
    expect(click(link)).toBe(true);
    press(link);
    select(linkText, 2, 6);
    expect(click(link)).toBe(true);
  });

  it('a normal click and a selection outside the link do not affect navigation', () => {
    const { link, outsideText } = page();
    document.getSelection()?.removeAllRanges();
    expect(click(link)).toBe(false);
    select(outsideText, 0, 3);
    expect(click(link)).toBe(false);
  });

  it('Enter on a link navigates, even if it contains a selection', () => {
    const { link, linkText } = page();
    select(linkText, 0, 3);
    expect(click(link, 0)).toBe(false);
  });
});

function pressSelectAll(target: Element, code = 'KeyA', key = 'ф'): boolean {
  const event = new KeyboardEvent('keydown', {
    code,
    key,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('Ctrl+A', () => {
  beforeAll(() => {
    limitSelectAll(document);
  });

  it('outside a field and content nothing is selected', () => {
    const button = document.createElement('button');
    button.textContent = 'Play';
    document.body.replaceChildren(button);
    document.getSelection()?.removeAllRanges();
    expect(pressSelectAll(button)).toBe(true);
    expect(document.getSelection()?.toString() ?? '').toBe('');
  });

  it('in the log, only the log is selected', () => {
    const log = document.createElement('pre');
    log.className = 'selectable';
    log.textContent = 'line 1\nline 2';
    const other = document.createElement('p');
    other.textContent = 'other';
    document.body.replaceChildren(other, log);
    expect(pressSelectAll(log)).toBe(true);
    expect(document.getSelection()?.toString()).toBe('line 1\nline 2');
  });

  it('works as usual in an input field', () => {
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    document.body.replaceChildren(input, area);
    expect(pressSelectAll(input)).toBe(false);
    expect(pressSelectAll(area)).toBe(false);
  });

  it('a radio button, a checkbox and contenteditable="false" are not a field', () => {
    const radio = document.createElement('input');
    radio.type = 'radio';
    const box = document.createElement('input');
    box.type = 'checkbox';
    const fixed = document.createElement('div');
    fixed.setAttribute('contenteditable', 'false');
    fixed.textContent = 'text';
    document.body.replaceChildren(radio, box, fixed);
    for (const target of [radio, box, fixed]) {
      document.getSelection()?.removeAllRanges();
      expect(pressSelectAll(target)).toBe(true);
      expect(document.getSelection()?.toString() ?? '').toBe('');
    }
  });

  it('layouts: Latin by letter, Cyrillic by key', () => {
    const button = document.createElement('button');
    document.body.replaceChildren(button);
    expect(pressSelectAll(button, 'KeyQ', 'a')).toBe(true);
    expect(pressSelectAll(button, 'KeyA', 'q')).toBe(false);
    expect(pressSelectAll(button, 'KeyA', 'A')).toBe(true);
  });
});
