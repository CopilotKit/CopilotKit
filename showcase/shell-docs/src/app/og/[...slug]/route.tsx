import React from "react";
import type { NextRequest } from "next/server";
import { notFound } from "next/navigation";
import { ImageResponse } from "next/og";
import { loadDoc } from "@/lib/docs-render";
import { getDocsFolder, getIntegration } from "@/lib/registry";

// Per-page Open Graph image route — emits a 1200x630-ish PNG used by
// Twitter cards, LinkedIn previews, and Slack unfurls. Ported from
// upstream `docs/app/og/[...slug]/route.tsx` and adapted to shell-docs:
// the upstream version reads page metadata via fumadocs `source`, while
// shell-docs reads it directly from MDX frontmatter via `loadDoc()`.
//
// Public signature is preserved: requests at `/og/<slug>/og.png` map
// to the page at `<slug>` (the trailing `og.png` is stripped, matching
// upstream's `generateStaticParams` which appends it).
//
// Previously this route fetched Inter TTFs from fonts.gstatic.com at
// request time and any failure (Railway egress hiccup, font URL drift,
// cold cache) put the request into the catch block, which 307-redirected
// to a static CDN fallback that itself was broken (25 bytes). The result
// was zero working OG images on most pages in prod. We now skip the font
// fetch entirely and rely on Satori's built-in default sans-serif. The
// PNG quality is unchanged for the headings and tagline; the upside is
// every page renders successfully without depending on external network.

// In Next.js 13+ (app directory), route handlers use the following signature:
export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  // Skip OG image generation during build phase to avoid fetch errors
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return new Response("OG image skipped during build", { status: 200 });
  }

  try {
    const resolvedParams = await params;
    // Drop the trailing `og.png` segment to recover the actual page slug.
    const slugParts = resolvedParams.slug.slice(0, -1);
    const slugPath = slugParts.join("/");
    // Resolution mirrors the framework page route's order so that the
    // OG image always reflects the same MDX file the user sees:
    //   1. Direct loadDoc(slugPath) for unscoped paths (e.g. concepts/...).
    //   2. Framework-scoped: when the first segment is a registered
    //      integration slug, try integrations/<docsFolder>/<rest>.
    //   3. Bare framework root (e.g. "built-in-agent") -> the file at
    //      that name in the docs root (built-in-agent.mdx) — the
    //      existing behavior preserved here so prior callers keep
    //      working.
    let doc = slugPath ? loadDoc(slugPath) : null;
    if (!doc && slugParts.length >= 2) {
      const [framework, ...rest] = slugParts;
      if (getIntegration(framework)) {
        const docsFolder = getDocsFolder(framework);
        doc = loadDoc(`integrations/${docsFolder}/${rest.join("/")}`);
      }
    }
    if (!doc) notFound();

    return new ImageResponse(
      <section
        style={{
          backgroundColor: "#000000",
          background: "#FAEEDC",
          backgroundImage:
            "url('https://cdn.copilotkit.ai/docs/copilotkit/images/opengraph-background.png')",
          backgroundSize: "cover",
          backgroundPosition: "0% 0%",
          width: "100%",
          height: "100%",
          padding: "5%",
          display: "block",
          position: "relative",
          fontFamily: "sans-serif",
        }}
      >
        <section style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              style={{
                width: "14rem",
              }}
              src="https://github-production-user-asset-6210df.s3.amazonaws.com/746397/288400836-bd5c9079-929b-4d55-bdc9-16d1c8181b71.png"
              alt="CopilotKit"
            />
          </div>

          <section
            style={{
              flexGrow: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
            }}
          >
            {doc.fm.title && (
              <p
                style={{
                  color: "#4f46e5",
                  fontFamily: "sans-serif",
                  fontWeight: 700,
                  margin: 0,
                  fontSize: 48,
                }}
              >
                {doc.fm.title}
              </p>
            )}
            {doc.fm.description && (
              <p
                style={{
                  color: "#000000",
                  fontSize: 34,
                  marginBottom: 12,
                  fontWeight: 500,
                  fontFamily: "sans-serif",
                }}
              >
                {doc.fm.description}
              </p>
            )}
          </section>
        </section>
      </section>,
    );
  } catch (error) {
    // Note: notFound() throws an internal Next.js redirect-like error; let
    // it propagate so the framework returns a proper 404. Anything else is
    // a real failure we want surfaced as a 500 with a server-side log so
    // operators see breakage rather than silent fallback to a static PNG
    // that may itself be broken.
    const digest = (error as { digest?: string } | undefined)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_HTTP_ERROR")) {
      throw error;
    }
    console.error("Error generating OG image:", error);
    return new Response("OG image generation failed", { status: 500 });
  }
}
