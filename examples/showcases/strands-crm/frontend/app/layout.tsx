import { CopilotKit } from "@copilotkit/react-core/v2";
import "@copilotkit/react-ui/v2/styles.css";
import "./globals.css";
import type { Metadata } from "next";
import { AppChrome } from "@/components/AppChrome";

export const metadata: Metadata = {
  title: "Northstar AI CRM",
  description: "Northstar — your sales pipeline, with a built-in assistant.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">
        <CopilotKit
          runtimeUrl="/api/copilotkit"
          agent="strands_agent"
          enableInspector={false}
        >
          <AppChrome>{children}</AppChrome>
        </CopilotKit>
      </body>
    </html>
  );
}
