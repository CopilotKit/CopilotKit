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
    <div>
      <h3 className="cr-heading mb-2">Endpoint</h3>
      <p
        className="mb-2 truncate text-[11px] text-[var(--cr-muted-2)]"
        style={{ fontFamily: "var(--cr-font-mono)" }}
        title={localState.currentEndpoint}
      >
        {localState.currentEndpoint}
      </p>
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          type="url"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="http://localhost:8000/"
          spellCheck={false}
          className="cr-input min-w-0 flex-1"
        />
        <button
          type="submit"
          disabled={draft.trim().length === 0}
          className="cr-btn"
          data-variant="primary"
        >
          Connect
        </button>
      </form>
      {error ? (
        <p
          className="mt-2 text-[10.5px] text-[var(--cr-red)]"
          role="alert"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
