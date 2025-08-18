import React from "react";
import { type NextRequest } from "next/server";
import { notFound } from "next/navigation";
import { source } from "../../source";
import { ImageResponse } from "next/og";

const getInter = async () => {
  try {
    const response = await fetch(
      `https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfMZg.ttf`,
      { cache: "force-cache" }
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch Inter font: ${response.status}`);
    }
    const res = await response.arrayBuffer();
    return res;
  } catch (error) {
    console.error("Error fetching Inter font:", error);
    // Return null to handle the error case in the ImageResponse
    return null;
  }
};

const getInterSemibold = async () => {
  try {
    const response = await fetch(
      `https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuGKYMZg.ttf`,
      { cache: "force-cache" }
    );
    if (!response.ok) {
      throw new Error(
        `Failed to fetch Inter Semibold font: ${response.status}`
      );
    }
    const res = await response.arrayBuffer();
    return res;
  } catch (error) {
    console.error("Error fetching Inter Semibold font:", error);
    // Return null to handle the error case in the ImageResponse
    return null;
  }
};

// In Next.js 13+ (app directory), route handlers use the following signature:
export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  // Skip OG image generation during build phase to avoid fetch errors
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return new Response("OG image skipped during build", { status: 200 });
  }

  try {
    const resolvedParams = await params;
    const page = source.getPage(resolvedParams.slug.slice(0, -1));
    if (!page) notFound();

    const interFont = await getInter();
    const interSemiboldFont = await getInterSemibold();

    // Define fonts array without type errors by dropping strong typing
    const fontOptions = [];

    if (interFont) {
      fontOptions.push({
        name: "Inter",
        weight: 500,
        data: interFont,
        style: "normal",
      });
    }

    if (interSemiboldFont) {
      fontOptions.push({
        name: "Inter",
        weight: 700,
        data: interSemiboldFont,
        style: "normal",
      });
    }

    return new ImageResponse(
      (
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
            fontFamily: "Satori",
          }}
        >
          <section style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex" }}>
              <img
                style={{
                  width: "14rem",
                }}
                src="https://github-production-user-asset-6210df.s3.amazonaws.com/746397/288400836-bd5c9079-929b-4d55-bdc9-16d1c8181b71.png"
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
              {page.data.title && (
                <p
                  style={{
                    color: "#4f46e5",
                    fontFamily: fontOptions.length ? "Inter" : "sans-serif",
                    fontWeight: 700,
                    margin: 0,
                    fontSize: 48,
                  }}
                >
                  {page.data.title}
                </p>
              )}
              {(page.data as any).description && (
                <p
                  style={{
                    color: "#000000",
                    fontSize: 34,
                    marginBottom: 12,
                    fontWeight: 500,
                    fontFamily: fontOptions.length ? "Inter" : "sans-serif",
                  }}
                >
                  {(page.data as any).description}
                </p>
              )}
            </section>
          </section>
        </section>
      ),
      {
        // width: width,
        // height: height,
        fonts: fontOptions.length ? (fontOptions as any) : undefined,
      }
    );
  } catch (error) {
    console.error("Error generating OG image:", error);
    // Return a simple fallback image
    return new Response("OG image generation failed - using fallback", {
      status: 307,
      headers: {
        Location: "https://cdn.copilotkit.ai/docs/copilotkit/images/og-fallback.png",
      },
    });
  }
}

export function generateStaticParams() {
  return source.generateParams().map((params) => ({
    ...params,
    slug: [...params.slug, "og.png"],
  }));
}
