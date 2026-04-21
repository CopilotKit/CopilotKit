import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CopilotKit Internal Showcase",
  description: "Internal feature × integration matrix",
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
