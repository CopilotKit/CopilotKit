import type { Edit } from "codemod:ast-grep";
import {
  argumentNodes,
  destructuredMembers,
  destructuringDeclaration,
  indentOf,
  keyOf,
  uniqueNamer,
  valueOf,
} from "./ast-helpers.ts";
import type { Node } from "./ast-helpers.ts";
import { migrateV1Calls } from "./v1-calls.ts";

/** What each v1 return value becomes, given the agent variable. */
const MEMBERS = new Set([
  "state",
  "setState",
  "running",
  "threadId",
  "name",
  "run",
  "start",
  "stop",
]);

/**
 * Rewrites `const { state, setState, ... } = useCoAgent<T>({ name, initialState })`
 * to `useAgent({ agentId: name })` and keeps each destructured value, with
 * v1's behavior:
 *
 * - `state` is the agent's state, or `initialState` while the agent has none,
 *   and `initialState` is set on the agent before it runs;
 * - `setState` merges an object into the state, or applies an updater;
 * - `running`, `threadId` and `name` read the agent;
 * - `run` and `start` run the agent, `stop` stops it.
 *
 * A call whose result is not destructured, that manages the state outside
 * (`state` / `setState` options), forwards `config` or `configurable`, or
 * reads `nodeName`, keeps the TODO.
 */
export function migrateCoAgents(rootNode: Node): string | null {
  const unique = uniqueNamer(rootNode);

  return migrateV1Calls(rootNode, "useCoAgent", (call, { source }) => {
    const found = destructuringDeclaration(call);
    if (!found) return null;
    const { declaration, pattern } = found;
    const members = destructuredMembers(pattern);
    if (!members) return null;
    if ([...members.keys()].some((key) => !MEMBERS.has(key))) return null;

    const args = argumentNodes(call);
    const [config] = args;
    if (config?.kind() !== "object" || args.length !== 1) return null;
    const entries = new Map<string, Node>();
    for (const entry of config.children()) {
      if (["{", "}", ",", "comment"].includes(entry.kind())) continue;
      const key = keyOf(entry);
      if (key !== "name" && key !== "initialState") return null;
      entries.set(key, entry);
    }
    const name = valueOf(entries.get("name"));
    if (!name) return null;
    const initial = valueOf(entries.get("initialState"));

    // The type argument, `T` of `useCoAgent<T>`.
    const typeArgs = call.field("type_arguments");
    const type = typeArgs ? typeArgs.text().slice(1, -1).trim() : undefined;
    const stateType = type ?? "any";

    // `"sample_agent"` gives `sampleAgent`, `"weather"` gives `weatherAgent`.
    const camel =
      name.kind() === "string" ? camelCase(name.text().slice(1, -1)) : "";
    const base = !camel
      ? "agent"
      : /agent$/i.test(camel)
        ? camel
        : `${camel}Agent`;
    const agent = unique(/^[A-Za-z_$][\w$]*$/.test(base) ? base : "agent");
    // `{ agent }` when the variable is named `agent`.
    const agentProp = agent === "agent" ? "agent" : `agent: ${agent}`;
    const indent = indentOf(declaration, source);
    const keyword = declaration.text().startsWith("let") ? "let" : "const";
    const binding = agent === "agent" ? "{ agent }" : `{ agent: ${agent} }`;
    const lines: string[] = [
      `${keyword} ${binding} = useAgent({ agentId: ${name.text()} });`,
    ];
    const imports: Record<string, string[]> = {};
    const hooks = ["useAgent"];

    let initialRef: string | undefined;
    if (initial) {
      if (
        [
          "identifier",
          "shorthand_property_identifier",
          "member_expression",
        ].includes(initial.kind())
      ) {
        initialRef = initial.text();
      } else {
        initialRef = unique(`${agent}InitialState`);
        lines.push(`const ${initialRef} = ${initial.text()};`);
      }
      // v1 set the initial state on the agent when it ran with none.
      lines.push(
        `useEffect(() => {`,
        `  if (Object.keys(${agent}.state ?? {}).length === 0) ${agent}.setState(${initialRef});`,
        `}, [${agent}]);`,
      );
      imports.react = ["useEffect"];
    }

    const hasState = `Object.keys(${agent}.state ?? {}).length > 0`;
    for (const [member, local] of members) {
      switch (member) {
        case "state":
          lines.push(
            initialRef
              ? `const ${local} = (${hasState} ? ${agent}.state : ${initialRef}) as ${stateType};`
              : `const ${local} = ${agent}.state as ${stateType};`,
          );
          break;
        case "setState":
          lines.push(
            `const ${local} = (next: ${stateType} | ((prev: ${stateType} | undefined) => ${stateType})) =>`,
            `  ${agent}.setState(typeof next === "function" ? (next as (prev: ${stateType} | undefined) => ${stateType})(${agent}.state) : { ...${agent}.state, ...next });`,
          );
          break;
        case "running":
          lines.push(`const ${local} = ${agent}.isRunning;`);
          break;
        case "threadId":
          lines.push(`const ${local} = ${agent}.threadId;`);
          break;
        case "name":
          lines.push(`const ${local} = ${agent}.agentId ?? ${name.text()};`);
          break;
        case "run":
        case "start":
        case "stop":
          break;
      }
    }
    const runs = ["run", "start"].filter((member) => members.has(member));
    if (runs.length > 0 || members.has("stop")) {
      const copilotkit = unique("copilotkit");
      lines.push(
        copilotkit === "copilotkit"
          ? `const { copilotkit } = useCopilotKit();`
          : `const { copilotkit: ${copilotkit} } = useCopilotKit();`,
      );
      hooks.push("useCopilotKit");
      for (const member of runs) {
        lines.push(
          `const ${members.get(member)} = (parameters?: { forwardedProps?: Record<string, unknown>; runId?: string }) =>`,
          `  ${copilotkit}.runAgent({ ${agentProp}, ...parameters });`,
        );
      }
      if (members.has("stop")) {
        lines.push(
          `const ${members.get("stop")} = () => ${copilotkit}.stopAgent({ ${agentProp} });`,
        );
      }
    }

    const edit: Edit = declaration.replace(lines.join(`\n${indent}`));
    return { edits: [edit], hooks, imports };
  });
}

/** `my_agent` and `my-agent` give `myAgent`. */
function camelCase(text: string) {
  return text
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) =>
      next ? next.toUpperCase() : "",
    )
    .replace(/^[A-Z]/, (first) => first.toLowerCase());
}
