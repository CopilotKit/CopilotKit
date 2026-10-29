import type { GenerativeUIComponentDeclaration } from "./components";
import { compositeDeclarations } from "./composites";
import { dataDeclarations } from "./data";
import { feedbackDeclarations } from "./feedback";
import { inputDeclarations } from "./inputs";
import { layoutDeclarations } from "./layout";
import { mediaDeclarations } from "./media";
import {
  standardParameterOrder,
  STANDARD_ARGUMENT_PREFIXES,
} from "./parameter-order";
import { textDeclarations } from "./text";

/** Every standard component, without its framework component. */
export const standardDeclarations = {
  ...layoutDeclarations,
  ...textDeclarations,
  ...inputDeclarations,
  ...feedbackDeclarations,
  ...dataDeclarations,
  ...mediaDeclarations,
  ...compositeDeclarations,
};

/** The name of a standard component. */
export type StandardComponentName = keyof typeof standardDeclarations;

// Every standard component needs an intentional positional calling convention.
STANDARD_ARGUMENT_PREFIXES satisfies Record<
  StandardComponentName,
  readonly string[]
>;

/**
 * The standard components of a framework, each with its positional
 * parameter order. Give the result to `createGenerativeUI`.
 */
export function withStandardParameterOrder<
  Definitions extends Record<
    StandardComponentName,
    GenerativeUIComponentDeclaration
  >,
>(definitions: Definitions) {
  const ordered: Record<string, unknown> = {};
  for (const name of Object.keys(definitions) as StandardComponentName[]) {
    const definition = definitions[name];
    ordered[name] = {
      ...definition,
      parameterOrder: standardParameterOrder(name, definition),
    };
  }
  return ordered as {
    [Name in keyof Definitions]: Definitions[Name] & {
      parameterOrder: string[];
    };
  };
}
