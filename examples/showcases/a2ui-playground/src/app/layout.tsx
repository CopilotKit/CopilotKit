import "@copilotkit/react-core/v2/styles.css";
import "@/vendor/transitions/ui-generation.css";
import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { StaticGenUIProvider } from "@/components/app/static-surface";
import { SkipLink } from "@/components/site/site-header";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata = {
  title: "A2UI Playground",
  description:
    "Ask for anything and get an interface back. Gemini writes A2UI 1.0 in Express, and CopilotKit Gen UI 2.0 renders it with your own React components: the standard components plus a shadcn, chart and map catalog, and macros.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={cn("dark", "font-sans", geist.variable, geistMono.variable)}
      style={{ colorScheme: "dark" }}
    >
      <body>
        <SkipLink />
        <StaticGenUIProvider>{children}</StaticGenUIProvider>
      </body>
    </html>
  );
}
