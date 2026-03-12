"use client";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
import "@copilotkit/react-textarea/styles.css";

import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <CopilotKit
          publicApiKey={process.env.NEXT_PUBLIC_COPILOT_CLOUD_API_KEY}
          // Alternatively, you can use runtimeUrl to host your own CopilotKit Runtime
          // runtimeUrl="/api/copilotkit"
        >
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
