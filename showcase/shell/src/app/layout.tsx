import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Spline_Sans_Mono } from "next/font/google";
import { BrandNav } from "@/components/brand-nav";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-prose",
  display: "swap",
});

const splineSansMono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CopilotKit Docs",
  description: "Docs, live demos, and integrations for CopilotKit",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${plusJakartaSans.variable} ${splineSansMono.variable}`}
    >
      <body className="min-h-screen">
        <BrandNav />
        <main>{children}</main>
        <div
          style={{
            position: "fixed",
            bottom: "8px",
            right: "12px",
            fontSize: "10px",
            fontFamily: "monospace",
            color: "rgba(0,0,0,0.15)",
            pointerEvents: "none",
            zIndex: 9999,
            userSelect: "none",
          }}
        >
          {(process.env.NEXT_PUBLIC_COMMIT_SHA || "dev").slice(0, 9)}
        </div>
      </body>
    </html>
  );
}
