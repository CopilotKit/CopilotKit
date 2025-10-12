import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vercel AI SDK Feature Viewer",
  description: "Explore advanced features with CopilotKit and Vercel AI SDK",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
