import { createFileRoute } from "@tanstack/react-router";
import { SignInPage } from "../components/SignInPage";

export const Route = createFileRoute("/sign-up/$")({
  component: () => <SignInPage mode="sign-up" />,
});
