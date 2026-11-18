import type { Edit } from "codemod:ast-grep";
import {
  argumentNodes,
  keyOf,
  removeEntry,
  stringLiteral,
  valueOf,
} from "./ast-helpers.ts";
import type { Node } from "./ast-helpers.ts";
import { migrateV1Calls } from "./v1-calls.ts";
import type { CallContext } from "./v1-calls.ts";

const READABLE_KEYS = new Set([
  "description",
  "value",
  "convert",
  "available",
  "parentId",
  "categories",
]);

/** What differs between the React and the Vue `useCopilotReadable`. */
interface ReadableDialect {
  /** The package the v1 hook came from. `useAgentContext` comes from it too. */
  source: string;
  /**
   * Whether `useAgentContext` keeps the context current without the v1 deps.
   * React's does: it runs on every render.
   */
  dropsDeps: boolean;
}

/**
 * Rewrites `useCopilotReadable({ description, value }, deps?)` from
 * `@copilotkit/react-core` to `useAgentContext({ description, value })`, as
 * v1 last behaved:
 *
 * - `parentId` and `categories` are dropped: v1 already ignored them;
 * - `available: "enabled"` is dropped (the default);
 * - `convert(description, value)` is applied to the value;
 * - the dependency list is dropped: the context is registered again
 *   whenever the value changes.
 *
 * A call whose returned id is used, `available: "disabled"`, or a config
 * that is not an object literal keeps the TODO.
 */
export function migrateReadables(rootNode: Node) {
  return migrateReadableCalls(rootNode, {
    source: "@copilotkit/react-core",
    dropsDeps: true,
  });
}

/**
 * Rewrites `useCopilotReadable` from `@copilotkit/vue` the same way, except
 * for a call with deps, which keeps the TODO. The Vue `useAgentContext` takes
 * no deps: it follows `value` only when that is a ref, a getter or a reactive
 * object, and the codemod cannot tell what the deps kept current.
 */
export function migrateVueReadables(rootNode: Node) {
  return migrateReadableCalls(rootNode, {
    source: "@copilotkit/vue",
    dropsDeps: false,
  });
}

function migrateReadableCalls(rootNode: Node, dialect: ReadableDialect) {
  const toAgentContext = (call: Node, { source }: CallContext) => {
    if (call.parent()?.kind() !== "expression_statement") return null;
    const args = argumentNodes(call);
    const [config, deps] = args;
    if (config?.kind() !== "object" || args.length > 2) return null;
    if (deps && !dialect.dropsDeps) return null;
    const entries = new Map<string, Node>();
    for (const entry of config.children()) {
      if (["{", "}", ",", "comment"].includes(entry.kind())) continue;
      const key = keyOf(entry);
      if (key === undefined || !READABLE_KEYS.has(key) || entries.has(key)) {
        return null;
      }
      entries.set(key, entry);
    }
    if (!entries.has("description") || !entries.has("value")) return null;

    const edits: Edit[] = [];
    const available = valueOf(entries.get("available"));
    if (available !== undefined) {
      if (!available || stringLiteral(available) !== "enabled") return null;
    }
    for (const key of ["available", "parentId", "categories"]) {
      const entry = entries.get(key);
      if (entry) edits.push(removeEntry(entry, source));
    }

    const convertEntry = entries.get("convert");
    if (convertEntry) {
      const convert = valueOf(convertEntry);
      const description = valueOf(entries.get("description"));
      const value = valueOf(entries.get("value"));
      if (!convert || !description || !value) return null;
      // An inline function gets v1's convert type, which types its params.
      const fn = ["identifier", "member_expression"].includes(convert.kind())
        ? convert.text()
        : `((${convert.text()}) as (description: string, value: any) => string)`;
      const valueEntry = entries.get("value")!;
      const text = `${fn}(${description.text()}, ${value.text()})`;
      edits.push(
        valueEntry.kind() === "pair"
          ? value.replace(text)
          : valueEntry.replace(`value: ${text}`),
      );
      edits.push(removeEntry(convertEntry, source));
    }

    if (deps) {
      edits.push({
        startPos: config.range().end.index,
        endPos: deps.range().end.index,
        insertedText: "",
      });
    }
    const callee = call.field("function");
    if (!callee) return null;
    edits.push(callee.replace("useAgentContext"));
    return { edits, hooks: ["useAgentContext"] };
  };
  return migrateV1Calls(rootNode, "useCopilotReadable", toAgentContext, {
    source: dialect.source,
  });
}
