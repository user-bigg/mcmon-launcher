import type { MenuItemConstructorOptions } from 'electron';
import type { AppMenuActions } from './menu';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ Menu: {} }));

const { macMenu, menuPlan } = await import('./menu');

type Item = MenuItemConstructorOptions;

type Actions = Record<keyof AppMenuActions, ReturnType<typeof vi.fn<() => void>>>;

function actions(): Actions {
  return { about: vi.fn(), settings: vi.fn(), site: vi.fn() };
}

function submenu(item: Item | undefined): Item[] {
  return Array.isArray(item?.submenu) ? item.submenu : [];
}

function outline(menu: Item[]): Record<string, string[]> {
  return Object.fromEntries(
    menu.map((item) => [
      item.label ?? '',
      submenu(item).map((entry) => (entry.type === 'separator' ? '---' : (entry.label ?? ''))),
    ]),
  );
}

describe('macOS application menu', () => {
  it('is in Russian and in the order macOS expects', () => {
    expect(outline(macMenu(false, actions()))).toEqual({
      'MC Monitor': [
        'О программе MC Monitor',
        '---',
        'Настройки…',
        '---',
        'Скрыть MC Monitor',
        'Скрыть остальные',
        'Показать все',
        '---',
        'Завершить MC Monitor',
      ],
      Правка: [
        'Отменить',
        'Повторить',
        '---',
        'Вырезать',
        'Скопировать',
        'Вставить',
        'Выбрать всё',
      ],
      Окно: ['Свернуть', 'Закрыть'],
      Справка: ['Сайт MC Monitor'],
    });
  });

  it('has the view menu with reload and developer tools in development only', () => {
    const packaged = macMenu(false, actions());
    const development = macMenu(true, actions());
    const roles = (menu: Item[]): unknown[] =>
      menu.flatMap((item) => submenu(item).map((entry) => entry.role));
    expect(packaged.map((item) => item.label)).not.toContain('Вид');
    expect(roles(packaged)).not.toContain('reload');
    expect(roles(packaged)).not.toContain('forceReload');
    expect(roles(packaged)).not.toContain('toggleDevTools');
    expect(roles(development)).toContain('toggleDevTools');
  });

  it('uses system roles for the standard items', () => {
    const [app, edit, window] = macMenu(false, actions());
    const roles = (item: Item | undefined): unknown[] =>
      submenu(item)
        .map((entry) => entry.role)
        .filter((role) => role !== undefined);
    expect(roles(app)).toEqual(['hide', 'hideOthers', 'unhide', 'quit']);
    expect(roles(edit)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
    expect(roles(window)).toEqual(['minimize', 'close']);
  });

  it('opens the about section, the settings and the site', () => {
    const wired = actions();
    const [app, , , help] = macMenu(false, wired);
    const run = (item: Item | undefined, index: number): void => {
      (submenu(item)[index]?.click as (() => void) | undefined)?.();
    };
    run(app, 0);
    run(app, 2);
    run(help, 0);
    expect(wired.about).toHaveBeenCalledOnce();
    expect(wired.settings).toHaveBeenCalledOnce();
    expect(wired.site).toHaveBeenCalledOnce();
    expect(submenu(app)[2]?.accelerator).toBe('Command+,');
  });
});

describe('application menu by platform', () => {
  it('removes the menu and its shortcuts on Windows and Linux outside development', () => {
    expect(menuPlan('win32', false)).toBe('none');
    expect(menuPlan('linux', false)).toBe('none');
    expect(menuPlan('win32', true)).toBe('default');
    expect(menuPlan('darwin', false)).toBe('mac');
    expect(menuPlan('darwin', true)).toBe('mac');
  });
});
