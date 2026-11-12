import { useContext, useMemo } from "react";
import { accessibilityAttributes } from "@copilotkit/core/generative-ui";
import type { GenerativeUIAriaAttributes } from "@copilotkit/core/generative-ui";
import { GenerativeUINodeContext } from "./runtime-context";

// The accessibility helpers are framework-free and live in
// `@copilotkit/core/generative-ui`. The standard components import them
// from here.
export {
  accessibilityAttributes,
  controlAria,
  namedRole,
  readAccessibility,
  wrapperAria,
} from "@copilotkit/core/generative-ui";
export type {
  GenerativeUIAccessibility,
  GenerativeUIAriaAttributes,
} from "@copilotkit/core/generative-ui";

/**
 * Experimental. The ARIA attributes of the `accessibility` that the model
 * gave the component being rendered, to spread on its root element. The
 * standard components do this; a custom component does it itself:
 *
 * @example
 * ```tsx
 * function Panel({ children }: { children?: ReactNode }) {
 *   const aria = useGenerativeUIAccessibility();
 *   return <section {...aria}>{children}</section>;
 * }
 * ```
 *
 * Outside of generated UI it gives `{}`.
 */
export function useGenerativeUIAccessibility(): GenerativeUIAriaAttributes {
  const node = useContext(GenerativeUINodeContext);
  const accessibility = node?.accessibility;
  return useMemo(() => accessibilityAttributes(accessibility), [accessibility]);
}
