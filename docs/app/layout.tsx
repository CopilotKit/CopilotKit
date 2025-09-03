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
        <Script id="reb2b-script" strategy="afterInteractive">
          {`!function(key){
            if (window.reb2b) return;
            window.reb2b = { loaded: true };
            var s = document.createElement("script");
            s.async = true;
            s.src = "https://b2bjsstore.s3.us-west-2.amazonaws.com/b/" + key + "/" + key + ".js.gz";
            var firstScript = document.getElementsByTagName("script")[0];
            if (firstScript && firstScript.parentNode) {
              firstScript.parentNode.insertBefore(s, firstScript);
            }
          }("GOYPYHVD49OX");`}
        </Script>
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
