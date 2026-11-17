/**
 * A deep copy of `value` with `structuredClone` semantics. Uses the global
 * `structuredClone` when there is one. Hermes (React Native) has none, so
 * there a local copy runs. It decides the kind of an object by the same
 * internal slots that `structuredClone` reads (brand checks), not by
 * `instanceof` or `Symbol.toStringTag`, and gives what the native
 * `structuredClone` of V8 gives:
 *
 * - `undefined`, `null`, strings, booleans, numbers (also `NaN`,
 *   `Infinity` and `-0`) and bigints are returned as they are.
 * - Arrays and ordinary objects are copied deeply: own enumerable string
 *   keys only, so a class instance, or an object with its own
 *   `Symbol.toStringTag`, becomes a plain object. A sparse array keeps its
 *   holes and its length.
 * - `Date`, `RegExp`, `Map`, `Set`, boxed primitives, `ArrayBuffer`s (a
 *   resizable one stays resizable), typed arrays (as the base type, never a
 *   subclass), `DataView`s, `Blob`s and `File`s are copied.
 * - An `Error` becomes an `Error` of its standard type (a custom name or
 *   `AggregateError` becomes `Error`), with its own `message`, its `stack`
 *   and its own `cause`. A `DOMException` stays one where the global exists.
 * - A `SharedArrayBuffer` is shared, not copied, like `structuredClone`.
 * - Cycles and shared references are kept: an object reached twice is
 *   copied once.
 * - Functions, symbols, `Symbol` wrappers, `arguments`, `WeakMap`,
 *   `WeakSet`, `WeakRef`, `Promise`, iterators, generators and the web
 *   platform objects that cannot be cloned (`URL`, `Headers`, streams...)
 *   throw an error named `"DataCloneError"`: a `DOMException` where the
 *   global exists, else an `Error` (Hermes has no `DOMException`).
 *
 * Two differences are left. A `Proxy` cannot be told from its target in
 * JavaScript, so the local copy reads it through its traps, where the
 * native one throws. And an ordinary object takes a fast path that runs no
 * brand check (each failed one throws and catches an exception, slow on
 * Hermes), so a `Map`, `Set`, `Promise` or other object whose prototype
 * was changed to `Object.prototype` or `null` is copied as a plain object.
 *
 * It never installs a global `structuredClone`, and it does not use the
 * JSON round trip of `structuredClone_` from `@ag-ui/client`, which turns
 * `undefined` into `{}` and drops or changes values JSON cannot hold.
 *
 * @param value - The value to copy.
 * @returns A copy that shares no object with `value`, except a
 *   `SharedArrayBuffer`.
 * @throws An error named `"DataCloneError"` for a value that cannot be
 *   cloned.
 */
export function cloneValue<T>(value: T): T {
  const native = (globalThis as { structuredClone?: <V>(value: V) => V })
    .structuredClone;
  if (typeof native === "function") return native(value);
  return cloneInto(value, new Map()) as T;
}

type AnyFunction = (this: unknown, ...args: unknown[]) => unknown;
type Constructor = new (...args: unknown[]) => unknown;

/** A global, or `undefined` when this engine does not have it. */
function globalNamed<T = Constructor>(name: string): T | undefined {
  return (globalThis as unknown as Record<string, T | undefined>)[name];
}

/** True when `method` accepts `value` as its `this`: a brand check. */
function hasBrand(
  value: object,
  method: AnyFunction | undefined,
  ...args: unknown[]
) {
  if (typeof method !== "function") return false;
  try {
    method.call(value, ...args);
    return true;
  } catch {
    return false;
  }
}

/** The getter of `key` on `proto`, for a brand check. */
function getterOf(proto: object | undefined, key: PropertyKey) {
  if (!proto) return undefined;
  return Object.getOwnPropertyDescriptor(proto, key)?.get as
    | AnyFunction
    | undefined;
}

function protoOf(name: string): object | undefined {
  return (globalNamed<{ prototype?: object }>(name) ?? {}).prototype;
}

function methodOf(name: string, key: string): AnyFunction | undefined {
  const proto = protoOf(name) as Record<string, AnyFunction> | undefined;
  return proto?.[key];
}

const ERROR_NAMES = new Set([
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);

/** Web platform objects that `structuredClone` refuses, where they exist. */
const PLATFORM_UNCLONEABLE = [
  "URL",
  "URLSearchParams",
  "Headers",
  "Request",
  "Response",
  "FormData",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "MessagePort",
];

function* emptyGenerator() {
  // Only its prototype chain is used.
}

/** The prototypes of the built-in iterators and generators. */
function iteratorPrototypes(): object[] {
  const protos: object[] = [];
  const add = (iterator: unknown) => {
    const proto = iterator && Object.getPrototypeOf(iterator);
    if (proto) protos.push(proto);
  };
  add([][Symbol.iterator]());
  add(new Map()[Symbol.iterator]());
  add(new Set()[Symbol.iterator]());
  add(""[Symbol.iterator]());
  // The prototype of a generator object is its function's own `prototype`;
  // the shared one is above it.
  protos.push(Object.getPrototypeOf(emptyGenerator.prototype) as object);
  const matchAllKey = (Symbol as unknown as Record<string, symbol | undefined>)
    .matchAll;
  const matchAll = matchAllKey
    ? (RegExp.prototype as unknown as Record<symbol, AnyFunction | undefined>)[
        matchAllKey
      ]
    : undefined;
  if (typeof matchAll === "function") add(matchAll.call(/a/g, ""));
  return protos;
}

let iteratorProtos: object[] | undefined;

function inheritsFrom(value: object, protos: readonly object[]) {
  for (
    let proto = Object.getPrototypeOf(value);
    proto !== null;
    proto = Object.getPrototypeOf(proto)
  ) {
    if (protos.includes(proto)) return true;
  }
  return false;
}

function dataCloneError(what: string): Error {
  const message = `${what} could not be cloned.`;
  const DOMExceptionClass =
    globalNamed<new (message: string, name: string) => Error>("DOMException");
  if (typeof DOMExceptionClass === "function") {
    return new DOMExceptionClass(message, "DataCloneError");
  }
  const error = new Error(message);
  error.name = "DataCloneError";
  return error;
}

function describe(value: unknown): string {
  if (typeof value === "function") {
    return value.name ? `function ${value.name}` : "A function";
  }
  if (typeof value === "symbol") return String(value);
  return Object.prototype.toString.call(value);
}

/** True for an object with the [[ErrorData]] slot. */
function isError(value: object) {
  const isErrorCheck = (Error as unknown as { isError?: AnyFunction }).isError;
  if (typeof isErrorCheck === "function") {
    return isErrorCheck.call(Error, value) === true;
  }
  // Without Error.isError the built-in tag shows the slot, unless a
  // Symbol.toStringTag hides it (a DOMException has one).
  if (!(Symbol.toStringTag in value)) {
    return Object.prototype.toString.call(value) === "[object Error]";
  }
  return value instanceof Error;
}

function isDOMException(value: object) {
  return hasBrand(value, getterOf(protoOf("DOMException"), "code"));
}

/** The name of the base typed-array type of a view, or `undefined`. */
function typedArrayName(value: object): string | undefined {
  const TypedArrayProto = Object.getPrototypeOf(Uint8Array.prototype) as object;
  const getter = getterOf(TypedArrayProto, Symbol.toStringTag);
  if (!getter) return undefined;
  const name = getter.call(value);
  return typeof name === "string" ? name : undefined;
}

function cloneArrayBuffer(value: ArrayBuffer): ArrayBuffer {
  const source = value as ArrayBuffer & {
    resizable?: boolean;
    maxByteLength?: number;
  };
  if (source.resizable === true) {
    const ArrayBufferClass = ArrayBuffer as unknown as new (
      length: number,
      options: { maxByteLength: number },
    ) => ArrayBuffer;
    const copy = new ArrayBufferClass(source.byteLength, {
      maxByteLength: source.maxByteLength as number,
    });
    new Uint8Array(copy).set(new Uint8Array(source));
    return copy;
  }
  return ArrayBuffer.prototype.slice.call(value, 0) as ArrayBuffer;
}

function cloneError(value: Error, seen: Map<object, unknown>): Error {
  let copy: Error;
  const own = (key: string) => Object.prototype.hasOwnProperty.call(value, key);
  const messageDescriptor = Object.getOwnPropertyDescriptor(value, "message");
  const message =
    messageDescriptor && "value" in messageDescriptor
      ? `${messageDescriptor.value}`
      : undefined;
  if (isDOMException(value)) {
    const DOMExceptionClass =
      globalNamed<new (message?: string, name?: string) => Error>(
        "DOMException",
      )!;
    copy = new DOMExceptionClass(value.message, value.name);
  } else {
    const name = ERROR_NAMES.has(value.name) ? value.name : "Error";
    const ErrorClass = globalNamed<ErrorConstructor>(name) ?? Error;
    copy = message === undefined ? new ErrorClass() : new ErrorClass(message);
  }
  seen.set(value, copy);
  if (typeof value.stack === "string") copy.stack = value.stack;
  if (!isDOMException(value)) {
    const causeDescriptor = Object.getOwnPropertyDescriptor(value, "cause");
    if (own("cause") && causeDescriptor && "value" in causeDescriptor) {
      // Defined, not passed as an option: Hermes may not read ErrorOptions.
      Object.defineProperty(copy, "cause", {
        value: cloneInto(causeDescriptor.value, seen),
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
  }
  return copy;
}

function cloneInto(value: unknown, seen: Map<object, unknown>): unknown {
  if (typeof value === "function" || typeof value === "symbol") {
    throw dataCloneError(describe(value));
  }
  if (typeof value !== "object" || value === null) return value;
  const known = seen.get(value);
  if (known !== undefined) return known;

  if (Array.isArray(value)) {
    // The same length, so a sparse array keeps its holes.
    const copy: unknown[] = [];
    copy.length = value.length;
    seen.set(value, copy);
    copyKeys(value, copy, seen);
    return copy;
  }
  // The common case, before the brand checks below: each one that fails
  // throws and catches an exception, which is slow on Hermes.
  if (isPlainObject(value)) {
    const copy: Record<string, unknown> = {};
    seen.set(value, copy);
    copyKeys(value, copy, seen);
    return copy;
  }
  if (hasBrand(value, Date.prototype.getTime as AnyFunction)) {
    const copy = new Date(Date.prototype.getTime.call(value));
    seen.set(value, copy);
    return copy;
  }
  if (hasBrand(value, getterOf(RegExp.prototype, "source"))) {
    const source = getterOf(RegExp.prototype, "source")!.call(value) as string;
    const flags = getterOf(RegExp.prototype, "flags")!.call(value) as string;
    const copy = new RegExp(source, flags);
    seen.set(value, copy);
    return copy;
  }
  if (hasBrand(value, Map.prototype.has as AnyFunction, undefined)) {
    const copy = new Map<unknown, unknown>();
    seen.set(value, copy);
    const entries: [unknown, unknown][] = [];
    Map.prototype.forEach.call(value, (entry: unknown, key: unknown) => {
      entries.push([key, entry]);
    });
    for (const [key, entry] of entries) {
      copy.set(cloneInto(key, seen), cloneInto(entry, seen));
    }
    return copy;
  }
  if (hasBrand(value, Set.prototype.has as AnyFunction, undefined)) {
    const copy = new Set<unknown>();
    seen.set(value, copy);
    const entries: unknown[] = [];
    Set.prototype.forEach.call(value, (entry: unknown) => {
      entries.push(entry);
    });
    for (const entry of entries) copy.add(cloneInto(entry, seen));
    return copy;
  }
  if (hasBrand(value, getterOf(ArrayBuffer.prototype, "byteLength"))) {
    const copy = cloneArrayBuffer(value as ArrayBuffer);
    seen.set(value, copy);
    return copy;
  }
  if (hasBrand(value, getterOf(protoOf("SharedArrayBuffer"), "byteLength"))) {
    // structuredClone shares the memory of a SharedArrayBuffer.
    seen.set(value, value);
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    const buffer = cloneInto(view.buffer, seen) as ArrayBuffer;
    const isDataView = hasBrand(
      value,
      getterOf(DataView.prototype, "byteLength"),
    );
    let copy: ArrayBufferView;
    if (isDataView) {
      copy = new DataView(buffer, view.byteOffset, view.byteLength);
    } else {
      const name = typedArrayName(value);
      const TypedArray = name
        ? globalNamed<
            new (
              buffer: ArrayBuffer,
              byteOffset: number,
              length: number,
            ) => ArrayBufferView
          >(name)
        : undefined;
      if (!TypedArray) throw dataCloneError(describe(value));
      const proto = Object.getPrototypeOf(Uint8Array.prototype) as object;
      const offset = getterOf(proto, "byteOffset")!.call(value) as number;
      const length = getterOf(proto, "length")!.call(value) as number;
      copy = new TypedArray(buffer, offset, length);
    }
    seen.set(value, copy);
    return copy;
  }
  if (isError(value)) return cloneError(value as Error, seen);

  for (const [name, Boxed] of [
    ["Boolean", Boolean],
    ["Number", Number],
    ["String", String],
    ["BigInt", globalNamed("BigInt")],
  ] as const) {
    const valueOf = methodOf(name, "valueOf");
    if (Boxed && hasBrand(value, valueOf)) {
      const copy = Object(valueOf!.call(value));
      seen.set(value, copy);
      return copy;
    }
  }
  if (hasBrand(value, methodOf("Symbol", "valueOf"))) {
    throw dataCloneError(describe(value));
  }
  const BlobClass = globalNamed<{ prototype: Blob }>("Blob");
  if (typeof BlobClass === "function" && value instanceof BlobClass) {
    const copy = cloneBlob(value as Blob);
    seen.set(value, copy);
    return copy;
  }
  if (isUncloneable(value)) throw dataCloneError(describe(value));

  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  copyKeys(value, copy, seen);
  return copy;
}

function cloneBlob(value: Blob): Blob {
  const FileClass =
    globalNamed<
      new (
        parts: Blob[],
        name: string,
        options: { type: string; lastModified: number },
      ) => Blob
    >("File");
  if (typeof FileClass === "function" && value instanceof FileClass) {
    const file = value as Blob & { name: string; lastModified: number };
    return new FileClass([value], file.name, {
      type: value.type,
      lastModified: file.lastModified,
    });
  }
  const BlobClass =
    globalNamed<new (parts: Blob[], options: { type: string }) => Blob>(
      "Blob",
    )!;
  return new BlobClass([value], { type: value.type });
}

/**
 * True for an ordinary object of this realm: its prototype is
 * `Object.prototype` or `null`, it has no `Symbol.toStringTag`, and its
 * built-in tag is "Object" (so not `arguments`, an `Error`, a `Date`, a
 * `RegExp` or a boxed primitive, whatever their prototype). Throws nothing.
 * An object with another slot (a `Map`, a `Set`, a `Promise`...) whose
 * prototype was changed to one of those passes too; only a brand check,
 * which throws, could tell, so it is copied as a plain object.
 */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  if (Symbol.toStringTag in value) return false;
  if (ArrayBuffer.isView(value)) return false;
  return Object.prototype.toString.call(value) === "[object Object]";
}

/** The globals of PLATFORM_UNCLONEABLE and their prototypes, when last read. */
let platformCache: { classes: unknown[]; protos: object[] } | undefined;

/**
 * The prototypes of the PLATFORM_UNCLONEABLE globals that exist. Kept
 * between calls, and built again only when one of the globals changed (a
 * polyfill installed late).
 */
function platformPrototypes(): object[] {
  const globals = globalThis as unknown as Record<string, unknown>;
  const cached = platformCache;
  if (
    cached &&
    PLATFORM_UNCLONEABLE.every(
      (name, index) => globals[name] === cached.classes[index],
    )
  ) {
    return cached.protos;
  }
  const classes = PLATFORM_UNCLONEABLE.map((name) => globals[name]);
  const protos = PLATFORM_UNCLONEABLE.map(protoOf).filter(
    (proto): proto is object => proto !== undefined,
  );
  platformCache = { classes, protos };
  return protos;
}

/** An object that structuredClone refuses, though it has no data slot. */
function isUncloneable(value: object) {
  // An arguments object: V8 refuses it. Only the built-in tag says so; an
  // object that only claims the tag is a plain object.
  if (
    !(Symbol.toStringTag in value) &&
    Object.prototype.toString.call(value) === "[object Arguments]"
  ) {
    return true;
  }
  if (
    hasBrand(value, methodOf("WeakMap", "has"), {}) ||
    hasBrand(value, methodOf("WeakSet", "has"), {}) ||
    hasBrand(value, methodOf("WeakRef", "deref")) ||
    hasBrand(value, methodOf("FinalizationRegistry", "unregister"), {})
  ) {
    return true;
  }
  const PromiseClass = globalNamed<{ prototype: object }>("Promise");
  if (PromiseClass && value instanceof (PromiseClass as unknown as Constructor))
    return true;
  if (!iteratorProtos) iteratorProtos = iteratorPrototypes();
  if (inheritsFrom(value, iteratorProtos)) return true;
  return inheritsFrom(value, platformPrototypes());
}

/** Copies the own enumerable string keys, as structuredClone does. */
function copyKeys(source: object, target: object, seen: Map<object, unknown>) {
  for (const key of Object.keys(source)) {
    assign(
      target as Record<string, unknown>,
      key,
      cloneInto((source as Record<string, unknown>)[key], seen),
    );
  }
}

/**
 * Sets an own property. A plain assignment of "__proto__" would change the
 * prototype of the copy instead (JSON.parse makes "__proto__" an own key).
 */
function assign(target: Record<string, unknown>, key: string, value: unknown) {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } else {
    target[key] = value;
  }
}
