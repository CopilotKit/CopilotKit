import React from "react";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { notFound } from "next/navigation";
import { ImageResponse } from "next/og";
import { loadDoc } from "@/lib/docs-render";
import { getDocsFolder, getIntegration, ROOT_FRAMEWORK } from "@/lib/registry";

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
// fetch entirely. Keep that reliability improvement by loading all OG
// render assets from shell-docs/public instead of external URLs.

const PUBLIC_ROOT_CANDIDATES = [
  path.join(process.cwd(), "public"),
  path.join(process.cwd(), "showcase/shell-docs/public"),
];

function readPublicAsset(relativePath: string): Buffer {
  for (const publicRoot of PUBLIC_ROOT_CANDIDATES) {
    const candidate = path.join(publicRoot, relativePath);
    if (existsSync(candidate)) {
      return readFileSync(candidate);
    }
  }

  throw new Error(`Missing shell-docs public asset: ${relativePath}`);
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function toPngDataUri(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

const interMedium = toArrayBuffer(
  readPublicAsset("fonts/inter/Inter-Medium.ttf"),
);
const interBold = toArrayBuffer(readPublicAsset("fonts/inter/Inter-Bold.ttf"));
const ogBackgroundImage = toPngDataUri(
  readPublicAsset("images/og/opengraph-background.png"),
);
const copilotKitLogo = toPngDataUri(
  readPublicAsset("images/og/copilotkit-logo.png"),
);

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
    // Resolution mirrors the page routes' order so that the OG image
    // always reflects the same MDX file the user sees:
    //   1. ROOT_FRAMEWORK override — the root surface serves the
    //      BIA-authored page when one exists (see UnscopedDocsPage).
    //   2. Direct loadDoc(slugPath) for unscoped paths (e.g. concepts/...).
    //   3. Framework-scoped: when the first segment is a registered
    //      integration slug, try integrations/<docsFolder>/<rest>.
    //   4. Bare framework root (e.g. "built-in-agent") -> the file at
    //      that name in the docs root (built-in-agent.mdx) — the
    //      existing behavior preserved here so prior callers keep
    //      working.
    let doc = slugPath
      ? (loadDoc(`integrations/${getDocsFolder(ROOT_FRAMEWORK)}/${slugPath}`) ??
        loadDoc(slugPath))
      : null;
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
          backgroundImage: `url('${ogBackgroundImage}')`,
          backgroundSize: "cover",
          backgroundPosition: "0% 0%",
          width: "100%",
          height: "100%",
          padding: "5%",
          display: "block",
          position: "relative",
          fontFamily: "Inter",
        }}
      >
        <section style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              style={{
                width: "14rem",
              }}
              src={copilotKitLogo}
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
                  fontFamily: "Inter",
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
                  fontFamily: "Inter",
                }}
              >
                {doc.fm.description}
              </p>
            )}
          </section>
        </section>
      </section>,
      {
        fonts: [
          {
            name: "Inter",
            data: interMedium,
            weight: 500,
            style: "normal",
          },
          {
            name: "Inter",
            data: interBold,
            weight: 700,
            style: "normal",
          },
        ],
      },
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
