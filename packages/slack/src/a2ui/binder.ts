/**
 * A2UI path-binding resolver.
 *
 * Component instances in the v0.9 protocol can have any prop value
 * replaced with `{ path: "..." }`. The bridge resolves these against
 * the surface's `dataModel` (and, when iterating template-children, a
 * `basePath` that scopes relative paths). The catalog's renderer
 * always sees resolved values.
 *
 * Path syntax:
 *
 *   - Leading `/` → absolute (from dataModel root). e.g. `/flights`.
 *   - No leading `/` → relative to `basePath`. e.g. inside
 *     `Row { children: { componentId, path: "/flights" } }`, the i-th
 *     child of FlightCard has `basePath = "flights[0]"` and a child
 *     binding `{ path: "airline" }` resolves to
 *     `dataModel.flights[0].airline`.
 *   - Segments are dot-separated; arrays are indexed with `[N]` or by
 *     bare numeric segments (`flights.0.airline` == `flights[0].airline`).
 *
 * Recursive prop walking: `resolveProps(value, ...)` clones the input
 * and replaces any `{ path }` it finds, recursing into nested objects
 * and arrays. So an `action` prop whose `context` has nested bindings
 * is resolved transparently.
 */

const PATH_KEY = "path";

/** True if `v` looks like a v0.9 path binding (`{ path: string }`). */
export function isBinding(v: unknown): v is { path: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    PATH_KEY in v &&
    typeof (v as { path: unknown }).path === "string"
  );
}

/**
 * Read a value from `dataModel` at the given v0.9 path. `basePath` is
 * prepended for relative paths (those without a leading `/`).
 *
 * Returns `undefined` when the path doesn't resolve. (We don't throw —
 * a missing field should render as empty, not crash the bot.)
 */
export function readPath(
  dataModel: Record<string, unknown>,
  path: string,
  basePath?: string,
): unknown {
  const absolute = path.startsWith("/");
  const cleaned = absolute ? path.slice(1) : path;
  const joined =
    absolute || !basePath || basePath.length === 0
      ? cleaned
      : `${basePath}.${cleaned}`;
  return walk(dataModel as unknown, joined);
}

function walk(root: unknown, joinedPath: string): unknown {
  if (!joinedPath) return root;
  const segments = tokenize(joinedPath);
  let cursor: unknown = root;
  for (const seg of segments) {
    if (cursor == null) return undefined;
    if (Array.isArray(cursor)) {
      const idx = Number(seg);
      if (!Number.isFinite(idx)) return undefined;
      cursor = cursor[idx];
      continue;
    }
    if (typeof cursor === "object") {
      cursor = (cursor as Record<string, unknown>)[seg];
      continue;
    }
    return undefined;
  }
  return cursor;
}

/**
 * Tokenize a v0.9 path. Accepts dot notation, bracket notation, and a
 * leading-slash on absolute paths.
 *
 *   "flights[0].airline"   → ["flights","0","airline"]
 *   "flights.0.airline"    → ["flights","0","airline"]
 *   "/flights"             → ["flights"]    (caller strips leading slash)
 */
function tokenize(path: string): string[] {
  return path
    .replace(/\[(\w+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
}

/**
 * Recursively resolve `{ path: ... }` bindings inside arbitrary prop
 * values (objects, arrays, scalars). Used by the renderer to produce
 * fully-resolved props for each component instance.
 *
 * Returns a fresh value tree — never mutates the input.
 *
 * Special-case: a `children` prop with the shape
 * `{ componentId: string, path: string }` is a STRUCTURAL binding (the
 * template-children pattern). We leave it intact for the tree walker
 * to expand — `resolveProps` only handles VALUE bindings.
 */
export function resolveProps(
  props: Record<string, unknown>,
  dataModel: Record<string, unknown>,
  basePath: string | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = resolveValue(v, dataModel, basePath, k);
  }
  return out;
}

function resolveValue(
  v: unknown,
  dataModel: Record<string, unknown>,
  basePath: string | undefined,
  parentKey?: string,
): unknown {
  if (v == null) return v;
  if (Array.isArray(v)) {
    return v.map((item) => resolveValue(item, dataModel, basePath, parentKey));
  }
  if (typeof v === "object") {
    // Leave structural-children bindings to the tree walker.
    if (
      parentKey === "children" &&
      "componentId" in (v as Record<string, unknown>) &&
      "path" in (v as Record<string, unknown>)
    ) {
      return v;
    }
    if (isBinding(v)) {
      return readPath(dataModel, v.path, basePath);
    }
    const out: Record<string, unknown> = {};
    for (const [k, inner] of Object.entries(v as Record<string, unknown>)) {
      out[k] = resolveValue(inner, dataModel, basePath, k);
    }
    return out;
  }
  return v;
}
