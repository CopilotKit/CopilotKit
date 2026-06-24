declare module "phoenix" {
  export interface Push {
    receive(status: string, callback: (payload?: unknown) => unknown): Push;
  }

  export interface Channel {
    on(event: string, callback: (payload: unknown) => void): number;
    off(event: string, ref?: number): void;
    onError?(callback: (reason?: unknown) => void): unknown;
    join(params?: Record<string, unknown>): Push;
    push?(event: string, payload: unknown): Push;
    leave(): void;
  }

  export class Socket {
    constructor(endPoint: string, opts?: Record<string, unknown>);
    connect(): void;
    disconnect(): void;
    channel(topic: string, params?: Record<string, unknown>): Channel;
    onError(callback: (error?: unknown) => void): unknown;
    onOpen(callback: () => void): unknown;
  }
}
