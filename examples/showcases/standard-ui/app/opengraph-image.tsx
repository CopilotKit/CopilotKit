import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt =
  "CopilotKit standard components: 69 generative UI components, rendered live by a model";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const fromModules = (path: string) =>
  readFile(join(process.cwd(), "node_modules", path));

const COMPONENTS = ["Card", "Chart", "Table", "Map", "Form", "Slider", "Tabs"];

/**
 * The share card on the CopilotKit brand: the lavender-grey ground with a
 * soft warm glow, the full logotype, Plus Jakarta Sans, and one glass card.
 */
export default async function OpenGraphImage() {
  const [sans400, sans500, mono500, logo] = await Promise.all([
    fromModules(
      "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-400-normal.woff",
    ),
    fromModules(
      "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-500-normal.woff",
    ),
    fromModules(
      "@fontsource/spline-sans-mono/files/spline-sans-mono-latin-500-normal.woff",
    ),
    readFile(join(process.cwd(), "public", "copilotkit-logo.svg")),
  ]);
  const logoSrc = `data:image/svg+xml;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 64,
        background: "#dedee9",
        backgroundImage:
          "radial-gradient(circle at 88% 8%, rgba(255,172,77,0.32), rgba(222,222,233,0) 42%), radial-gradient(circle at 12% 92%, rgba(255,243,136,0.45), rgba(222,222,233,0) 40%), radial-gradient(circle at 55% 110%, #f3f3fc, rgba(222,222,233,0) 45%)",
        color: "#010507",
        fontFamily: "Plus Jakarta Sans",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- satori renders <img> */}
      <img src={logoSrc} width={250} height={48} alt="" />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "40px 44px",
          borderRadius: 16,
          border: "2px solid #ffffff",
          background: "rgba(255,255,255,0.5)",
        }}
      >
        <div
          style={{
            fontSize: 72,
            fontWeight: 500,
            lineHeight: 1.1,
            letterSpacing: "-0.01em",
          }}
        >
          Standard components
        </div>
        <div
          style={{
            marginTop: 16,
            fontSize: 30,
            fontWeight: 400,
            lineHeight: 1.4,
            color: "#57575b",
          }}
        >
          69 generative UI components, rendered live by a model.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", marginTop: 28 }}>
          {COMPONENTS.map((name) => (
            <div
              key={name}
              style={{
                display: "flex",
                marginRight: 10,
                padding: "6px 16px",
                borderRadius: 9999,
                background: "rgba(255,255,255,0.75)",
                fontFamily: "Spline Sans Mono",
                fontSize: 22,
                color: "#010507",
              }}
            >
              {name}
            </div>
          ))}
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        {
          name: "Plus Jakarta Sans",
          data: sans400,
          weight: 400,
          style: "normal",
        },
        {
          name: "Plus Jakarta Sans",
          data: sans500,
          weight: 500,
          style: "normal",
        },
        {
          name: "Spline Sans Mono",
          data: mono500,
          weight: 500,
          style: "normal",
        },
      ],
    },
  );
}
