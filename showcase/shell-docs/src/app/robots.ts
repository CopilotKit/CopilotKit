import type { MetadataRoute } from "next";
import { isVnextChannel } from "@/lib/docs-channel";
import { absoluteUrl } from "@/lib/seo/base-url";

// shell-docs' robots.txt: crawl everything but the API routes, and find the
// pages through the sitemap. The next major release's docs
// (src/lib/docs-channel.ts) disallow every path and list no sitemap.
export default function robots(): MetadataRoute.Robots {
  if (isVnextChannel) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: "/api/" }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
