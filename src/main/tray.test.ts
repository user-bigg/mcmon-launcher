import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { ru } from '@shared/i18n/ru';

vi.mock('electron', () => ({ Menu: {}, nativeImage: {}, Tray: {} }));
vi.mock('./app-icon', () => ({
  APP_ICON_PATH: 'icon.png',
  WINDOWS_ICON_PATH: 'icon.ico',
  TRAY_TEMPLATE_PATHS: { x1: 'tray.png', x2: 'tray@2x.png' },
}));

const { trayMenu, trayTooltip } = await import('./tray');

interface Actions {
  show: ReturnType<typeof vi.fn<() => void>>;
  stopGame: ReturnType<typeof vi.fn<() => void>>;
  quit: ReturnType<typeof vi.fn<() => void>>;
  setAutostart: ReturnType<typeof vi.fn<(enabled: boolean) => void>>;
}

function actions(): Actions {
  return { show: vi.fn(), stopGame: vi.fn(), quit: vi.fn(), setAutostart: vi.fn() };
}

function labels(items: MenuItemConstructorOptions[]): string[] {
  return items.map((item) => (item.type === 'separator' ? '---' : (item.label ?? '')));
}

function click(items: MenuItemConstructorOptions[], label: string, checked = false): void {
  const item = items.find((entry) => entry.label === label);
  (item?.click as ((clicked: { checked: boolean }) => void) | undefined)?.({ checked });
}

describe('tray menu', () => {
  it('without a game: open, the autostart switch, quit', () => {
    const menu = trayMenu({ game: null, autostart: true, platform: 'win32' }, actions());
    expect(labels(menu)).toEqual([
      'Открыть MC Monitor',
      '---',
      'Запускать с Windows',
      '---',
      'Выйти',
    ]);
  });

  it('during a game adds a disabled line with its name and the close item', () => {
    const menu = trayMenu(
      { game: { name: 'Cube Island', starting: false }, autostart: true, platform: 'win32' },
      actions(),
    );
    expect(labels(menu)).toEqual([
      'Открыть MC Monitor',
      'Идёт игра: Cube Island',
      'Закрыть игру',
      '---',
      'Запускать с Windows',
      '---',
      'Выйти',
    ]);
    expect(menu[1]?.enabled).toBe(false);
    expect(menu[1]?.click).toBeUndefined();
  });

  it('until the game window is there says the game is starting, not running', () => {
    const named = trayMenu(
      { game: { name: 'Cube Island', starting: true }, autostart: true, platform: 'win32' },
      actions(),
    );
    expect(named[1]?.label).toBe('Запускается: Cube Island');
    const unnamed = trayMenu(
      { game: { name: null, starting: true }, autostart: true, platform: 'win32' },
      actions(),
    );
    expect(unnamed[1]?.label).toBe('Игра запускается');
    expect(trayTooltip({ name: 'Cube Island', starting: true })).toBe(
      'MC Monitor\u00a0— игра запускается',
    );
  });

  it('names no game when the name is unknown', () => {
    const menu = trayMenu(
      { game: { name: null, starting: false }, autostart: false, platform: 'win32' },
      actions(),
    );
    expect(menu[1]?.label).toBe(ru.tray.playingUnnamed);
  });

  it('shows the autostart setting as a checkbox and flips it', () => {
    const on = actions();
    const checked = trayMenu({ game: null, autostart: true, platform: 'win32' }, on);
    expect(checked[2]).toMatchObject({ type: 'checkbox', checked: true });
    click(checked, ru.tray.autostart.windows, false);
    expect(on.setAutostart).toHaveBeenCalledWith(false);
    const off = actions();
    const unchecked = trayMenu({ game: null, autostart: false, platform: 'win32' }, off);
    expect(unchecked[2]).toMatchObject({ type: 'checkbox', checked: false });
    click(unchecked, ru.tray.autostart.windows, true);
    expect(off.setAutostart).toHaveBeenCalledWith(true);
  });

  it('takes the choice from the clicked item, not from the state the menu was built with', () => {
    const stale = actions();
    const menu = trayMenu({ game: null, autostart: true, platform: 'win32' }, stale);
    click(menu, ru.tray.autostart.windows, true);
    expect(stale.setAutostart).toHaveBeenCalledWith(true);
  });

  it('on macOS and Linux calls the switch a start at login', () => {
    const mac = trayMenu({ game: null, autostart: true, platform: 'darwin' }, actions());
    const linux = trayMenu({ game: null, autostart: true, platform: 'linux' }, actions());
    expect(labels(mac)[2]).toBe('Запускать при входе в систему');
    expect(labels(linux)[2]).toBe('Запускать при входе в систему');
  });

  it('wires open, close game and quit to their actions', () => {
    const wired = actions();
    const menu = trayMenu(
      { game: { name: null, starting: false }, autostart: true, platform: 'win32' },
      wired,
    );
    click(menu, ru.tray.open);
    click(menu, ru.tray.stopGame);
    click(menu, ru.tray.quit);
    expect(wired.show).toHaveBeenCalledOnce();
    expect(wired.stopGame).toHaveBeenCalledOnce();
    expect(wired.quit).toHaveBeenCalledOnce();
  });

  it('names the launcher in the tooltip, and the game while it runs', () => {
    expect(trayTooltip(null)).toBe('MC Monitor Launcher');
    expect(trayTooltip({ name: 'Cube Island', starting: false })).toBe('MC Monitor — идёт игра');
  });
});
