import type { Metadata } from "next";
import "./globals.css";

// Updated metadata for SEO with new keywords
export const metadata: Metadata = {
  title: "Coagents Recipes",
  description: "Thanksgiving recipes with coagents",
  keywords:
    "Thanksgiving, recipes, coagents, cooking, food, holiday meals, LLM, Large Language Models, Agentic framework, Copilot, AI assistants, conversational agents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="robots" content="index, follow" />
      </head>
      <body>{children}</body>
    </html>
  );
}
