import type { AppNavigation } from '@shared/ipc';
import type { GameEvent, LaunchEvent, LaunchPhase, LaunchState } from '@shared/launch';
import { instanceIdOf } from '@shared/launch';
import type { WhileGame } from '@shared/settings';

export const QUIET_REVEAL_MS = 2_000;
export const QUIT_WAIT_MS = 25_000;

export interface CloseEvent {
  preventDefault: () => void;
}

export interface LifecycleWindow {
  isDestroyed: () => boolean;
  hide: () => void;
  minimize: () => void;
  close: () => void;
  on: (event: 'close', listener: (event: CloseEvent) => void) => unknown;
}

export interface TrayGame {
  name: string | null;
  starting: boolean;
}

export interface LifecycleTray {
  update: (game: TrayGame | null) => void;
  destroy: () => void;
}

export interface LifecycleLaunch {
  onEvent: (listener: (event: LaunchEvent) => void) => () => void;
  kill: () => Promise<unknown>;
  cancel?: () => Promise<unknown>;
  whenIdle: () => Promise<void>;
}

export type ConfirmKind = 'quit' | 'stop-game' | 'close-install';

export interface RevealOptions {
  focus: boolean;
}

export interface LifecycleOptions<W extends LifecycleWindow> {
  launch: LifecycleLaunch;
  whileGame: () => WhileGame;
  openWindow: () => W;
  revealWindow: (window: W, options: RevealOptions) => void;
  navigate: (window: W, navigation: AppNavigation) => void;
  createTray: (actions: TrayActions) => LifecycleTray;
  confirm: (kind: ConfirmKind, window: W | null) => Promise<boolean>;
  quit: () => void;
  onHiddenToTray?: () => void;
  background?: () => boolean;
  onLeftInTray?: () => void;
  dock?: LifecycleDock | undefined;
  onQuitCancelled?: () => void;
  gameName?: () => string | null;
  now?: () => number;
  setTimer?: (action: () => void, ms: number) => unknown;
}

export interface LifecycleDock {
  hide: () => void;
  show: () => void;
}

export interface TrayActions {
  show: () => void;
  stopGame: () => void;
  quit: () => void;
}

type Concealed = 'none' | 'tray' | 'minimized';

export class GameLifecycle<W extends LifecycleWindow> {
  private window: W | null = null;
  private tray: LifecycleTray | null = null;
  private phase: LaunchPhase = 'idle';
  private gameAlive = false;
  private gameWindow = false;
  private slowShown = false;
  private crashedInstance: string | null = null;
  private concealed: Concealed = 'none';
  private userRevealed = false;
  private quitting = false;
  private stopping = false;
  private asking = false;
  private allowClose = false;
  private dockHidden = false;
  private lastQuietReveal = Number.NEGATIVE_INFINITY;
  private readonly now: () => number;
  private readonly setTimer: (action: () => void, ms: number) => unknown;

  constructor(private readonly options: LifecycleOptions<W>) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((action, ms): unknown => setTimeout(action, ms));
    options.launch.onEvent((event) => {
      this.onLaunchEvent(event);
    });
  }

  get current(): W | null {
    return this.window !== null && !this.window.isDestroyed() ? this.window : null;
  }

  get playing(): boolean {
    return this.gameAlive;
  }

  get hidden(): boolean {
    return this.concealed === 'tray';
  }

  open(): W {
    const existing = this.current;
    if (existing !== null) {
      return existing;
    }
    const window = this.options.openWindow();
    this.window = window;
    this.allowClose = false;
    window.on('close', (event) => {
      this.onClose(window, event);
    });
    return window;
  }

  startTray(): void {
    this.tray ??= this.options.createTray({
      show: () => {
        this.showByUser();
      },
      stopGame: () => {
        void this.stopGame();
      },
      quit: () => {
        void this.requestQuit();
      },
    });
    this.updateTray();
  }

  stayHidden(): void {
    this.hideDock();
  }

  showByUser(): W {
    this.userRevealed = this.gameAlive;
    return this.reveal({ focus: true });
  }

  revealForLink(): void {
    if (!this.gameAlive) {
      this.reveal({ focus: true });
      return;
    }
    const now = this.now();
    if (now - this.lastQuietReveal < QUIET_REVEAL_MS) {
      return;
    }
    this.lastQuietReveal = now;
    this.userRevealed = true;
    this.reveal({ focus: false });
  }

  async requestQuit(): Promise<void> {
    if (this.quitting) {
      this.options.quit();
      return;
    }
    if (this.gameAlive) {
      const confirmed = await this.ask('quit');
      if (!confirmed) {
        this.options.onQuitCancelled?.();
        return;
      }
      await this.stopAndWait();
    }
    this.quitting = true;
    this.options.quit();
  }

  holdQuit(): boolean {
    if (this.quitting || !this.gameAlive) {
      this.quitting = true;
      return false;
    }
    void this.requestQuit();
    return true;
  }

  cancelQuit(): void {
    this.quitting = false;
    this.options.onQuitCancelled?.();
  }

  endSession(): void {
    this.quitting = true;
  }

  async stopGame(): Promise<void> {
    if (!this.gameAlive || this.stopping) {
      return;
    }
    if (await this.ask('stop-game')) {
      await this.options.launch.kill();
    }
  }

  canQuitOnAllClosed(): boolean {
    return this.quitting || (!this.gameAlive && !this.staysInTray());
  }

  shutdown(): void {
    this.quitting = true;
    this.destroyTray();
  }

  private async ask(kind: ConfirmKind): Promise<boolean> {
    if (this.asking) {
      return false;
    }
    this.asking = true;
    try {
      return await this.options.confirm(kind, this.concealed === 'tray' ? null : this.current);
    } finally {
      this.asking = false;
    }
  }

  private async stopAndWait(): Promise<void> {
    this.stopping = true;
    try {
      const idle = this.options.launch.whenIdle();
      await this.options.launch.kill();
      await Promise.race([idle, this.delay(QUIT_WAIT_MS)]);
    } finally {
      this.stopping = false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.setTimer(resolve, ms);
    });
  }

  private onClose(window: W, event: CloseEvent): void {
    if (this.quitting || this.allowClose) {
      return;
    }
    if (this.gameAlive) {
      event.preventDefault();
      this.hideToTray();
      return;
    }
    if (this.phase === 'preparing') {
      event.preventDefault();
      void this.ask('close-install').then((confirmed) => {
        if (confirmed && !window.isDestroyed()) {
          this.closeDuringInstall(window);
        }
      });
      return;
    }
    if (this.staysInTray()) {
      this.leaveInTray();
    }
  }

  // Without the tray mode the app quits after the window and the quit stops the installation;
  // a launcher that stays in the tray has to stop it itself.
  private closeDuringInstall(window: W): void {
    if (this.staysInTray()) {
      void this.options.launch.cancel?.();
      this.leaveInTray();
    }
    this.allowClose = true;
    window.close();
  }

  private leaveInTray(): void {
    this.hideDock();
    this.options.onLeftInTray?.();
  }

  private staysInTray(): boolean {
    return this.tray !== null && this.options.background?.() === true;
  }

  private reveal(options: RevealOptions): W {
    const window = this.current ?? this.open();
    const wasInTray = this.concealed === 'tray';
    this.concealed = 'none';
    // Bringing the Dock icon back activates the app, which would take the focus from the game.
    if (options.focus) {
      this.showDock();
    }
    this.options.revealWindow(window, options);
    if (wasInTray) {
      this.options.navigate(window, { kind: 'restore' });
    }
    return window;
  }

  private onLaunchEvent(event: LaunchEvent): void {
    if (event.kind === 'phase') {
      this.phase = event.phase;
      if (event.phase === 'idle' && this.gameAlive) {
        this.gameAlive = false;
        this.updateTray();
      }
    }
    if (event.kind === 'game') {
      this.onGame(event.event, event.state);
    }
    this.onSlowStart(event.state.windowSlow);
  }

  // The question about a slow start is asked on the launch screen: a launcher the player sent
  // to the tray comes back for it, once per question and without taking the focus.
  private onSlowStart(slow: boolean): void {
    if (!slow) {
      this.slowShown = false;
      return;
    }
    if (this.slowShown || !this.gameAlive || this.quitting) {
      return;
    }
    this.slowShown = true;
    if (this.concealed !== 'none') {
      this.reveal({ focus: false });
    }
  }

  private onGame(game: GameEvent, state: LaunchState): void {
    switch (game.type) {
      case 'started':
        this.onStarted();
        return;
      case 'window-ready':
        this.gameWindow = true;
        this.updateTray();
        this.conceal();
        return;
      case 'connecting':
        return;
      case 'crash':
        this.crashedInstance = state.target === null ? null : instanceIdOf(state.target);
        return;
      case 'exit':
        this.onExit();
        return;
    }
  }

  private onStarted(): void {
    this.gameAlive = true;
    this.gameWindow = false;
    this.crashedInstance = null;
    this.userRevealed = false;
    this.updateTray();
  }

  // The launcher stays on screen until the game window is there: a game that never opens one
  // must not leave the player with nothing. The setting is read at that moment, so a switch
  // flipped during the installation counts.
  private conceal(): void {
    if (!this.gameAlive || this.quitting || this.userRevealed || this.concealed !== 'none') {
      return;
    }
    const mode: WhileGame = this.options.whileGame();
    if (mode === 'tray') {
      this.hideToTray();
    } else if (mode === 'minimize') {
      this.concealed = 'minimized';
      this.current?.minimize();
    }
  }

  private hideToTray(): void {
    if (!this.gameAlive || this.quitting) {
      return;
    }
    this.startTray();
    const window = this.current;
    const first = this.concealed !== 'tray';
    this.concealed = 'tray';
    if (window !== null) {
      this.options.navigate(window, { kind: 'idle' });
      window.hide();
    }
    this.hideDock();
    if (first) {
      this.options.onHiddenToTray?.();
    }
  }

  private onExit(): void {
    this.gameAlive = false;
    this.updateTray();
    const crashed = this.crashedInstance;
    const concealed = this.concealed;
    if (this.quitting || this.stopping) {
      return;
    }
    if (crashed !== null) {
      const window = this.reveal({ focus: true });
      this.options.navigate(window, { kind: 'crash', instanceId: crashed });
      return;
    }
    if (concealed !== 'none') {
      this.reveal({ focus: true });
    } else if (this.current !== null) {
      this.showDock();
    }
  }

  private hideDock(): void {
    if (!this.dockHidden) {
      this.dockHidden = true;
      this.options.dock?.hide();
    }
  }

  private showDock(): void {
    if (this.dockHidden) {
      this.dockHidden = false;
      this.options.dock?.show();
    }
  }

  private updateTray(): void {
    this.tray?.update(
      this.gameAlive
        ? { name: this.options.gameName?.() ?? null, starting: !this.gameWindow }
        : null,
    );
  }

  private destroyTray(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
