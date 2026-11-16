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
import { DEMO_TOKEN } from "@/lib/demo-auth";

interface SignInCardProps {
  onSignIn: () => void;
}

/**
 * The signed-out landing card of the auth demo. It shows the demo bearer
 * token in plain text, so visitors see exactly what the `Authorization`
 * header carries. There is no form, because the runtime accepts only this
 * one token. Signing in makes the page mount `<CopilotKit>`.
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
            onClick={onSignIn}
          >
            Sign in with demo token
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
