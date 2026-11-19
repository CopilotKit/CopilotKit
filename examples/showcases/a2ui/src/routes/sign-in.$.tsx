import { createFileRoute, redirect } from "@tanstack/react-router";
import { loadFeatures } from "../lib/features";
import { SignInPage } from "../components/SignInPage";

export const Route = createFileRoute("/sign-in/$")({
  // Stateless there is no sign-in; home is the whole desk.
  loader: async () => {
    if (!(await loadFeatures()).stateful) throw redirect({ to: "/" });
  },
  component: SignInPage,
});
