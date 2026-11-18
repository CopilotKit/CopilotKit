import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import type { Metadata } from "next";
import { DExamples } from "@/proto/examples-d";
import { DHome } from "@/proto/home-d";
import { FrameworkLanding } from "@/proto/framework-landing";
import { LiveArticle } from "@/proto/live-article";
import { CatalogReferenceArticle } from "@/components/standard-catalog/catalog-reference-page";
import {
  CATALOG_REFERENCE_PATH,
  catalogComponentSlug,
  catalogReferenceFromPath,
} from "@/components/standard-catalog/catalog-reference";
import {
  goneRedirect,
  resolveLivePage,
  unsupportedRedirect,
} from "@/lib/live-docs";
import { JsonLd } from "@/components/json-ld";
import { absoluteUrl } from "@/lib/seo/base-url";
import {
  HOME_DESCRIPTION,
  HOME_TITLE,
  liveDocMetadata,
} from "@/lib/seo/metadata";
import {
  breadcrumbJsonLd,
  docPageJsonLd,
  homeJsonLd,
} from "@/lib/seo/structured-data";

/**
 * The breadcrumb trail for a canonical path (`/concepts/when-to-use`): each
 * parent path that is a page of its own, then the page itself. A parent with
 * no page (`/concepts`) is left out.
 */
function breadcrumbTrail(canonical: string, title: string) {
  const segments = canonical.split("/").filter(Boolean);
  const trail: { name: string; path: string }[] = [];
  for (let i = 1; i < segments.length; i++) {
    const parent = resolveLivePage(segments.slice(0, i));
    const path = `/${segments.slice(0, i).join("/")}`;
    if (!parent || parent.canonical !== path) continue;
    trail.push({
      name: parent.overview?.frameworkName ?? parent.page.data.title,
      path,
    });
  }
  trail.push({ name: title, path: canonical });
  return trail;
}

export default async function Page({ params }: PageProps<"/[[...path]]">) {
  const { path = [] } = await params;
  if (path.length === 0) {
    return (
      <>
        <JsonLd data={homeJsonLd()} />
        <DHome />
      </>
    );
  }
  if (path.length === 1 && path[0] === "examples") {
    return (
      <Suspense>
        <DExamples />
      </Suspense>
    );
  }

  // The live docs, ported from shell-docs, at their docs.copilotkit.ai URLs.
  const live = resolveLivePage(path);
  if (live?.overview) {
    return (
      <>
        <JsonLd
          data={docPageJsonLd({
            title: live.overview.frameworkName,
            description: live.overview.subheader,
            path: live.canonical,
          })}
        />
        <JsonLd
          data={breadcrumbJsonLd(
            breadcrumbTrail(live.canonical, live.overview.frameworkName),
          )}
        />
        <FrameworkLanding {...live} overview={live.overview} />
      </>
    );
  }
  if (live) {
    return (
      <>
        <JsonLd
          data={docPageJsonLd({
            title: live.page.data.title,
            description: live.page.data.description,
            path: live.canonical,
          })}
        />
        <JsonLd
          data={breadcrumbJsonLd(
            breadcrumbTrail(live.canonical, live.page.data.title),
          )}
        />
        <LiveArticle {...live} url={`/${path.join("/")}`} />
      </>
    );
  }

  // The standard catalog's per-component pages, generated from the catalog
  // itself, as on docs.copilotkit.ai (`/generative-ui/components/standard-catalog/box`).
  const catalog = catalogReferenceFromPath(path);
  if (catalog) return <CatalogReferenceArticle {...catalog} />;

  // An unscoped URL of a page the built-in agent has no showcase cell for
  // opens the page under a framework that has one.
  const moved = unsupportedRedirect(path);
  if (moved) permanentRedirect(moved);

  // A page docs.copilotkit.ai served that the rebuild dropped or scopes
  // differently goes to its replacement.
  const gone = goneRedirect(path);
  if (gone) permanentRedirect(gone);

  // Anything else isn't a docs page.
  notFound();
}

export async function generateMetadata({
  params,
}: PageProps<"/[[...path]]">): Promise<Metadata> {
  const { path = [] } = await params;
  const url = `/${path.join("/")}`;
  if (path.length === 0) {
    return {
      title: HOME_TITLE,
      description: HOME_DESCRIPTION,
      ...liveDocMetadata({
        title: HOME_TITLE,
        description: HOME_DESCRIPTION,
        path: "/",
      }),
    };
  }
  // The examples playground, not the hidden `examples.mdx` page behind it.
  if (path.length === 1 && path[0] === "examples") {
    const title = "Examples";
    const description =
      "Every CopilotKit showcase demo, live, on the agent framework you use.";
    return {
      title,
      description,
      ...liveDocMetadata({ title, description, path: "/examples" }),
    };
  }
  const live = resolveLivePage(path);
  const catalog = live ? null : catalogReferenceFromPath(path);
  if (catalog) {
    // The same page in every scope, so its canonical URL is the unscoped one.
    return {
      title: catalog.name,
      alternates: {
        canonical: absoluteUrl(
          `${CATALOG_REFERENCE_PATH}/${catalogComponentSlug(catalog.name)}`,
        ),
      },
    };
  }
  // The page answers 404 (`not-found.tsx` sets its own title).
  if (!live) return { robots: { index: false } };
  // A generated framework's landing: its record's name and tagline.
  const { title, description } = live.overview
    ? {
        title: live.overview.frameworkName,
        description: live.overview.subheader,
      }
    : live.page.data;
  // The page's one indexed URL (`canonicalUrl`), Open Graph and Twitter
  // cards. `/vue/mastra/backend/copilot-runtime` is the same page as
  // `/backend/copilot-runtime`, so it points there.
  const seo = liveDocMetadata({ title, description, path: live.canonical });
  return {
    title,
    description,
    ...seo,
    alternates: {
      ...seo.alternates,
      // Lets agents that land on the HTML find the page's Markdown.
      types: { "text/markdown": `${url}.md` },
    },
  };
}
