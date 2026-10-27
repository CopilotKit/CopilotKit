import { useAgentContext } from "@copilotkit/react-core/v2";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { DESK_APPS } from "./apps";

/** One app's connection, as `/api/connections` reports it. */
export interface Connection {
  app: string;
  status: "connected" | "pending" | "none";
  /** The account it is connected as, when Composio knows it. */
  account?: string;
}

interface ConnectionsState {
  /** Only a signed-in reader can connect apps. */
  signedIn: boolean;
  connections: Connection[];
  loading: boolean;
  /** Why the list could not load (for example, Composio is not set up). */
  error: string | null;
  /** The app whose connect or disconnect is in flight. */
  busy: string | null;
  connect: (app: string) => Promise<void>;
  disconnect: (app: string) => Promise<void>;
}

const ConnectionsContext = createContext<ConnectionsState | null>(null);

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // Not JSON; fall through to the status.
  }
  return `The server answered ${response.status}.`;
}

/**
 * The reader's connected apps, for the Connections page and for the agent,
 * which is told on every run what it can act in.
 */
export function ConnectionsProvider({
  signedIn,
  children,
}: {
  signedIn: boolean;
  children: ReactNode;
}) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(signedIn);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/connections");
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as { connections: Connection[] };
      setConnections(body.connections);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void refresh();
    // A connection finishes in another tab or after a redirect back here;
    // check again whenever the reader returns to the page.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh, signedIn]);

  const connect = useCallback(async (app: string) => {
    setBusy(app);
    try {
      const response = await fetch("/api/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const { redirectUrl } = (await response.json()) as {
        redirectUrl: string;
      };
      // Google's sign-in, through Composio; it comes back to Connections.
      window.location.assign(redirectUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(null);
    }
  }, []);

  const disconnect = useCallback(
    async (app: string) => {
      setBusy(app);
      try {
        const response = await fetch(
          `/api/connections?app=${encodeURIComponent(app)}`,
          { method: "DELETE" },
        );
        if (!response.ok) throw new Error(await readError(response));
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const value = useMemo(
    () => ({
      signedIn,
      connections,
      loading,
      error,
      busy,
      connect,
      disconnect,
    }),
    [signedIn, connections, loading, error, busy, connect, disconnect],
  );
  return (
    <ConnectionsContext.Provider value={value}>
      <ConnectedAppsContext signedIn={signedIn} connections={connections} />
      {children}
    </ConnectionsContext.Provider>
  );
}

export function useConnections() {
  const state = useContext(ConnectionsContext);
  if (!state) throw new Error("useConnections needs a ConnectionsProvider");
  return state;
}

/** Tells the agent which apps it can act in, and which it cannot yet. */
function ConnectedAppsContext({
  signedIn,
  connections,
}: {
  signedIn: boolean;
  connections: Connection[];
}) {
  const connected = new Set(
    connections.filter((c) => c.status === "connected").map((c) => c.app),
  );
  const names = (want: boolean) =>
    DESK_APPS.filter((app) => connected.has(app.id) === want)
      .map((app) => app.name)
      .join(", ") || "none";
  useAgentContext({
    description: "The reader's connected apps",
    value: signedIn
      ? `Connected, so you can act in them with their tools: ${names(true)}. ` +
        `Not connected: ${names(false)}. When the reader asks for something in ` +
        "an app that is not connected, say so and point them to Connections " +
        "at the foot of the thread list."
      : "None: the reader is not signed in, so no apps can be connected. " +
        "When they ask for something in their own mail, calendar or files, " +
        "say that signing in (at the foot of the thread list) lets them " +
        "connect their Google apps.",
  });
  return null;
}
