import { absoluteUrl, getBaseUrl } from "./base-url";
import { HOME_DESCRIPTION } from "./metadata";

// schema.org JSON-LD for the docs. Search engines and answer engines read it to
// tell which product a page documents and which site is the authoritative
// source. Every page names the same `SoftwareSourceCode` entity by `@id`, so
// all docs pages attach to one CopilotKit record.

const PRODUCT_SITE_URL = "https://copilotkit.ai";
const REPOSITORY_URL = "https://github.com/CopilotKit/CopilotKit";
const SITE_NAME = "CopilotKit Docs";

type JsonLd = Record<string, unknown>;

const websiteId = () => `${getBaseUrl()}/#website`;
const softwareId = () => `${getBaseUrl()}/#software`;

function organization(): JsonLd {
  return { "@type": "Organization", name: "CopilotKit", url: PRODUCT_SITE_URL };
}

/** The docs home: the docs website and the open-source project it documents. */
export function homeJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": websiteId(),
        name: SITE_NAME,
        url: absoluteUrl("/"),
        publisher: organization(),
      },
      {
        "@type": "SoftwareSourceCode",
        "@id": softwareId(),
        name: "CopilotKit",
        description: HOME_DESCRIPTION,
        url: PRODUCT_SITE_URL,
        codeRepository: REPOSITORY_URL,
        license: "https://opensource.org/licenses/MIT",
        programmingLanguage: ["TypeScript", "Python"],
      },
    ],
  };
}

/** One docs page, at its canonical `path` (`/concepts/when-to-use`). */
export function docPageJsonLd({
  title,
  description,
  path,
}: {
  title: string;
  description?: string;
  path: string;
}): JsonLd {
  const url = absoluteUrl(path);
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: title,
    ...(description?.trim() ? { description: description.trim() } : {}),
    url,
    mainEntityOfPage: url,
    inLanguage: "en",
    isPartOf: {
      "@type": "WebSite",
      "@id": websiteId(),
      name: SITE_NAME,
      url: absoluteUrl("/"),
    },
    about: {
      "@type": "SoftwareSourceCode",
      "@id": softwareId(),
      name: "CopilotKit",
      codeRepository: REPOSITORY_URL,
    },
    publisher: organization(),
  };
}

/**
 * The trail from the docs home to a page, as `{ name, path }` items from the
 * top level down. The home item is added here.
 */
export function breadcrumbJsonLd(
  trail: { name: string; path: string }[],
): JsonLd {
  const items = [{ name: SITE_NAME, path: "/" }, ...trail];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/**
 * The `<script>` body for a JSON-LD object. `<` is escaped so text from page
 * frontmatter cannot close the script element.
 */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
