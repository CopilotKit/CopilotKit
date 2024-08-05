import "../globals.css";
import { AppProps } from "next/app";
import { IBM_Plex_Sans } from "next/font/google";
import { useRB2B } from "../lib/hooks/useRB2B";
import { ScarfPixel } from "../lib/ScarfPixel";
import { ClerkProvider } from "@clerk/nextjs";
import { PostHogProvider } from "../lib/providers/PostHogProvider";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export default function App({ Component, pageProps }: AppProps) {
  useRB2B();

  return (
    <>
      <ClerkProvider publishableKey={process.env.CLERK_PUBLISHABLE_KEY}>
        <PostHogProvider>
          <main className={plex.className}>
            <Component {...pageProps} />
          </main>
        </PostHogProvider>
        <ScarfPixel />
      </ClerkProvider>
    </>
  );
}
