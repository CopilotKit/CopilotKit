import "./global.css";
import { RootProvider } from "fumadocs-ui/provider";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { ProvidersWrapper } from "@/lib/providers/providers-wrapper";
import { Banners } from "@/components/layout/banners";
import Script from "next/script";

const inter = Inter({
  subsets: ["latin"],
});

export default async function Layout({ children }: { children: ReactNode }) {
  const REB2B_KEY = process.env.NEXT_PUBLIC_REB2B_KEY;
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <head>
        <Script
          id="hubspot-script"
          type="text/javascript"
          src="https://js.hs-scripts.com/45532593.js"
          async
          defer
        />
        <Script
          id="reb2b-script"
          strategy="afterInteractive"
          src={`https://b2bjsstore.s3.us-west-2.amazonaws.com/b/${REB2B_KEY}/${REB2B_KEY}.js.gz`}
        />
      </head>
      <body>
        <ProvidersWrapper>
          <Banners />
          <RootProvider theme={{ enabled: true, defaultTheme: "dark" }}>
            {children}
          </RootProvider>
        </ProvidersWrapper>
      </body>
    </html>
  );
}
