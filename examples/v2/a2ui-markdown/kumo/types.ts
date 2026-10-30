import type { ComponentType } from "react";
import { standardUI } from "@copilotkit/react-core/v2/generative-ui";
import type {
  GenerativeUIComponentName,
  GenerativeUIComponentProps,
} from "@copilotkit/react-core/v2/generative-ui";

/** The name of one of the 69 standard components. */
export type StandardComponentName = GenerativeUIComponentName<
  typeof standardUI
>;

/** The props the engine gives a standard component, and so its override. */
export type StandardProps<Name extends StandardComponentName> =
  GenerativeUIComponentProps<typeof standardUI, Name>;

/**
 * The standard React component of `name`. An override renders it for the
 * prop values that Kumo cannot show.
 */
export function standardComponent<Name extends StandardComponentName>(
  name: Name,
): ComponentType<StandardProps<Name>> {
  const definition = standardUI.components.get(name);
  if (!definition) throw new Error(`No standard component "${name}"`);
  return definition.component as ComponentType<StandardProps<Name>>;
}
