"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// localStorage keys (browser-only "memory"). The <CopilotKit headers> function
// in layout.tsx reads URL_KEY + TOKEN_KEY when the PROVIDER renders (which is
// why connect()/skip() reload — see finish()); DISMISSED_KEY just records that
// the gate was answered so it doesn't reappear.
const URL_KEY = "openclaw_gateway_url";
const TOKEN_KEY = "openclaw_gateway_token";
const DISMISSED_KEY = "openclaw_gate_dismissed";

// localStorage can throw (private mode / sandboxed iframe / blocked cookies).
// Degrade gracefully: reads return null, writes silently no-op — so the demo
// still renders and runs, settings just won't persist.
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string | null): boolean {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
    return true;
  } catch {
    // storage unavailable — settings can't persist this session
    return false;
  }
}

// A non-empty gateway URL must be a full http(s) URL. We validate here (not just
// in the runtime) so a scheme-less value like "test.com" gives immediate
// feedback instead of silently falling back to the default gateway.
function isValidHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

type Phase = "loading" | "gate" | "ready";

/**
 * Optional pre-chat gate: collects the OpenClaw gateway URL and operator token
 * into localStorage. Both are OPTIONAL — leave them blank to use the demo's
 * default gateway, or if your gateway doesn't require auth. Once connected or
 * skipped, renders `children` (the chat). The "Gateway settings" control
 * re-opens the gate pre-filled to edit; "Use demo default" clears both values.
 */
export function TokenGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [urlError, setUrlError] = useState("");

  // localStorage is browser-only; read it AFTER mount to stay SSR-safe.
  useEffect(() => {
    const storedUrl = readStored(URL_KEY);
    const storedToken = readStored(TOKEN_KEY);
    const dismissed = readStored(DISMISSED_KEY);
    if (storedUrl) setUrl(storedUrl);
    if (storedToken) setToken(storedToken);
    setPhase(storedUrl || storedToken || dismissed ? "ready" : "gate");
  }, []);

  // Leave the gate for the chat. The <CopilotKit headers> function reads
  // localStorage when the PROVIDER renders — a state change in this child alone
  // won't re-run it — so when settings persisted we reload to apply them. When
  // storage is blocked nothing could persist and a reload would loop straight
  // back to the gate, so we switch to the chat in-place (the runtime then uses
  // its default gateway).
  const finish = (persisted: boolean) => {
    if (persisted) window.location.reload();
    else setPhase("ready");
  };

  const connect = () => {
    const trimmedUrl = url.trim();
    const trimmedToken = token.trim();
    // Reject a non-empty, non-http(s) URL up front (empty = use the default).
    if (trimmedUrl && !isValidHttpUrl(trimmedUrl)) {
      setUrlError(
        "Enter a full http(s) URL, e.g. http://localhost:8000/v1/clawg-ui/operator",
      );
      return;
    }
    writeStored(URL_KEY, trimmedUrl || null);
    writeStored(TOKEN_KEY, trimmedToken || null);
    finish(writeStored(DISMISSED_KEY, "1"));
  };

  // "Use demo default": drop any custom URL + token and use the built-in default.
  const skip = () => {
    writeStored(URL_KEY, null);
    writeStored(TOKEN_KEY, null);
    finish(writeStored(DISMISSED_KEY, "1"));
  };

  // "Gateway settings": re-open the gate PRE-FILLED with the current values (the
  // `url`/`token` state already holds them from mount) so they can be edited —
  // nothing is deleted until the user re-submits or picks "Use demo default".
  const reset = () => {
    setUrlError("");
    setPhase("gate");
  };

  if (phase === "loading") return null;

  if (phase === "gate") {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-[var(--foreground)]">
            Connect to your OpenClaw gateway
          </h1>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Point the demo at your gateway&apos;s clawg-ui operator route and,
            if it requires auth, its operator token. Both are optional and
            stored only in this browser — leave them blank to use the demo
            default.
          </p>
          <Input
            type="url"
            placeholder="http://localhost:8000/v1/clawg-ui/operator"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (urlError) setUrlError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && connect()}
            className="mt-4"
            aria-invalid={urlError ? true : undefined}
          />
          {urlError && (
            <p className="mt-1.5 text-xs text-red-500">{urlError}</p>
          )}
          <Input
            type="password"
            placeholder="Operator token (optional)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && connect()}
            className="mt-3"
          />
          <div className="mt-4 flex gap-2">
            <Button onClick={connect} className="flex-1">
              Connect
            </Button>
            <Button onClick={skip} variant="outline" className="flex-1">
              Use demo default
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <button
        onClick={reset}
        className="absolute right-3 top-3 z-10 text-xs text-[var(--muted-foreground)] underline"
      >
        Gateway settings
      </button>
      {children}
    </div>
  );
}
