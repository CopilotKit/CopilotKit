import "../globals.css";
import { AppProps } from "next/app";
import { IBM_Plex_Sans } from "next/font/google";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <main className={plex.className}>
      <Component {...pageProps} />
    </main>
  );
}
