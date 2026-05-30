import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@copilotkit/react-ui/v2/styles.css";
import "./globals.css";
import { Inter, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

const geistMonoHeading = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-heading",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "MS Agent Harness Control Room",
  description:
    "A live cockpit for the Microsoft Agent Harness — planning, todos, file memory, tool approvals over AG-UI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("font-sans", inter.variable, geistMonoHeading.variable)}
    >
      <body>{children}</body>
    </html>
  );
}
