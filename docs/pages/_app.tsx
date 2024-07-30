import "../globals.css";
import { AppProps } from "next/app";
import { IBM_Plex_Sans } from "next/font/google";
import { useRB2B } from "../lib/hooks/useRB2B";
import { PostHogProvider } from "posthog-js/react";
import { usePostHog } from "../lib/hooks/usePostHog";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export default function App({ Component, pageProps }: AppProps) {
  useRB2B();
  const { posthog } = usePostHog();

  return (
    <PostHogProvider client={posthog}>
      <main className={plex.className}>
        <Component {...pageProps} />
      </main>
    </PostHogProvider>
  );
}
