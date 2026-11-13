import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cloneValue } from "../clone-value";

// The local copy of cloneValue runs where there is no global
// structuredClone (Hermes). It must give what the native structuredClone
// gives: the same value, or the same DataCloneError. This test runs every
// input of one table through both and compares the results. Each case that
// differs must be in KNOWN_DIVERGENCES, with the reason it cannot match.

type Outcome =
  | { kind: "value"; fingerprint: unknown }
  | { kind: "throws"; name: string; errorClass: string };

/** Everything structuredClone keeps, as plain data that toEqual compares. */
function fingerprint(
  value: unknown,
  seen = new Map<object, number>(),
): unknown {
  if (typeof value === "number") {
    return Object.is(value, -0) ? "number:-0" : `number:${value}`;
  }
  if (typeof value === "bigint") return `bigint:${value}`;
  if (typeof value !== "object" || value === null) {
    return `${typeof value}:${String(value)}`;
  }
  const ref = seen.get(value);
  if (ref !== undefined) return `ref:${ref}`;
  seen.set(value, seen.size);
  const proto = Object.getPrototypeOf(value) as {
    constructor?: { name?: string };
  } | null;
  const result: Record<string, unknown> = {
    tag: Object.prototype.toString.call(value),
    proto: proto === null ? "null" : (proto.constructor?.name ?? "?"),
  };
  const own = (key: string) => Object.prototype.hasOwnProperty.call(value, key);
  if (value instanceof Error) {
    const error = value as Error & { cause?: unknown; code?: unknown };
    result.name = error.name;
    result.message = error.message;
    result.ownMessage = own("message");
    result.ownCause = own("cause");
    if (own("cause")) result.cause = fingerprint(error.cause, seen);
    result.stack = error.stack;
    if (typeof DOMException === "function" && value instanceof DOMException) {
      result.code = error.code;
    }
  }
  if (value instanceof Date) result.time = value.getTime();
  if (value instanceof RegExp) {
    result.source = value.source;
    result.flags = value.flags;
    result.lastIndex = value.lastIndex;
  }
  if (value instanceof Map) {
    result.entries = [...value].map(([k, v]) => [
      fingerprint(k, seen),
      fingerprint(v, seen),
    ]);
  }
  if (value instanceof Set) {
    result.entries = [...value].map((v) => fingerprint(v, seen));
  }
  if (value instanceof ArrayBuffer) {
    result.bytes = [...new Uint8Array(value)];
    const resizable = value as ArrayBuffer & {
      resizable?: boolean;
      maxByteLength?: number;
    };
    result.resizable = resizable.resizable;
    result.maxByteLength = resizable.maxByteLength;
  }
  if (ArrayBuffer.isView(value)) {
    result.byteOffset = value.byteOffset;
    result.byteLength = value.byteLength;
    result.buffer = fingerprint(value.buffer, seen);
  }
  if (typeof Blob === "function" && value instanceof Blob) {
    result.size = value.size;
    result.type = value.type;
    if (typeof File === "function" && value instanceof File) {
      result.fileName = value.name;
      result.lastModified = value.lastModified;
    }
  }
  for (const Boxed of [Number, String, Boolean, BigInt] as const) {
    try {
      const primitive = (
        Boxed.prototype.valueOf as (this: unknown) => unknown
      ).call(value);
      result.boxed = fingerprint(primitive, seen);
    } catch {
      // Not this kind of boxed primitive.
    }
  }
  if (Array.isArray(value)) {
    result.length = value.length;
    result.holes = value
      .map((_entry, index) => index)
      .filter((index) => !(index in value)).length;
  }
  const keys = Object.keys(value).filter(
    // A boxed String has its indices as keys; they are its characters.
    (key) => !(result.boxed !== undefined && /^\d+$/.test(key)),
  );
  result.keys = Object.fromEntries(
    keys.map((key) => [
      key,
      fingerprint((value as Record<string, unknown>)[key], seen),
    ]),
  );
  return result;
}

function outcome(run: () => unknown): Outcome {
  try {
    return { kind: "value", fingerprint: fingerprint(run()) };
  } catch (error) {
    const named = error as { name?: string; constructor?: { name?: string } };
    return {
      kind: "throws",
      name: String(named.name),
      errorClass: named.constructor?.name ?? "?",
    };
  }
}

const sab =
  typeof SharedArrayBuffer === "function"
    ? new SharedArrayBuffer(4)
    : undefined;

/** Each entry gives a fresh input, so a case cannot see another's copy. */
const CORPUS: Record<string, () => unknown> = {
  "plain JSON": () => ({ a: [1, { b: "x" }], c: null, d: true }),
  "nested undefined": () => ({ a: undefined, b: [undefined] }),
  "-0, NaN, Infinity": () => [-0, Number.NaN, -Infinity],
  bigint: () => ({ n: BigInt(12) }),
  "trailing hole": () => {
    // eslint-disable-next-line no-sparse-arrays
    return [1, ,];
  },
  "middle hole": () => {
    // eslint-disable-next-line no-sparse-arrays
    return [1, , 3];
  },
  "array with an own non-index key": () =>
    Object.assign([1, 2], { extra: "x" }),
  "own __proto__ key (JSON.parse)": () =>
    JSON.parse('{"__proto__":{"polluted":1},"a":1}'),
  "null prototype": () => Object.assign(Object.create(null), { a: 1 }),
  "class instance": () => {
    class Point {
      x = 1;
      y = 2;
    }
    return new Point();
  },
  "own Symbol.toStringTag": () => ({ a: 1, [Symbol.toStringTag]: "Custom" }),
  "class with a toStringTag getter": () => {
    class Money {
      amount = 3;
      get [Symbol.toStringTag]() {
        return "Money";
      }
    }
    return new Money();
  },
  'toStringTag "String" (spoofed boxed string)': () => ({
    a: 1,
    [Symbol.toStringTag]: "String",
  }),
  'toStringTag "Arguments"': () => ({
    a: 1,
    [Symbol.toStringTag]: "Arguments",
  }),
  'toStringTag "Error"': () => ({ a: 1, [Symbol.toStringTag]: "Error" }),
  "Object.create(Date.prototype)": () => Object.create(Date.prototype),
  "Object.create(Map.prototype)": () => Object.create(Map.prototype),
  "Object.create(Error.prototype)": () => Object.create(Error.prototype),
  "Map with Object.prototype": () =>
    Object.setPrototypeOf(new Map([["a", 1]]), Object.prototype),
  "Set with a null prototype": () => Object.setPrototypeOf(new Set([1]), null),
  "Date with Object.prototype": () =>
    Object.setPrototypeOf(new Date(7), Object.prototype),
  "Error with Object.prototype": () =>
    Object.setPrototypeOf(new Error("x"), Object.prototype),
  "symbol keys and non-enumerable keys": () =>
    Object.defineProperty({ [Symbol("k")]: 1, a: 1 }, "hidden", {
      value: 2,
      enumerable: false,
    }),
  "shared reference": () => {
    const shared = { n: 1 };
    return { a: shared, b: shared };
  },
  cycle: () => {
    const value: Record<string, unknown> = { n: 1 };
    value.self = value;
    return value;
  },
  Date: () => new Date(86_400_000),
  "Date with an extra key": () => Object.assign(new Date(0), { extra: 1 }),
  "RegExp with lastIndex": () => {
    const pattern = /a+/gi;
    pattern.lastIndex = 2;
    return pattern;
  },
  "Map with object keys": () => {
    const key = { k: 1 };
    return new Map<unknown, unknown>([
      [key, key],
      ["s", new Set([1])],
    ]);
  },
  "Set with a cycle": () => {
    const set = new Set<unknown>();
    set.add(set);
    return set;
  },
  "Map with an extra key": () => Object.assign(new Map(), { extra: 1 }),
  "boxed Number": () => new Number(3),
  "boxed String": () => new String("ab"),
  "boxed Boolean": () => new Boolean(false),
  "boxed BigInt": () => Object(BigInt(5)),
  "boxed Symbol": () => Object(Symbol("s")),
  Error: () => new Error("boom"),
  "Error without a message": () => new Error(),
  "Error with a cause": () => new Error("boom", { cause: { reason: "x" } }),
  "Error with an undefined cause": () =>
    new Error("boom", { cause: undefined }),
  "Error with an assigned cause": () =>
    Object.assign(new Error("boom"), { cause: 5 }),
  "Error whose cause is itself": () => {
    const error = new Error("self");
    (error as { cause?: unknown }).cause = error;
    return error;
  },
  "Error with an accessor cause": () =>
    Object.defineProperty(new Error("boom"), "cause", { get: () => 1 }),
  "Error with an accessor message": () =>
    Object.defineProperty(new Error("boom"), "message", { get: () => "g" }),
  "Error with a numeric message": () =>
    Object.assign(new Error("boom"), { message: 42 }),
  "Error with a custom name": () =>
    Object.assign(new TypeError("t"), { name: "Custom" }),
  "Error with extra keys": () => Object.assign(new Error("x"), { code: 7 }),
  "Error with a set stack": () =>
    Object.assign(new Error("x"), { stack: "STACK" }),
  "RangeError subclass": () => {
    class MyError extends RangeError {}
    return new MyError("x");
  },
  AggregateError: () => new AggregateError([1], "agg"),
  DOMException: () => new DOMException("d", "AbortError"),
  "DOMException with a custom name": () => new DOMException("m", "Whatever"),
  ArrayBuffer: () => new Uint8Array([1, 2, 3]).buffer,
  "resizable ArrayBuffer": () =>
    new ArrayBuffer(4, { maxByteLength: 16 } as never),
  Uint8Array: () => new Uint8Array([1, 2]),
  "typed subarray (byteOffset 1)": () =>
    new Uint8Array([1, 2, 3, 4]).subarray(1, 3),
  "typed array subclass": () => {
    class Bytes extends Uint8Array {}
    return new Bytes([1, 2]);
  },
  BigInt64Array: () => new BigInt64Array([BigInt(1)]),
  DataView: () => new DataView(new ArrayBuffer(8), 2, 4),
  "two views on one buffer": () => {
    const buffer = new ArrayBuffer(8);
    return [new Uint8Array(buffer, 1, 2), new DataView(buffer)];
  },
  arguments: function () {
    // eslint-disable-next-line prefer-rest-params
    return (function (..._args: unknown[]) {
      // eslint-disable-next-line prefer-rest-params
      return arguments;
    })(1, 2);
  },
  "Proxy of an object": () => new Proxy({ a: 1 }, {}),
  "Proxy of an array": () => new Proxy([1], {}),
  function: () => ({ run: () => 1 }),
  symbol: () => Symbol("s"),
  WeakMap: () => new WeakMap(),
  WeakSet: () => new WeakSet(),
  WeakRef: () => new WeakRef({}),
  Promise: () => Promise.resolve(1),
  "Map iterator": () => new Map([[1, 2]]).entries(),
  generator: () =>
    (function* () {
      yield 1;
    })(),
  URL: () => new URL("https://example.com/a"),
  URLSearchParams: () => new URLSearchParams("a=1"),
  Headers: () => new Headers(),
  Blob: () => new Blob(["x"], { type: "text/plain" }),
  File: () => new File(["x"], "f.txt", { lastModified: 1 }),
  "getter that throws": () => ({
    get a(): never {
      throw new TypeError("boom");
    },
  }),
  ...(sab ? { SharedArrayBuffer: () => sab } : {}),
};

/**
 * The inputs the local copy cannot clone the native way, and why. A case
 * here must still differ: when it starts to match, remove it.
 */
/**
 * The native structuredClone is only a valid oracle where it follows the
 * current serialization rules. Node 20's clones URL, Headers and
 * DOMException into plain objects, mishandles an Error whose cause is
 * itself, and so on; there the comparison is skipped (the unit tests in
 * clone-value.test.ts still check cloneValue on every version).
 */
const NODE_MAJOR =
  typeof process !== "undefined" && process.versions?.node
    ? Number(process.versions.node.split(".")[0])
    : Infinity;
const NATIVE_IS_ORACLE = NODE_MAJOR >= 22;

/**
 * Node 22's structuredClone turns a File into a plain Blob (name and
 * lastModified are lost); browsers and Node 24 keep a File, as the HTML
 * serialization spec requires. The local copy follows the spec, so on a
 * runtime that drops File the comparison is skipped and the spec behaviour
 * is checked on its own below.
 */
const NATIVE_KEEPS_FILE =
  typeof File !== "function" ||
  structuredClone(new File(["x"], "f.txt")) instanceof File;

const KNOWN_DIVERGENCES: Record<string, string> = {
  "Proxy of an object":
    "No JavaScript-visible way tells a Proxy from its target; native V8 rejects it, the local copy reads it through its traps.",
  "Proxy of an array":
    "Same as a Proxy of an object: Array.isArray sees through the Proxy.",
  "Map with Object.prototype":
    "The plain-object fast path runs no brand check (each failed one throws, slow on Hermes), and only a brand check finds the Map slot once the prototype is Object.prototype: native V8 copies a Map, the local copy a plain object.",
  "Set with a null prototype":
    "Same as a Map with Object.prototype: the fast path cannot see the Set slot.",
  ...(NATIVE_KEEPS_FILE
    ? {}
    : {
        File: "This runtime's structuredClone returns a Blob for a File (Node 22); the local copy keeps the File, as the spec and browsers do.",
      }),
};

function withoutGlobal<T>(name: string, run: () => T): T {
  const saved = Object.getOwnPropertyDescriptor(globalThis, name);
  delete (globalThis as Record<string, unknown>)[name];
  try {
    return run();
  } finally {
    if (saved) Object.defineProperty(globalThis, name, saved);
  }
}

// Both run on the same input, so an Error has the same stack in both.
const local = (input: unknown) =>
  outcome(() => withoutGlobal("structuredClone", () => cloneValue(input)));
const native = (input: unknown) => outcome(() => structuredClone(input));

describe("cloneValue without a global structuredClone, against the native one", () => {
  it("runs the local copy only when the global is gone", () => {
    withoutGlobal("structuredClone", () => {
      expect(typeof globalThis.structuredClone).toBe("undefined");
    });
    expect(typeof globalThis.structuredClone).toBe("function");
  });

  it("uses the global structuredClone when there is one", () => {
    const saved = Object.getOwnPropertyDescriptor(
      globalThis,
      "structuredClone",
    )!;
    const calls: unknown[] = [];
    Object.defineProperty(globalThis, "structuredClone", {
      ...saved,
      value: (value: unknown) => {
        calls.push(value);
        return saved.value(value);
      },
    });
    try {
      const input = { a: 1 };
      expect(cloneValue(input)).toEqual(input);
      expect(calls).toEqual([input]);
    } finally {
      Object.defineProperty(globalThis, "structuredClone", saved);
    }
  });

  it.runIf(typeof File === "function")(
    "keeps a File a File, with its name and lastModified",
    () => {
      const copy = withoutGlobal("structuredClone", () =>
        cloneValue(new File(["x"], "f.txt", { lastModified: 1 })),
      );
      expect(copy).toBeInstanceOf(File);
      expect((copy as File).name).toBe("f.txt");
      expect((copy as File).lastModified).toBe(1);
    },
  );

  it
    .runIf(NATIVE_IS_ORACLE)
    .each(Object.keys(CORPUS).filter((name) => !(name in KNOWN_DIVERGENCES)))(
    "%s: gives what structuredClone gives",
    (name) => {
      const input = CORPUS[name]!();
      expect(local(input)).toEqual(native(input));
    },
  );

  it.runIf(NATIVE_IS_ORACLE).each(Object.keys(KNOWN_DIVERGENCES))(
    "%s: still differs (else drop it from KNOWN_DIVERGENCES)",
    (name) => {
      const input = CORPUS[name]!();
      expect(local(input)).not.toEqual(native(input));
    },
  );

  it("never returns an object of the input, except a SharedArrayBuffer", () => {
    for (const [name, make] of Object.entries(CORPUS)) {
      if (name === "SharedArrayBuffer" || name in KNOWN_DIVERGENCES) continue;
      const input = make();
      if (typeof input !== "object" || input === null) continue;
      let copy: unknown;
      try {
        copy = withoutGlobal("structuredClone", () => cloneValue(input));
      } catch {
        continue;
      }
      expect(copy, name).not.toBe(input);
    }
  });
});

describe("cloneValue on Hermes globals (no structuredClone, no DOMException)", () => {
  let saved: Record<string, PropertyDescriptor | undefined>;

  beforeEach(() => {
    saved = {};
    for (const name of ["structuredClone", "DOMException"]) {
      saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
      delete (globalThis as Record<string, unknown>)[name];
    }
  });

  afterEach(() => {
    for (const [name, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    }
  });

  it("throws an Error named DataCloneError", () => {
    expect(typeof globalThis.DOMException).toBe("undefined");
    let thrown: unknown;
    try {
      cloneValue({ run: () => 1 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe("DataCloneError");
    expect((thrown as Error).message).toMatch(/could not be cloned/);
  });

  it("copies an Error with its cause", () => {
    const copy = cloneValue(new TypeError("t", { cause: { n: 1 } }));
    expect(copy).toBeInstanceOf(TypeError);
    expect(copy.message).toBe("t");
    expect(copy.cause).toEqual({ n: 1 });
    expect(Object.getOwnPropertyDescriptor(copy, "cause")?.enumerable).toBe(
      false,
    );
  });
});
