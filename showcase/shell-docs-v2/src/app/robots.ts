import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo/base-url";

// shell-docs' robots.txt: crawl everything but the API routes, and find the
// pages through the sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: "/api/" }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
