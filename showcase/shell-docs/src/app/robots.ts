import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { absoluteUrl } from "@/lib/seo/base-url";
import { isIndexable } from "@/lib/seo/indexing";

// shell-docs' robots.txt: crawl everything but the API routes, and find the
// pages through the sitemap. A deployment with `DOCS_NOINDEX` set (staging)
// turns every crawler away, so its copy of the docs never competes with
// docs.copilotkit.ai in search results.
export default async function robots(): Promise<MetadataRoute.Robots> {
  // Read the environment per request, not once at build.
  await connection();
  if (!isIndexable()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: "/api/" }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
