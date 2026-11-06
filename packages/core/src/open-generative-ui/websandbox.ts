/**
 * The part of `@jetbrains/websandbox` the controller uses, and the loader that
 * imports it.
 */

/** Host functions that sandboxed code calls through `Websandbox.connection.remote`. */
export type SandboxLocalApi = { [name: string]: Function | SandboxLocalApi };

/** A function the host exposes to sandboxed code. */
export interface SandboxFunctionHandle {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => unknown;
}

/** A running websandbox iframe. */
export interface WebsandboxInstance {
  iframe: HTMLIFrameElement;
  /** Resolves when the sandboxed document is ready to run code. */
  promise: Promise<unknown>;
  run(code: string): Promise<unknown>;
  destroy(): void;
}

/** The websandbox class, reduced to its factory. */
export interface WebsandboxConstructor {
  create(
    localApi: SandboxLocalApi,
    options: {
      frameContainer: HTMLElement;
      frameContent: string;
      allowAdditionalAttributes: string;
    },
  ): WebsandboxInstance;
}

/** Loads the websandbox class. Replace it in tests. */
export type WebsandboxLoader = () => Promise<WebsandboxConstructor>;

/**
 * Imports `@jetbrains/websandbox` on demand. The import is dynamic because
 * the package touches `self` when it loads, which breaks server rendering.
 */
export const loadWebsandbox: WebsandboxLoader = async () => {
  const mod = (await import("@jetbrains/websandbox")) as {
    default: WebsandboxConstructor | { default: WebsandboxConstructor };
  };
  // websandbox ships a UMD bundle with its own webpack `default` export.
  // Consumer bundlers (e.g. Next.js webpack) wrap CJS under another `.default`.
  const defaultExport = mod.default;
  return "default" in defaultExport ? defaultExport.default : defaultExport;
};
