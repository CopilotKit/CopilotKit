import { getDemo } from "@/lib/registry";

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Module-not-found codes: webpack and Node CommonJS use the first, Node ESM
// and Vite use the second.
const MODULE_NOT_FOUND_CODES = new Set([
  "MODULE_NOT_FOUND",
  "ERR_MODULE_NOT_FOUND",
]);

// True when `error` reports that `modulePath` itself does not exist. A module
// that exists but imports something missing names that other module instead,
// so its error is not swallowed.
function isMissingModule(error: unknown, modulePath: string) {
  if (!(error instanceof Error) || !("code" in error)) return false;
  const isNotFound =
    typeof error.code === "string" && MODULE_NOT_FOUND_CODES.has(error.code);
  return isNotFound && error.message.includes(modulePath);
}

// The file's own default export. Playwright runs TypeScript as CommonJS, and
// Node's import() of a CommonJS module returns the whole `exports` object as
// `default`, so there the file's default export is one level down. Webpack,
// Turbopack and Vitest return it directly.
function fileDefaultExport(loaded: { default?: unknown }) {
  const value = loaded.default;
  const isCommonJsExports =
    typeof value === "object" &&
    value !== null &&
    "__esModule" in value &&
    "default" in value;
  return isCommonJsExports ? value.default : value;
}

/**
 * Loads one integration's settings for one demo: the default export of
 * `src/integrations/<integration>/demos/<demo>.ts`.
 *
 * Demos are the same for every integration. When an integration needs a demo
 * to behave differently, that difference is data in this file. A server page
 * reads it and passes it to its client components, so the default export must
 * be serializable.
 *
 * Run it on the server (or in Node, for example from a test helper). Do not
 * import it into a client component.
 *
 * @param integration - The integration slug, for example `"strands"`.
 * @param demo - The demo id, which is its URL segment, for example `"gen-ui-interrupt"`.
 * @returns The default export, or `undefined` when the integration has no
 *   file for this demo.
 * @throws Error when a segment is not kebab-case, or when the integration's
 *   manifest does not list the demo.
 *
 * @example
 * export default async function Page({ params }: { params: Promise<{ integration: string }> }) {
 *   const { integration } = await params;
 *   const config = await loadIntegrationDemoConfig<GenUiInterruptConfig>(integration, "gen-ui-interrupt");
 *   return <GenUiInterruptDemo config={config ?? DEFAULT_CONFIG} />;
 * }
 */
export async function loadIntegrationDemoConfig<T>(
  integration: string,
  demo: string,
) {
  const isKebabCase = KEBAB_CASE.test(integration) && KEBAB_CASE.test(demo);
  if (!isKebabCase) {
    throw new Error(
      `Demo config segments must be kebab-case: "${integration}", "${demo}".`,
    );
  }
  if (getDemo(integration, demo) === undefined) {
    throw new Error(
      `The ${integration} manifest does not list the ${demo} demo.`,
    );
  }

  try {
    // `../integrations` is `@/integrations`. The relative form is the one
    // that webpack, Turbopack, Vitest and Playwright all resolve when the
    // path holds variables.
    const loaded = await import(
      /* @vite-ignore */ `../integrations/${integration}/demos/${demo}`
    );
    return fileDefaultExport(loaded) as T;
  } catch (error) {
    if (isMissingModule(error, `${integration}/demos/${demo}`)) {
      return undefined;
    }
    throw error;
  }
}
