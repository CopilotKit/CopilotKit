import catalog from "@/a2ui/export/catalog.json";
import { isComponentName } from "./catalog-index";

/**
 * The Gen UI 2.0 standard components (`standardUI`), for server code.
 *
 * `standardUI` lives in a "use client" module, so a server component cannot
 * read it. `pnpm catalog:export` (run before `dev` and `build`) writes it,
 * with the playground's own components, into the catalog document served at
 * /catalog.json, with the same names, order and descriptions. Client code
 * reads `standardUI.manifestComponents` itself (standard-props.tsx).
 *
 * `createGenerativeUI` throws when a name is defined twice, so a standard
 * component and one of the playground's cannot share a name. If they ever
 * did, the playground's component would keep /components/<Name> and the
 * standard one would drop out of this list.
 */
const components = catalog.components as Record<
  string,
  { description?: string }
>;

export const STANDARD_NAMES: string[] = Object.keys(components).filter(
  (n) => !isComponentName(n),
);

const STANDARD = new Set(STANDARD_NAMES);

export function isStandardName(n: string): boolean {
  return STANDARD.has(n);
}

export function standardDescription(n: string): string {
  return components[n]?.description ?? "";
}

/** CopilotKit's reference page for the standard components. */
export const STANDARD_DOCS_URL =
  "https://docs.copilotkit.ai/generative-ui/components/standard-catalog";
