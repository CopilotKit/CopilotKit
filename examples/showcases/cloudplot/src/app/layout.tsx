import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { CopilotKit } from "@copilotkit/react-core";
import "./globals.css";
import "@copilotkit/react-ui/v2/styles.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CloudPlot - AI Cloud Infrastructure Architect",
  description: "Design and visualize cloud infrastructure with AI assistance",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased">
        <CopilotKit runtimeUrl="/api/copilotkit" agent="cloudplot_agent">
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
