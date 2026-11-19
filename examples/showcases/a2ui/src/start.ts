import { clerkMiddleware } from "@clerk/tanstack-react-start/server";
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { serverFeatures } from "./lib/features";

// A start.ts replaces TanStack Start's default middleware, so its CSRF check
// for server functions comes back in alongside Clerk's.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

/**
 * Stateful, Clerk reads the reader's session on every request, server
 * routes too. Stateless, the desk has no sign-in.
 */
export const startInstance = createStart(() => ({
  requestMiddleware: serverFeatures().stateful
    ? [csrfMiddleware, clerkMiddleware()]
    : [csrfMiddleware],
}));
