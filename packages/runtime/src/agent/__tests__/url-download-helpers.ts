/**
 * Shared helpers for the URL download tests.
 */
import { vi } from "vitest";
import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * True if `localhost.` resolves only to loopback addresses on this host, and
 * false if the name does not exist here. Any other resolver error is thrown,
 * so that a broken resolver fails the test instead of skipping it. (The
 * agent-level guard test does not depend on this: it stubs the answer.)
 */
export async function localhostDotIsLoopback(): Promise<boolean> {
  let answers: Array<{ address: string }>;
  try {
    answers = await lookup("localhost.", { all: true });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOTFOUND" || code === "EAI_NONAME") return false;
    throw error;
  }
  return (
    answers.length > 0 &&
    answers.every(
      ({ address }) => address === "::1" || address.startsWith("127."),
    )
  );
}

/** One connection attempt seen by {@link interceptConnects}. */
export type ConnectAttempt = {
  host: string;
  port: unknown;
  /** The options that `socket.connect` received (for example `lookup`). */
  options: Record<string, unknown>;
  socket: net.Socket;
};

/**
 * Reads the destination of a `socket.connect` call. Node calls it in several
 * forms: `(options[, cb])`, `(port[, host][, cb])`, `(path[, cb])`, and, from
 * `net.createConnection` (which `http.request` uses), with one internal
 * array `[options, cb]` as the only argument.
 */
function connectTarget(args: unknown[]): {
  host: string | undefined;
  port: unknown;
  options: Record<string, unknown>;
} {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  if (typeof first === "object" && first !== null) {
    const options = first as Record<string, unknown>;
    const host =
      typeof options.host === "string"
        ? options.host
        : typeof options.path === "string"
          ? options.path
          : undefined;
    return { host, port: options.port, options };
  }
  if (typeof first === "number" || /^\d+$/.test(String(first))) {
    return {
      host: typeof args[1] === "string" ? args[1] : "localhost",
      port: first,
      options: {},
    };
  }
  if (typeof first === "string") {
    return { host: first, port: undefined, options: {} };
  }
  return { host: undefined, port: undefined, options: {} };
}

/**
 * Stops every connection attempt whose host matches `pattern` before a packet
 * is sent, and calls `onAttempt` with it. By default the socket then fails
 * with an error; with `hang`, it stays pending until it is destroyed.
 * Undo it with `vi.restoreAllMocks()`.
 */
export function interceptConnects(
  pattern: RegExp,
  onAttempt: (attempt: ConnectAttempt) => void,
  { hang = false }: { hang?: boolean } = {},
): void {
  const original = net.Socket.prototype.connect;
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function (
    this: net.Socket,
    ...args: unknown[]
  ) {
    const { host, port, options } = connectTarget(args);
    if (typeof host === "string" && pattern.test(host)) {
      onAttempt({ host, port, options, socket: this });
      if (hang) {
        // Looks like a connect in progress, so writes wait instead of
        // failing on a closed socket.
        (this as { connecting: boolean }).connecting = true;
      } else {
        process.nextTick(() =>
          this.destroy(new Error(`test blocked a connection to ${host}`)),
        );
      }
      return this;
    }
    return Reflect.apply(original, this, args) as net.Socket;
  } as typeof net.Socket.prototype.connect);
}

/**
 * Makes every connection attempt whose host matches `pattern` fail at once,
 * without sending a packet, and records its host. A regression can then
 * never reach a real service such as a cloud metadata endpoint from the test
 * host. Undo it with `vi.restoreAllMocks()`.
 */
export function blockConnects(pattern: RegExp): string[] {
  const attempts: string[] = [];
  interceptConnects(pattern, ({ host }) => attempts.push(host));
  return attempts;
}
