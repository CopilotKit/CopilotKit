import generated from "@/data/examples.json";
import { demoOrigin, type SiteHosts } from "@/lib/site-hosts";
import { FRAMEWORKS } from "./data";

// The examples playground's catalog: the showcase's features with the demos
// that run them, generated into src/data/ by `scripts/showcase-data.mjs`.
// Client code reaches it only through a lazy import (examples-d.tsx,
// content.tsx), so it ships with the pages that show a demo, not every page.

export interface ExampleDemo {
  route: string;
  /** The file "View the code" opens, under the framework's showcase folder. */
  file?: string;
}

export interface Example {
  id: string;
  name: string;
  category: string;
  /** The frameworks the docs show that run it, in the site's order. */
  frameworks: string[];
  demos: Record<string, ExampleDemo>;
}

const catalog = generated as {
  repos: Record<string, string>;
  categories: { id: string; name: string }[];
  features: Omit<Example, "frameworks">[];
};

/** Every example at least one of the docs' frameworks runs. */
export const EXAMPLES: Example[] = catalog.features
  .map((f) => ({
    ...f,
    frameworks: FRAMEWORKS.map((fw) => fw.id).filter((id) =>
      Object.hasOwn(f.demos, id),
    ),
  }))
  .filter((f) => f.frameworks.length > 0);

export const EXAMPLE_CATEGORIES = catalog.categories;

/** The demo's live URL on this deployment's showcase. */
export function demoUrl(
  hosts: SiteHosts,
  framework: string,
  demo: ExampleDemo,
) {
  return `${demoOrigin(hosts, framework)}${demo.route}`;
}

/** The demo's code on GitHub: its file, else the framework's showcase folder. */
export function demoSourceUrl(framework: string, demo: ExampleDemo) {
  const repo = catalog.repos[framework] ?? "";
  return demo.file ? `${repo}/${demo.file}` : repo;
}
