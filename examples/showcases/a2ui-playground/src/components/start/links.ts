/** A public repo of this site, from NEXT_PUBLIC_REPO_URL. Unset, links fall back to the monorepo folder or the docs. */
export const REPO_URL: string | undefined =
  process.env.NEXT_PUBLIC_REPO_URL?.trim() || undefined;

/** Where the site points people while there is no public repo. */
export const DOCS_URL =
  "https://docs.copilotkit.ai/generative-ui/components/standard-catalog";

/** This site's source: the public repo when one is set, else the folder in the CopilotKit monorepo. */
export const SOURCE_URL =
  REPO_URL ??
  "https://github.com/CopilotKit/CopilotKit/tree/main/examples/showcases/a2ui-playground";
