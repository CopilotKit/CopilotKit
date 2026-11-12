export interface ServerHandle {
  /** Base URL, e.g. "http://localhost:54321" */
  baseUrl: string;
  /** CopilotKit basePath, e.g. "/api/copilotkit" */
  basePath: string;
  /** Shut down the server */
  close: () => Promise<void>;
}

export type ServerFactory = (opts?: {
  capturedHeaders?: Record<string, string>[];
}) => Promise<ServerHandle>;

/**
 * A request function compatible with both real HTTP and direct fetch handler invocation.
 * For real servers this is just global `fetch`. For direct fetch handlers it calls the handler directly.
 */
export type RequestFn = typeof fetch;
