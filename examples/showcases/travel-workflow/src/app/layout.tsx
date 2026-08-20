import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";

import "@copilotkit/react-core/v2/styles.css";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Travel Workflow",
  description: "An agent-driven travel planning workflow",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark font-sans ${geist.variable}`}>
      <body>
        <CopilotKitProvider
          runtimeUrl="/api/copilotkit"
          useSingleEndpoint={false}
          showDevConsole
        >
          {children}
        </CopilotKitProvider>
      </body>
    </html>
  );
}
