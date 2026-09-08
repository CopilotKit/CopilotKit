import type { Metadata } from "next";
import localFont from "next/font/local";
import { Inter } from "next/font/google";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";
import { PresenterResetProvider } from "@/shell/presenter-reset-context";
import { presenterResetEnabled } from "@/lib/presenter";
import { LockedSkinProvider } from "@/shell/locked-skin-context";
import { lockedSkinId } from "@/lib/locked-skin";
import { skinIdentities } from "@/shell/skins-config";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

// Inter is the body + heading typeface for the premium fintech look. Loaded
// via next/font/google (part of Next — no new dependency). Exposed as
// `--font-inter`, which globals.css maps onto `--font-sans`.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Both the tab title AND the description are rendered on the SERVER (this is a
// server component), keyed on LOCK_SKIN, so the SSR/initial HTML <title> and
// <meta name="description"> — what crawlers and link unfurlers read — already
// carry the right brand. A client effect cannot achieve this: the root layout's
// metadata is the only source for both, so Next's rendered values win the
// initial paint and an effect could at best flash them in after hydration.
// The description is branded for the same reason the title is: an unfurl of a
// locked single-tenant deploy must not advertise the multi-skin substrate — a
// brand title beside "One AI shell, many app skins." reads as deliberate and is
// arguably worse than either alone. Unlocked stays byte-identical (both fields)
// to the multi-skin demo's metadata.
export function generateMetadata(): Metadata {
  const locked = lockedSkinId();
  // `locked` is either null or a validated skin id (see lockedSkinId), so the
  // cast to a skinIdentities key is safe.
  const identity = locked
    ? skinIdentities[locked as keyof typeof skinIdentities]
    : null;
  return {
    title: identity ? identity.brand : "CopilotKit Reskinnable Demo",
    description: identity ? identity.tagline : "One AI shell, many app skins.",
  };
}

// Both gates below (LOCK_SKIN, PRESENTER_RESET_ENABLED) are runtime envs read
// per request. Reading process.env is not itself a dynamic API, so it does not
// opt this layout out of static generation. force-dynamic makes the whole tree
// render per request rather than relying on the implicit invariant that every
// descendant route happens to be dynamic. The sibling page.tsx carries its own
// force-dynamic for the same reason.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* Two per-deploy gates, both read server-side from deliberately
            non-NEXT_PUBLIC_ envs and threaded to client chrome as props, so one
            build serves every deployment shape. PRESENTER_RESET_ENABLED gates the
            reset control; LOCK_SKIN pins the deploy to a single skin. Auth + the
            per-skin provider stack live inside each skin (see /[skin]/layout.tsx),
            not here. Both are runtime envs read per request; the `force-dynamic`
            export above (see its note) is what keeps either from being baked in. */}
        <LockedSkinProvider lockedSkinId={lockedSkinId()}>
          <PresenterResetProvider enabled={presenterResetEnabled()}>
            {children}
          </PresenterResetProvider>
        </LockedSkinProvider>
      </body>
    </html>
  );
}
