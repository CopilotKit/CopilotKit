import { RootProvider } from "fumadocs-ui/provider/next";
import "./global.css";
import { Plus_Jakarta_Sans, Spline_Sans_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Telemetry } from "@/components/telemetry";
import { DemoThemeBridge } from "@/components/demo-theme-bridge";
import { DocsSearchDialog } from "@/components/search";

// Brand type system: Plus Jakarta Sans for reading and UI, Spline Sans Mono
// for code and technical labels. Consumed by --font-sans / --font-mono in
// theme.css.
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

const splineSansMono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-spline-sans-mono",
  display: "swap",
});

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plusJakartaSans.variable} ${splineSansMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        {/* Search results open in the reader's frontend and framework. */}
        <RootProvider search={{ SearchDialog: DocsSearchDialog }}>
          <TooltipProvider>{children}</TooltipProvider>
        </RootProvider>
        <Telemetry />
        <DemoThemeBridge />
      </body>
    </html>
  );
}
