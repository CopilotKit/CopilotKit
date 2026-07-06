import type { Metadata } from "next";
import localFont from "next/font/local";
import { Inter } from "next/font/google";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";
import { AuthContextProvider } from "@/components/auth-context";
import { CopilotKitWrapper } from "./wrapper";
import { IDENTITY } from "@/lib/identity";
import { glassEngineAvailable } from "@/lib/glass-engine";
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
  title: IDENTITY.brand,
  description: "Collaborative finance for 21st century teams",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthContextProvider>
          {/* Read the deployment gate server-side (non-NEXT_PUBLIC_ env) and
              thread it to the client as a prop — one image, per-deploy env. */}
          <CopilotKitWrapper
            glassAvailable={glassEngineAvailable()}
            resetEnabled={presenterResetEnabled()}
          >
            {children}
          </CopilotKitWrapper>
        </AuthContextProvider>
      </body>
    </html>
  );
}
