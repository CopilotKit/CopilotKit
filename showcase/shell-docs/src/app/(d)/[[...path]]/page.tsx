import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import type { Metadata } from "next";
import { DExamples } from "@/proto/examples-d";
import { DHome } from "@/proto/home-d";
import { LiveArticle } from "@/proto/live-article";
import { CatalogReferenceArticle } from "@/components/standard-catalog/catalog-reference-page";
import {
  CATALOG_REFERENCE_PATH,
  catalogComponentSlug,
  catalogReferenceFromPath,
} from "@/components/standard-catalog/catalog-reference";
import { frontendFallback, resolveLivePage } from "@/lib/live-docs";
import { liveFramework } from "@/lib/live-scope";
import { absoluteUrl } from "@/lib/seo/base-url";
import {
  HOME_DESCRIPTION,
  HOME_TITLE,
  liveDocMetadata,
} from "@/lib/seo/metadata";

export default async function Page({ params }: PageProps<"/[[...path]]">) {
  const { path = [] } = await params;
  if (path.length === 0) return <DHome />;
  if (path.length === 1 && path[0] === "examples") {
    return (
      <Suspense>
        <DExamples />
      </Suspense>
    );
  }

  // The live docs, ported from shell-docs, at their docs.copilotkit.ai URLs.
  const live = resolveLivePage(path);
  if (live) return <LiveArticle {...live} url={`/${path.join("/")}`} />;

  // The standard catalog's per-component pages, generated from the catalog
  // itself, as on docs.copilotkit.ai (`/generative-ui/components/standard-catalog/box`).
  const catalog = catalogReferenceFromPath(path);
  if (catalog) return <CatalogReferenceArticle {...catalog} />;

  // As on docs.copilotkit.ai, Intelligence opens on its overview.
  if (path.length === 1 && path[0] === "intelligence") {
    redirect("/intelligence/overview");
  }
  // A framework without a landing page of its own opens on its quickstart.
  if (path.length === 1 && liveFramework(path[0])) {
    redirect(`/${path[0]}/quickstart`);
  }
  // A page only another frontend has opens this frontend's quickstart.
  const fallback = frontendFallback(path);
  if (fallback) redirect(fallback);

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
  const { title, description } = live.page.data;
  // Canonical URL, Open Graph and Twitter cards, as shell-docs sets them.
  const seo = liveDocMetadata({ title, description, path: url });
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
