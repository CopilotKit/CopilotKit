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

function toDataUri(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function compactText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function humanizeSlugSegment(segment: string | undefined): string {
  if (!segment) return "Docs";
  return segment
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const plusJakartaMedium = toArrayBuffer(
  readPublicAsset("fonts/plus-jakarta-sans/PlusJakartaSans-Medium.ttf"),
);
const plusJakartaBold = toArrayBuffer(
  readPublicAsset("fonts/plus-jakarta-sans/PlusJakartaSans-Bold.ttf"),
);
const copilotKitLogo = toDataUri(
  readPublicAsset("images/og/copilotkit-logo-lockup.png"),
  "image/png",
);

export const maxDuration = 60;

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

    const title = truncateText(
      compactText(doc.fm.title) || "CopilotKit Docs",
      86,
    );
    const description = truncateText(
      compactText(doc.fm.description) ||
        "Build production-ready agentic experiences with CopilotKit.",
      132,
    );
    const titleFontSize = title.length > 58 ? 54 : title.length > 36 ? 62 : 70;
    const sectionLabel = humanizeSlugSegment(slugParts[0]);

    return new ImageResponse(
      <section
        style={{
          width: "100%",
          height: "100%",
          padding: 44,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          overflow: "hidden",
          background:
            "linear-gradient(135deg, #EDEDF5 0%, #FFFFFF 48%, #E9E9EF 100%)",
          color: "#010507",
          fontFamily: "Plus Jakarta Sans",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: -80,
            right: -80,
            bottom: -120,
            height: 260,
            opacity: 0.2,
            background:
              "linear-gradient(90deg, #BEC2FF 0%, #85ECCE 48%, #54A4F2 100%)",
            borderRadius: 999,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 92,
            right: 64,
            width: 360,
            height: 360,
            opacity: 0.18,
            borderRadius: 48,
            transform: "rotate(10deg)",
            background: "#BEC2FF",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 150,
            right: 152,
            width: 280,
            height: 280,
            opacity: 0.22,
            borderRadius: 44,
            transform: "rotate(-8deg)",
            background: "#85ECCE",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <img
            src={copilotKitLogo}
            width={258}
            height={50}
            alt="CopilotKit"
            style={{
              width: 258,
              height: 50,
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 44,
              padding: "0 20px",
              borderRadius: 999,
              border: "1px solid #DBDBE5",
              background: "#FFFFFFB2",
              color: "#57575B",
              fontSize: 20,
              fontWeight: 500,
            }}
          >
            CopilotKit Docs
          </div>
        </div>

        <section
          style={{
            display: "flex",
            flex: 1,
            marginTop: 34,
            padding: 44,
            borderRadius: 34,
            border: "2px solid #FFFFFF",
            background: "#FFFFFFB2",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              width: "100%",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                maxWidth: 860,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  color: "#57575B",
                  fontSize: 24,
                  fontWeight: 500,
                  marginBottom: 18,
                }}
              >
                {sectionLabel}
              </div>
              <h1
                style={{
                  margin: 0,
                  color: "#010507",
                  fontSize: titleFontSize,
                  lineHeight: 1.04,
                  fontWeight: 700,
                  letterSpacing: 0,
                }}
              >
                {title}
              </h1>
              <p
                style={{
                  margin: "22px 0 0",
                  maxWidth: 880,
                  color: "#57575B",
                  fontSize: 30,
                  lineHeight: 1.25,
                  fontWeight: 500,
                  letterSpacing: 0,
                }}
              >
                {description}
              </p>
            </div>
          </div>
        </section>
      </section>,
      {
        width: 1200,
        height: 630,
        fonts: [
          {
            name: "Plus Jakarta Sans",
            data: plusJakartaMedium,
            weight: 500,
            style: "normal",
          },
          {
            name: "Plus Jakarta Sans",
            data: plusJakartaBold,
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
