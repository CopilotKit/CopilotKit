"use client";

import "./globals.css";
import "@copilotkit/react-core/v2/styles.css";

import { CopilotKit } from "@copilotkit/react-core";
import { ThemeProvider } from "@/hooks/use-theme";
import bookedSchema from "@/a2ui/booked-confirmation.json";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`antialiased`}>
        <ThemeProvider>
          <CopilotKit
            runtimeUrl="/api/copilotkit"
            inspectorDefaultAnchor={{ horizontal: "left", vertical: "top" }}
            a2ui={{
              onAction: (action) => {
                if (action.name === "book_flight") {
                  const { surfaceId } = action;
                  const fn = action.context?.flightNumber ?? "flight";
                  const orig = action.context?.origin ?? "";
                  const dest = action.context?.destination ?? "";
                  return [
                    { surfaceUpdate: { surfaceId, components: bookedSchema } },
                    {
                      dataModelUpdate: {
                        surfaceId,
                        contents: [
                          { key: "title", valueString: "Booked!" },
                          {
                            key: "detail",
                            valueString: `${fn}: ${orig} → ${dest}`,
                          },
                        ],
                      },
                    },
                    { beginRendering: { surfaceId, root: "root" } },
                  ];
                }
                return null;
              },
            }}
          >
            {children}
          </CopilotKit>
        </ThemeProvider>
      </body>
    </html>
  );
}
