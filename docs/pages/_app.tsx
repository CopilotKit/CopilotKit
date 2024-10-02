import "../globals.css";
import { AppProps } from "next/app";
import { IBM_Plex_Sans } from "next/font/google";
import { useRB2B } from "@/lib/hooks/useRB2B";
import { ScarfPixel } from "@/lib/ScarfPixel";
import { PostHogProvider } from "@/lib/providers/PostHogProvider";
import { ClerkProvider } from "@clerk/nextjs";
import { TailoredContentProvider } from "@/lib/hooks/useTailoredContent";
import { ThemeProvider } from "@/lib/context/themeContext";
import { useEffect } from "react";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export default function App({ Component, pageProps }: AppProps) {
  useRB2B();

  useEffect(() => {
    // Apply the theme class to the body on initial load
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.body.dataset.theme = savedTheme;
  }, []);

  return (
    <ClerkProvider publishableKey={process.env.CLERK_PUBLISHABLE_KEY}>
      <PostHogProvider>
        <ThemeProvider>
          <main className={plex.className}>
            <TailoredContentProvider>
              <Component {...pageProps} />
            </TailoredContentProvider>
          </main>
        </ThemeProvider>
      </PostHogProvider>
      <ScarfPixel />
    </ClerkProvider>
  );
}