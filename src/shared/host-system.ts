export type HostSystem = 'windows' | 'macos' | 'other';

export type BySystem<T> = Readonly<Record<HostSystem, T>>;

// Takes both Node's process.platform ('win32', 'darwin') and the browser's navigator.platform
// ('Win32', 'MacIntel'). An unknown system gets the texts that name no system.
export function hostSystemOf(platform: string): HostSystem {
  const name = platform.toLowerCase();
  if (name.startsWith('win')) {
    return 'windows';
  }
  return name.startsWith('mac') || name === 'darwin' ? 'macos' : 'other';
}
