import type { Metadata } from "next";
import { Space_Mono } from "next/font/google";
import { CopilotKit } from "@copilotkit/react-core";
import "./globals.css";
import "@copilotkit/react-ui/styles.css";

const spaceMono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-space-mono",
});

export const metadata: Metadata = {
  title: "Scene Creator - CopilotKit + Gemini 3 Demo",
  description: "Create scenes with AI-generated characters and backgrounds",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${spaceMono.className} antialiased bg-[var(--bg-primary)] text-[var(--fg-primary)]`}>
        <CopilotKit runtimeUrl="/api/copilotkit" agent="sample_agent">
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
