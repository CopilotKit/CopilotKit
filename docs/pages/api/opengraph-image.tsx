import type { NextApiRequest, NextApiResponse } from "next";
import { ImageResponse } from "next/og";

export const config = {
  runtime: "edge",
};

const getInter = async () => {
  const response = await fetch(
    `https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfMZg.ttf`
  );
  const res = await response.arrayBuffer();
  return res;
};

const getInterSemibold = async () => {
  const response = await fetch(
    `https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuGKYMZg.ttf`
  );
  const res = await response.arrayBuffer();
  return res;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "GET") {
    // extract query params
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const title = url.searchParams.get("title") || "";
    const subtitle = "CopilotKit Documentation";

    const width = parseInt(url.searchParams.get("width") || "1200");
    const height = parseInt(url.searchParams.get("height") || "630");

    return new ImageResponse(
      (
        <section
          style={{
            backgroundColor: "#000000",
            background: "#FAEEDC",
            backgroundImage: "url('https://docs.copilotkit.ai/images/opengraph-background.png')",
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
          {/* <img
          style={{
            position: 'absolute',
            opacity: 0.3,
            bottom: -90,
            right: -120,
          }}
          src="https://cdn.pezzo.ai/logo-square-transparent-bg.png"
          width="54%"
        /> */}

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
              {subtitle && (
                <p
                  style={{
                    color: "#000000",
                    fontSize: 34,
                    marginBottom: 12,
                    fontWeight: 500,
                    fontFamily: "Inter",
                  }}
                >
                  {subtitle}
                </p>
              )}
              {title && (
                <p
                  style={{
                    color: "#4f46e5",
                    fontFamily: "Inter",
                    fontWeight: 700,
                    margin: 0,
                    fontSize: 48,
                  }}
                >
                  {title}
                </p>
              )}
            </section>
          </section>
        </section>
      ),
      {
        width: width,
        height: height,
        fonts: [
          {
            name: "Inter",
            weight: 500,
            data: await getInter(),
            style: "normal",
          },
          {
            name: "Inter",
            weight: 700,
            data: await getInterSemibold(),
            style: "normal",
          },
        ],
      }
    );
  }
}
