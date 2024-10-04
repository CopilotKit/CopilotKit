import "./global.css";
import { RootProvider } from "fumadocs-ui/provider";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { ProvidersWrapper } from "@/lib/providers/providers-wrapper";

const inter = Inter({
  subsets: ["latin"],
});

export default async function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body>
        <ProvidersWrapper clerkPublishableKey={process.env.CLERK_PUBLISHABLE_KEY as string}>
          <RootProvider theme={{ enabled: true }}>{children}</RootProvider>
        </ProvidersWrapper>
      </body>
    </html>
  );
}
