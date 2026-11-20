import { ClerkProvider } from "@clerk/tanstack-react-start";
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CLERK_APPEARANCE, CLERK_LOCALIZATION } from "../lib/clerk-appearance";
import { loadFeatures, useFeatures } from "../lib/features";
// The production build drops react-core's stylesheet import, so link it
// here, before app.css, which restyles some of its parts.
import copilotKitCss from "@copilotkit/react-core/v2/styles.css?url";
import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
  loader: () => loadFeatures(),
  staleTime: Infinity,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        name: "theme-color",
        content: "#fdf6e3",
        media: "(prefers-color-scheme: light)",
      },
      {
        name: "theme-color",
        content: "#002b36",
        media: "(prefers-color-scheme: dark)",
      },
      { title: "A2UI Playground · Powered by CopilotKit" },
      {
        name: "description",
        content:
          "A calm research desk where a Google ADK agent answers with prose and generative UI you can turn back into its A2UI.",
      },
    ],
    links: [
      { rel: "stylesheet", href: copilotKitCss },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootDocument,
});

/**
 * The app's tokens follow the system's light or dark setting on their own.
 * CopilotKit's chat and the standard A2UI catalog switch on a `.dark`
 * class, so this mirrors the setting onto <html> before the first paint,
 * and again whenever the reader changes it.
 */
const COLOR_SCHEME_SCRIPT = `(() => {
  const query = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => document.documentElement.classList.toggle("dark", query.matches);
  apply();
  query.addEventListener("change", apply);
})();`;

function RootDocument({ children }: { children: ReactNode }) {
  // Stateless there is no Clerk provider, and nothing calls Clerk's hooks.
  const { stateful } = useFeatures();
  return (
    // The server cannot know the setting; the script sets the class.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: COLOR_SCHEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {stateful ? (
          <ClerkProvider
            appearance={CLERK_APPEARANCE}
            localization={CLERK_LOCALIZATION}
            signInUrl="/sign-in"
            signUpUrl="/sign-up"
            afterSignOutUrl="/"
          >
            {children}
          </ClerkProvider>
        ) : (
          children
        )}
        <Scripts />
      </body>
    </html>
  );
}
