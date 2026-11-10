import "@copilotkit/react-core/v2/styles.css";
import "@/vendor/transitions/ui-generation.css";
import "./globals.css";
import "@/design-systems/design-systems.css";
import { Geist, Geist_Mono } from "next/font/google";
import { StaticGenUIProvider } from "@/components/app/static-surface";
import { SkipLink } from "@/components/site/site-header";
import { THEME_SCRIPT } from "@/lib/theme-script";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata = {
  title: "A2UI Playground by CopilotKit",
  description:
    "Ask an agent for an interface and watch it write A2UI 1.0, then draw the same answer with CopilotKit's standard catalog, ChatCN or your own components.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The theme script may add `dark` before React hydrates, so <html>'s class and color-scheme can differ from the server's.
    <html
      lang="en"
      className={cn("font-sans", geist.variable, geistMono.variable)}
      style={{ colorScheme: "light" }}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <SkipLink />
        <StaticGenUIProvider>{children}</StaticGenUIProvider>
      </body>
    </html>
  );
}
