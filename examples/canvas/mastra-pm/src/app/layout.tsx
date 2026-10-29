import type { Metadata } from "next";
import { CopilotKitProvider } from "@copilotkit/react-core";
import "./globals.css";
import "@copilotkit/react-core/styles.css";

export const metadata: Metadata = {
  title: "Project Manager",
  description: "Plan tasks with a Mastra agent and a shared project board.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <CopilotKitProvider runtimeUrl="/api/copilotkit">
          {children}
        </CopilotKitProvider>
      </body>
    </html>
  );
}
