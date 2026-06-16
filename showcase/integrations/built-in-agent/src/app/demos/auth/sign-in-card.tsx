"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DEMO_TOKEN } from "./demo-token";

interface SignInCardProps {
  onSignIn: (token: string) => void;
}

/**
 * Unauthenticated landing card for the auth demo. Surfaces the demo bearer
 * token in plain text so visitors can see exactly what gets sent on the
 * `Authorization` header — there's no real form because the value is fixed
 * by the runtime gate. Clicking "Sign in" stores the token via
 * `useDemoAuth()`, which causes the parent to mount `<CopilotKit>`.
 */
export function SignInCard({ onSignIn }: SignInCardProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card data-testid="auth-sign-in-card" className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in to start chatting</CardTitle>
          <CardDescription>
            The runtime rejects requests without an{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              Authorization
            </code>{" "}
            header. Sign in below to mount the chat with a demo bearer token
            attached.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Demo token
            </p>
            <code
              data-testid="auth-demo-token"
              className="mt-1 block rounded-md border bg-muted px-3 py-2 font-mono text-sm"
            >
              {DEMO_TOKEN}
            </code>
          </div>
          <p className="text-xs text-muted-foreground">
            Real apps should issue per-user tokens via your identity provider
            and never hard-code shared secrets.
          </p>
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            data-testid="auth-sign-in-button"
            className="w-full"
            onClick={() => onSignIn(DEMO_TOKEN)}
          >
            Sign in with demo token
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
