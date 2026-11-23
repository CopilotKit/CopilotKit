import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "A2A + AG-UI Starter",
  description: "Multi-agent communication demo with A2A Protocol and AG-UI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
