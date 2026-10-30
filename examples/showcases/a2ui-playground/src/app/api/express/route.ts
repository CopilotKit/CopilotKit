// A surface's A2UI v1.0 operations, decompiled to A2UI Express by Google's `@a2ui/agent` SDK
// (`toExpress` in `src/agent/express.ts`). The JSON tab uses it for surfaces no model wrote in Express:
// templates, JSON runs and hand edits.
//   POST /api/express { ops: [...] } -> { express, renamed } | { error }
import {
  collectChildRefs,
  mapAtChildRef,
  type GenerativeUIJSONSchema,
} from "@copilotkit/shared";
import inference from "@/a2ui/export/inference-catalog.json";
import { toExpress } from "@/agent/express";
import { identifierRenames } from "@/lib/express-lines";
import {
  MAX_BODY,
  MAX_EXPRESS_COMPONENTS,
  RATE_LIMITS,
  rateLimiter,
  readBody,
  tooLarge,
} from "@/lib/limits";

export const runtime = "nodejs";

const limit = rateLimiter(RATE_LIMITS.express);

type Op = Record<string, unknown>;
type Components = { components?: Array<{ id?: unknown }> };

const schemas = inference.components as unknown as Record<
  string,
  GenerativeUIJSONSchema
>;

const lists = (op: Op) =>
  [op.createSurface, op.updateComponents]
    .map((x) => (x as Components | undefined)?.components)
    .filter(Array.isArray);
const componentCount = (ops: Op[]) =>
  ops.reduce((n, op) => n + lists(op).reduce((m, l) => m + l.length, 0), 0);

/**
 * Express names each component by its id, so an id must be an identifier.
 * JSON allows any string ("f-nonstop" in the flight template): those ids, and
 * every reference to them, get an identifier instead (`f_nonstop`, see `identifierRenames`).
 * Only ids and the component references the catalog declares are renamed, never
 * a display value that happens to equal an id.
 */
function withIdentifierIds(ops: Op[]): { ops: Op[]; renamed: number } {
  const ids = ops
    .flatMap((op) =>
      lists(op)
        .flat()
        .map((c) => c?.id),
    )
    .filter((id): id is string => typeof id === "string");
  const rename = identifierRenames(ids);
  if (!rename.size) return { ops, renamed: 0 };
  const name = (v: unknown) =>
    typeof v === "string" ? (rename.get(v) ?? v) : v;
  // A reference is an id, a list of ids, or a template's `componentId`.
  const renameRef = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(name)
      : v && typeof v === "object" && "componentId" in v
        ? { ...v, componentId: name(v.componentId) }
        : name(v);
  const renameNode = (c: unknown): unknown => {
    if (!c || typeof c !== "object") return c;
    const node = c as Record<string, unknown>;
    const type = node.component;
    const refs =
      typeof type === "string" && Object.hasOwn(schemas, type)
        ? collectChildRefs(schemas[type])
        : [];
    return refs.reduce<unknown>(
      (out, ref) => mapAtChildRef(out, ref.path, renameRef),
      { ...node, id: name(node.id) },
    );
  };
  const fix = (x: unknown) =>
    x && typeof x === "object" && Array.isArray((x as Components).components)
      ? { ...x, components: (x as Components).components!.map(renameNode) }
      : x;
  return {
    ops: ops.map((op) => ({
      ...op,
      ...(op.createSurface ? { createSurface: fix(op.createSurface) } : {}),
      ...(op.updateComponents
        ? { updateComponents: fix(op.updateComponents) }
        : {}),
    })),
    renamed: rename.size,
  };
}

export async function POST(request: Request) {
  const limited = limit(request);
  if (limited) return limited;
  const body = await readBody(request, MAX_BODY.express);
  if (body === null)
    return tooLarge("The surface is too large to decompile here.");
  let ops: unknown;
  try {
    ops = (JSON.parse(body) as { ops?: unknown }).ops;
  } catch {
    return Response.json(
      { error: "Expected JSON: { ops: [...] }" },
      { status: 400 },
    );
  }
  if (
    !Array.isArray(ops) ||
    !ops.length ||
    !ops.every((op) => op && typeof op === "object")
  ) {
    return Response.json(
      { error: "Expected a non-empty list of A2UI operations in ops." },
      { status: 400 },
    );
  }
  if (componentCount(ops as Op[]) > MAX_EXPRESS_COMPONENTS)
    return tooLarge(
      `The surface has more than ${MAX_EXPRESS_COMPONENTS} components to decompile here.`,
    );
  try {
    const fixed = withIdentifierIds(ops as Op[]);
    return Response.json({
      express: toExpress(
        fixed.ops as unknown as Parameters<typeof toExpress>[0],
      ),
      renamed: fixed.renamed,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
