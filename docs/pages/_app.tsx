import "../globals.css";
import { AppProps } from "next/app";
import { IBM_Plex_Sans } from "next/font/google";
import { useRB2B } from "../lib/hooks/useRB2B";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export default function App({ Component, pageProps }: AppProps) {
  useRB2B();

  return (
    <main className={plex.className}>
      <Component {...pageProps} />
    </main>
  );
}
