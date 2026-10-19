import { ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { EventStream, InvokeMethod, InvokeTable, Invokers } from '@shared/ipc';

export function invokers<T>(table: InvokeTable<T>): Invokers<T> {
  const entries = (Object.keys(table) as InvokeMethod<T>[]).map((method) => {
    const channel = table[method];
    return [method, (...args: unknown[]): Promise<unknown> => ipcRenderer.invoke(channel, ...args)];
  });
  return Object.fromEntries(entries) as Invokers<T>;
}

type Subscribe = (listener: (value: never) => void) => () => void;

export function subscription(stream: EventStream): Subscribe {
  return (listener) => {
    const handler = (_event: IpcRendererEvent, value: unknown): void => {
      listener(value as never);
    };
    ipcRenderer.on(stream.event, handler);
    ipcRenderer.send(stream.subscribe);
    return (): void => {
      ipcRenderer.off(stream.event, handler);
    };
  };
}

export function listener(channel: string): Subscribe {
  return (callback) => {
    const handler = (_event: IpcRendererEvent, value: unknown): void => {
      callback(value as never);
    };
    ipcRenderer.on(channel, handler);
    return (): void => {
      ipcRenderer.off(channel, handler);
    };
  };
}
