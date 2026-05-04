import "./global.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import { Plus_Jakarta_Sans, Spline_Sans_Mono } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { ProvidersWrapper } from "@/lib/providers/providers-wrapper";
import { Banners } from "@/components/layout/banners";
import SearchDialog from "@/components/ui/search-dialog";
import { ConsentProvider, type Region } from "@/lib/consent/ConsentContext";
import { ConsentLayer } from "@/lib/consent/ConsentLayer";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
});

const splineSansMono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-spline-sans-mono",
});

export default async function Layout({ children }: { children: ReactNode }) {
  const region = (((await headers()).get("x-cpk-region") as Region) ||
    "other") as Region;

  return (
    <html
      lang="en"
      className={`${plusJakartaSans.className} ${splineSansMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ConsentProvider region={region}>
          <ProvidersWrapper>
            <Banners />
            <RootProvider
              theme={{ enabled: true, defaultTheme: "system" }}
              search={{ SearchDialog: SearchDialog }}
            >
              {children}
            </RootProvider>
            <ConsentLayer />
          </ProvidersWrapper>
        </ConsentProvider>
      </body>
    </html>
  );
}
