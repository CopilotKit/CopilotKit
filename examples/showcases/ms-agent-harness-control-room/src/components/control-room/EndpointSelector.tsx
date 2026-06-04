"use client";

/**
 * Endpoint selector. Validates URLs client-side against the same allow-list
 * that gates the AG-UI client (localhost / 127.0.0.1 over http, anything over
 * https), then pushes the normalized endpoint into the control room state so
 * the cockpit's `selfManagedAgents` map rebuilds an `HttpAgent` pointed at the
 * new URL.
 */

import { useState } from "react";
import type { FormEvent } from "react";

import { useControlRoomLocal } from "@/hooks/use-control-room-state";
import { isAllowedEndpoint, normalizeEndpoint } from "@/lib/endpoint";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function EndpointSelector() {
  const { localState, setEndpoint } = useControlRoomLocal();
  const [draft, setDraft] = useState(localState.currentEndpoint);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!isAllowedEndpoint(draft)) {
      setError(
        "Only http://localhost / 127.0.0.1 and https:// remote endpoints are accepted.",
      );
      return;
    }
    const normalized = normalizeEndpoint(draft);
    setEndpoint(normalized);
    setDraft(normalized);
  };

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Endpoint</CardTitle>
        <CardDescription
          className="truncate"
          title={localState.currentEndpoint}
        >
          Current: {localState.currentEndpoint}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <form onSubmit={onSubmit} className="flex gap-2">
          <Input
            type="url"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="http://localhost:8000/"
            spellCheck={false}
            className="min-w-0 flex-1"
          />
          <Button type="submit" disabled={draft.trim().length === 0} size="sm">
            Connect
          </Button>
        </form>
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
