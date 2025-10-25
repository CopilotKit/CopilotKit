import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vercel AI SDK Starter",
  description: "A starter application with CopilotKit and Vercel AI SDK",
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
