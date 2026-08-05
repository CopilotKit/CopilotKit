import type { Metadata } from "next";
import localFont from "next/font/local";
import { Inter } from "next/font/google";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";
import { PresenterResetProvider } from "@/shell/presenter-reset-context";
import { presenterResetEnabled } from "@/lib/presenter";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

// Inter is the body + heading typeface for the premium fintech look. Loaded
// via next/font/google (part of Next — no new dependency). Exposed as
// `--font-inter`, which globals.css maps onto `--font-sans`.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CopilotKit Reskinnable Demo",
  description: "One AI shell, many app skins.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${inter.variable} ${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* Read the presenter-reset deployment gate server-side (non-NEXT_PUBLIC_
            env) and thread it to the client via a small context a skin's chrome
            consumes with usePresenterReset(). Auth + the per-skin provider stack
            now live inside each skin (see /[skin]/layout.tsx), not here. */}
        <PresenterResetProvider enabled={presenterResetEnabled()}>
          {children}
        </PresenterResetProvider>
      </body>
    </html>
  );
}
