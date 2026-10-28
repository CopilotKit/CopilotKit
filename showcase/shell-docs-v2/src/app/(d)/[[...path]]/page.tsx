import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import type { Metadata } from "next";
import { ProtoArticle } from "@/proto/content";
import { DExamples } from "@/proto/examples-d";
import { DHome } from "@/proto/home-d";
import { LiveArticle } from "@/proto/live-article";
import { frameworkHref, parseLocation } from "@/proto/routes";
import { resolveLivePage } from "@/lib/live-docs";
import { liveFramework } from "@/lib/live-scope";
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

  // As on docs.copilotkit.ai, Intelligence opens on its overview.
  if (path.length === 1 && path[0] === "intelligence") {
    redirect("/intelligence/overview");
  }
  // A framework without a landing page of its own opens on its quickstart.
  if (path.length === 1 && liveFramework(path[0])) {
    redirect(`/${path[0]}/quickstart`);
  }

  // Anything the live docs don't have falls back to the prototype's pages.
  const loc = parseLocation("d", path);
  if (!loc) notFound();
  // Readers arrive from the home page, so a framework opens on its quickstart.
  if (loc.kind === "framework" && !loc.slug) {
    redirect(frameworkHref("d", loc.framework, "quickstart"));
  }
  return <ProtoArticle variant="d" loc={loc} />;
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
  if (!live) return { title: "CopilotKit Docs" };
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
