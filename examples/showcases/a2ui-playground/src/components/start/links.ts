/** The public repo behind "Get the code", from NEXT_PUBLIC_REPO_URL. Unset, the site hides every repo link and points to the docs. */
export const REPO_URL: string | undefined = process.env.NEXT_PUBLIC_REPO_URL?.trim() || undefined;

function pathOf(url: string) {
  try {
    return new URL(url).pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  } catch {
    return url;
  }
}

/** "org/name" for link text, and the folder `git clone` makes. */
export const REPO_NAME = REPO_URL ? pathOf(REPO_URL) : undefined;
export const REPO_DIR = REPO_NAME?.split("/").pop();

/** Where the site points people while there is no public repo. */
export const DOCS_URL = "https://docs.copilotkit.ai/generative-ui/components/standard-catalog";
