"use client";

import type { ReactNode } from "react";
// The app root `_shared` links to showcase/integrations/_shared, so the
// integrations' own websites and this app use one copy of the selector.
import { A2UIFormat } from "../../../../../_shared/ts/a2ui-format";
import type { A2UIInferenceFormat } from "../../../../../_shared/ts/a2ui-format";

/**
 * The A2UI format selector that a demo page shows above its chat:
 * - `"none"`: no selector. The agent uses its own format.
 * - `"inference"`: the agent generates the surface in the format the user
 *   picks, A2UI Express or Direct JSON.
 * - `"template"`: the agent fills an authored template, and the user picks
 *   the format that the template is compiled from.
 */
export type A2UIFormatSelector = "none" | "inference" | "template";

/** The CopilotKit `properties` that tell the agent which A2UI format to use. */
export interface A2UIFormatProperties {
  a2ui: { inferenceFormat: A2UIInferenceFormat };
}

/**
 * A full-height frame for an A2UI demo page, with an optional format selector
 * on top. A format change starts a fresh provider and conversation.
 *
 * @param selector - The selector to show, or `"none"`.
 * @param children - Renders the CopilotKit provider. It receives the
 *   `properties` for `<CopilotKit>`, or `undefined` when there is no selector.
 *
 * @example
 * <A2UIFormatFrame selector={config.formatSelector}>
 *   {(properties) => (
 *     <CopilotKit properties={properties} runtimeUrl={runtimeUrl}>...</CopilotKit>
 *   )}
 * </A2UIFormatFrame>
 */
export function A2UIFormatFrame({
  selector,
  children,
}: {
  selector: A2UIFormatSelector;
  children: (properties: A2UIFormatProperties | undefined) => ReactNode;
}) {
  if (selector === "none") {
    return <div className="h-screen w-full">{children(undefined)}</div>;
  }
  return (
    <A2UIFormat template={selector === "template"}>
      {(inferenceFormat) => children({ a2ui: { inferenceFormat } })}
    </A2UIFormat>
  );
}
