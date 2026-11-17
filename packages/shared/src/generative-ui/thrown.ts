// Turns any thrown value into an Error, for the error boundaries of the
// framework packages. Framework-free, and safe on Hermes.

/**
 * Sets `cause` as an own property. `new Error(message, { cause })` needs
 * ES2022 error options, which an engine without them (the JavaScriptCore of
 * iOS before 15, which React Native 0.70 can still run on) ignores without a
 * word, so it is set by hand on every engine.
 */
export function withCause(error: Error, cause: unknown): Error {
  Object.defineProperty(error, "cause", {
    value: cause,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  return error;
}

/** The longest description of a thrown object's data. */
const MAX_DESCRIPTION = 200;

/**
 * Reads what a thrown value says without letting the reading throw: a
 * getter, a Proxy trap, a `toJSON` or a `toString` may throw too.
 */
function attempt<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** The `message` of a thrown object, when it is a non-empty string. */
function messageOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const message = attempt(() => (value as { message?: unknown }).message);
  return typeof message === "string" && message !== "" ? message : undefined;
}

/** A thrown value as text, for a value that is not an Error. */
function describeThrown(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object" && value !== null) {
    // Its data, not "[object Object]".
    const json = attempt(() => JSON.stringify(value));
    if (typeof json === "string") {
      return json.length > MAX_DESCRIPTION
        ? `${json.slice(0, MAX_DESCRIPTION)}…`
        : json;
    }
  }
  return (
    attempt(() => String(value)) ??
    attempt(() => Object.prototype.toString.call(value)) ??
    typeof value
  );
}

/** An Error of this realm, or of another one (a frame, a VM context). */
function isError(value: unknown): value is Error {
  // `instanceof` runs a Proxy's getPrototypeOf trap, which may throw.
  if (attempt(() => value instanceof Error)) return true;
  // Another realm's Error fails `instanceof`; its tag says what it is. A
  // tag can be set on any object, so it must have a message as well.
  return (
    attempt(() => Object.prototype.toString.call(value)) === "[object Error]" &&
    typeof attempt(() => (value as { message?: unknown }).message) === "string"
  );
}

/**
 * The Error for any thrown value. Code may throw anything: a string, or a
 * falsy value (`undefined`, `null`, `0`, `""`) that a boundary which keeps
 * the thrown value and tests it for truth would take for "no error". An
 * Error comes back as it is; a non-empty string, or the string `message`
 * of a thrown object, becomes the message; any other value is described in
 * the message. A value that is not an Error is kept as the `cause`. This
 * never throws, whatever the value.
 */
export function toError(value: unknown): Error {
  if (isError(value)) return value;
  const message =
    typeof value === "string" && value !== ""
      ? value
      : (messageOf(value) ??
        `A value that is not an Error was thrown: ${describeThrown(value)}`);
  return withCause(new Error(message), value);
}
