import { z } from "zod";
import { CATEGORIES } from "./data/types";
import type { Category } from "./data/types";

/**
 * THE CATEGORY ARGUMENT — the one model-authored value in this skin that has to
 * name a member of a CLOSED set, and the two halves of getting that right.
 *
 * Same shape as `order-queue-levers.ts` and for the same reason: an untrusted
 * argument arrives, and something pure has to turn it into a value the view can
 * be drawn from. Both halves are needed, and neither substitutes for the other.
 *
 *  1. `categoryParameter` ADVERTISES the vocabulary. `z.enum(CATEGORIES)`
 *     serializes to a JSON-Schema `enum` (zod-to-json-schema, via
 *     `schemaToJsonSchema` in `@copilotkit/shared`), so the accepted values ride
 *     along with the tool definition instead of being something the model has to
 *     infer from the ledger readable — and the description repeats them, so they
 *     are there for a model reading prose too. This is the half that PREVENTS a
 *     near-miss.
 *
 *  2. `resolveCategoryScope` ENFORCES it at the point of use, because in a
 *     render NOTHING ELSE DOES. A `useComponent` render is handed
 *     `partialJSONParse(toolCall.function.arguments)` verbatim
 *     (`use-render-tool-call.tsx` in `@copilotkit/react-core`); the schema it
 *     registered is only ever serialized as documentation. There is no channel
 *     to report the bad value back on either: a render-only tool has no handler,
 *     and `executeSpecificTool` (core's `run-handler.ts`) then posts an EMPTY
 *     tool result. So "Shoes" for "Footwear" used to filter the products to
 *     nothing, leave the floors unfiltered by a fallback, and draw a full
 *     five-rail ladder with zero dots on it — Bellwether's signature visual,
 *     rendering a guess as an answer.
 *
 * The `arriving` state is not decoration. Arguments STREAM, and the render runs
 * throughout, so every categorised call passes through `"F"`, `"Fo"`, `"Foot"`
 * on its way to `"Footwear"`. Refusing those would flash a red card in front of
 * the room on every single ladder the demo draws. A value that is still a prefix
 * of a real category is therefore treated as "not arrived yet" and draws the
 * whole range, exactly as an omitted category does — the same rule
 * `normalizeQueueLevers` follows when a lever has not landed.
 */

/**
 * A single category, as the model must spell it. Shared with
 * `sandbox-functions.ts` so the OGUI sandbox and the chat's gen-UI advertise ONE
 * vocabulary rather than two that can drift.
 */
export const categoryParameter = z
  .enum(CATEGORIES)
  .describe(
    `Exact category name, spelling and case included. One of: ${CATEGORIES.join(", ")}.`,
  );

/** Every category, as the list a refusal has to end with. */
export const CATEGORY_VOCABULARY = CATEGORIES.join(", ");

export type CategoryScope =
  /** No category asked for: the whole range. */
  | { kind: "all" }
  /** Still a prefix of a real category — the arguments are mid-stream. */
  | { kind: "arriving"; value: string }
  /** One real category, canonically spelled. */
  | { kind: "one"; category: Category }
  /** Off-vocabulary. Nothing may be drawn from this. */
  | { kind: "unknown"; value: string };

/**
 * A short, safe rendering of whatever arrived. `String(value)` is not used: it
 * turns `{}` into the deceptively word-like `"[object Object]"`, and this string
 * is quoted back to the user inside the refusal.
 */
function label(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? typeof value;
}

/**
 * The category as the ladder may actually be drawn from.
 *
 * Case and surrounding space are FOLDED rather than refused: "footwear" is
 * unambiguously Footwear, and blanking the signature visual over a lowercase
 * letter would be the same failure this function exists to prevent. Anything
 * that is not a category and not a prefix of one is `unknown`, and the caller
 * must say so instead of drawing.
 */
export function resolveCategoryScope(value: unknown): CategoryScope {
  if (value === undefined || value === null) return { kind: "all" };
  if (typeof value !== "string") {
    return { kind: "unknown", value: label(value) };
  }

  const trimmed = value.trim();
  if (trimmed === "") return { kind: "all" };

  const folded = trimmed.toLowerCase();
  const exact = CATEGORIES.find(
    (category) => category.toLowerCase() === folded,
  );
  if (exact) return { kind: "one", category: exact };

  const prefixOfOne = CATEGORIES.some((category) =>
    category.toLowerCase().startsWith(folded),
  );
  if (prefixOfOne) return { kind: "arriving", value: trimmed };
  return { kind: "unknown", value: trimmed };
}
