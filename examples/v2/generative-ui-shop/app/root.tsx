import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { CopilotKitProvider } from "@copilotkit/react-core";
import type { GenerativeUIConfig } from "@copilotkit/react-core/generative-ui";
import "@copilotkit/react-core/styles.css";
import { CartProvider } from "#app/contexts/cart.js";
import { CompareProvider } from "#app/contexts/compare.tsx";
import type { Route } from "./+types/root";
import { shopUI } from "#app/generative-ui/catalog.tsx";
import tailwindStylesheet from "./app.css?url";

// The agent renders surfaces with the components of shopUI.
const generativeUI: GenerativeUIConfig = { ui: shopUI };

export const links: Route.LinksFunction = () => [
  // https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preconnect
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "stylesheet", href: tailwindStylesheet },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export const meta: Route.MetaFunction = () => {
  return [
    {
      title: "Epic Shop",
    },
  ];
};

// The shop's `dark:` classes follow the system setting. The CopilotKit chat
// turns dark under a `.dark` class, so this keeps that class on <html> in
// step with the system. It runs before paint, so the chat does not flash.
const colorSchemeScript = `(() => {
  const media = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => document.documentElement.classList.toggle("dark", media.matches);
  apply();
  media.addEventListener("change", apply);
})();`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    // The script above sets the class before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: colorSchemeScript }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      generativeUI={generativeUI}
    >
      <CartProvider>
        <CompareProvider>
          <Outlet />
        </CompareProvider>
      </CartProvider>
    </CopilotKitProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="container mx-auto p-4 pt-16">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full overflow-x-auto p-4">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
