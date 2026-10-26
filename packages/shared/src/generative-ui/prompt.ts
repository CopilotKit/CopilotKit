import { generativeUIGuideFeatures } from "../a2ui-prompts";
import { functionCallers } from "./basic-functions";
import {
  defaultGenerativeUIPromptSpec,
  generativeUIPromptFeatures,
  selectPromptItems,
} from "./prompt-spec";
import type { GenerativeUIPromptSpec } from "./prompt-spec";
import { renderGenerativeUIComponentList } from "./schema-render";
import { GENERATIVE_UI_AGENT_FUNCTION_CALLS } from "./types";
import type { GenerativeUIManifest } from "./types";

export const GENERATIVE_UI_CONTEXT_DESCRIPTION =
  "Generative UI guide: available components, functions, targets, and how to call render_ui.";

/** Most characters of the user values of one surface in the guide. */
const MAX_USER_VALUES_LENGTH = 500;

/** Cuts long text and marks the cut with "...". */
function shorten(text: string) {
  return text.length > MAX_USER_VALUES_LENGTH
    ? `${text.slice(0, MAX_USER_VALUES_LENGTH)}...`
    : text;
}

/**
 * The guide that the runtime adds as a context entry to a tool-transport run:
 * the `render_ui` rules, the targets, components, functions, and surfaces of
 * the manifest. It is in shared so that the inspector shows the same text.
 */
export function buildGenerativeUIPrompt(
  manifest: GenerativeUIManifest,
  spec: GenerativeUIPromptSpec = defaultGenerativeUIPromptSpec(),
) {
  const targets = manifest.targets
    .map((t) => {
      const place =
        t.kind === "chat"
          ? "inside the chat transcript"
          : "a named area of the app";
      const limit = t.components
        ? `; only ${t.components.join(", ") || "no components"}`
        : "";
      const description = t.description ? `: ${t.description}` : "";
      return `- "${t.id}" (${place}${limit})${description}`;
    })
    .join("\n");
  const components = renderGenerativeUIComponentList(
    manifest.components,
    spec.schema.tool,
  );
  const functions = Object.entries(manifest.functions)
    .map(([name, f]) => {
      // A built-in function carries its short signature in the description
      // of its parameters; an app function has a JSON Schema.
      const signature = f.parameters.description;
      const args =
        typeof signature === "string" &&
        signature.startsWith("{") &&
        Object.keys(f.parameters).length === 2
          ? signature
          : JSON.stringify(f.parameters);
      // A function is for the UI unless marked: the agent calls only what
      // the mark allows.
      const callers = functionCallers(f);
      const who =
        callers.agent && GENERATIVE_UI_AGENT_FUNCTION_CALLS
          ? callers.renderer
            ? " (UI or agent)"
            : " (agent only)"
          : "";
      return `- **${name}**${who}${f.description ? `: ${f.description}` : ""}\n  args: ${args}`;
    })
    .join("\n");
  const surfaces = Object.entries(manifest.surfaces)
    .map(([id, s]) => {
      const lines = [`- "${id}" (target "${s.target}")`];
      if (s.dataModel) {
        lines.push(`  user values: ${shorten(JSON.stringify(s.dataModel))}`);
      }
      for (const rejection of s.rejected ?? []) {
        lines.push(`  rejected: ${rejection}`);
      }
      return lines.join("\n");
    })
    .join("\n");
  const hasSurfaceNotes = Object.values(manifest.surfaces).some(
    (s) => s.dataModel !== undefined || (s.rejected?.length ?? 0) > 0,
  );
  const surfaceNotes = hasSurfaceNotes
    ? "User values are what the user entered, by path. Your writes to those paths are ignored. Rejected operations were dropped: send them again with the problem fixed.\n"
    : "";

  // Rules for functions, events, and templates go only to runs whose manifest
  // has them, so the guide stays small.
  const features = generativeUIPromptFeatures(
    generativeUIGuideFeatures(manifest),
  );
  const { intro, whenToShow } = spec.tool;
  const operations = selectPromptItems(spec.tool.operations ?? [], features);
  const rules = selectPromptItems(spec.tool.rules, features);
  const when = whenToShow ? `${whenToShow}\n\n` : "";

  return [
    `## Generative UI
${intro}

${when}Every operation has "version":"v1.0" and exactly one of:
${operations.map((op) => `- ${op}`).join("\n")}

Rules:
${rules.map((rule, index) => `${index + 1}. ${rule}`).join("\n")}`,
    `### Targets\n${targets || "- none"}`,
    `### Components\n${components || "- none"}`,
    `### Functions\n${functions || "- none"}`,
    `### Existing surfaces\n${surfaceNotes}${surfaces || "- none"}`,
  ].join("\n\n");
}
