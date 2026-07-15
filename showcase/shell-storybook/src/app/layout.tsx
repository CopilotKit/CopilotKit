import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Spline_Sans_Mono, Geist } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta-sans",
});

const splineSansMono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-spline-sans-mono",
});

export const metadata: Metadata = {
  title: "Showcase Storybook",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body
        className={`${plusJakartaSans.variable} ${splineSansMono.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
