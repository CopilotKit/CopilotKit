import { Check, LoaderCircle } from "lucide-react";
import { DESK_APPS, appIcon } from "../lib/apps";
import { useConnections } from "../lib/connections";

/**
 * The reader's Google apps. Connecting one goes through Google's own sign-in
 * (via Composio) and comes back here; from then on the agent can act in it.
 */
export function ConnectionsPage() {
  const { signedIn, connections, loading, error, busy, connect, disconnect } =
    useConnections();
  const byApp = new Map(connections.map((c) => [c.app, c]));

  return (
    <div className="connections">
      <div className="connections__inner">
        <p className="connections__lede">
          Connect your Google apps and the agent can work in them for you. It
          shows you what it will send, create or change, and waits for your yes.
        </p>

        {!signedIn && (
          <div className="connections__sign-in">
            <p>Sign in to connect your apps.</p>
            <a className="connection__button" href="/sign-in">
              Sign in
            </a>
          </div>
        )}

        {error && (
          <p className="connections__error" role="alert">
            {error}
          </p>
        )}

        <ul className="connections__list" aria-busy={loading || undefined}>
          {DESK_APPS.map((app) => {
            const connection = byApp.get(app.id);
            const status = connection?.status ?? "none";
            const working = busy === app.id;
            return (
              <li key={app.id} className="connection" data-status={status}>
                <img
                  className="connection__icon"
                  src={appIcon(app)}
                  alt=""
                  width={28}
                  height={28}
                />
                <div className="connection__text">
                  <h3>{app.name}</h3>
                  <p>{app.can}</p>
                </div>
                {signedIn && (
                  <div className="connection__state">
                    {status === "connected" && (
                      <span className="connection__account">
                        <Check size={14} strokeWidth={2.25} aria-hidden />
                        {connection?.account ?? "Connected"}
                      </span>
                    )}
                    {status === "pending" && (
                      <span className="connection__account">
                        Finishing sign-in
                      </span>
                    )}
                    {status === "connected" ? (
                      <button
                        type="button"
                        className="connection__button connection__button--quiet"
                        disabled={working || loading}
                        onClick={() => void disconnect(app.id)}
                        aria-label={`Disconnect ${app.name}`}
                      >
                        {working ? "Disconnecting…" : "Disconnect"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="connection__button"
                        disabled={
                          working ||
                          loading ||
                          Boolean(error && !connections.length)
                        }
                        onClick={() => void connect(app.id)}
                        aria-label={`Connect ${app.name}`}
                      >
                        {working && (
                          <LoaderCircle
                            className="connection__spinner"
                            size={14}
                            aria-hidden
                          />
                        )}
                        Connect
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
