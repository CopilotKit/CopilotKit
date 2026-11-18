import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChatKit Studio",
  description: "Explore and build embeddable chat experiences",
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
