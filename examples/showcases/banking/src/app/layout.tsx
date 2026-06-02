import type { Metadata } from "next";
import localFont from "next/font/local";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "./globals.css";
import { AuthContextProvider } from "@/components/auth-context";
import { CopilotKitWrapper } from "./wrapper";
import { IDENTITY } from "@/lib/identity";

// The CopilotKit v2 stylesheet (`@copilotkit/react-core/v2/styles.css`) is
// pre-compiled Tailwind v4 output and contains bare `@layer base { ... }`
// rules. Banking is still on Tailwind v3, whose PostCSS plugin throws
// "`@layer base` is used but no matching `@tailwind base` directive is
// present." on any CSS imported through the JS/TSX pipeline. Inline the
// stylesheet via Node `fs` at module load so it ships as a `<style>` tag in
// the document head and never passes through PostCSS / Tailwind v3.
// Resolved relative to `process.cwd()` (the banking app root) so the path is
// a plain string at build/runtime — `require.resolve` and `import.meta.url`
// get rewritten by Turbopack and yield numeric module IDs instead of paths.
const copilotV2StylesCss = readFileSync(
  join(process.cwd(), "node_modules/@copilotkit/react-core/dist/v2/index.css"),
  "utf8",
);

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
      <head>
        <style
          id="copilotkit-v2-styles"
          dangerouslySetInnerHTML={{ __html: copilotV2StylesCss }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthContextProvider>
          <CopilotKitWrapper>{children}</CopilotKitWrapper>
        </AuthContextProvider>
      </body>
    </html>
  );
}
