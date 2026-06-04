"use client";

/**
 * Connection-health indicator. Self-managed `HttpAgent` instances don't ship
 * AG-UI capability discovery, so this component probes the agent's `/health`
 * endpoint through Next.js and then reads `/features` when available. A 2xx
 * health response flips the pip to ONLINE; anything else leaves it CONNECTING
 * until the next poll.
 */

import { useEffect } from "react";

import { useControlRoomLocal } from "@/hooks/use-control-room-state";
import { CONTROL_ROOM_ENDPOINT_HEADER } from "@/lib/endpoint";

const HEALTH_POLL_MS = 4000;

export function ConnectionStatus() {
  const { localState, setFeatureSupport, recordConnection } =
    useControlRoomLocal();
  const { currentEndpoint, reconnectAttempts } = localState;

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const headers = { [CONTROL_ROOM_ENDPOINT_HEADER]: currentEndpoint };
        const res = await fetch("/api/agent/health", {
          method: "GET",
          cache: "no-store",
          headers,
        });
        if (cancelled) return;
        if (res.ok) {
          recordConnection("connected");
          const featuresRes = await fetch("/api/agent/features", {
            method: "GET",
            cache: "no-store",
            headers,
          });
          if (!cancelled && featuresRes.ok) {
            const payload = (await featuresRes.json()) as {
              native?: string[];
              live_wrappers?: string[];
            };
            setFeatureSupport({
              native: Array.isArray(payload.native) ? payload.native : [],
              live_wrappers: Array.isArray(payload.live_wrappers)
                ? payload.live_wrappers
                : [],
            });
          }
        } else {
          setFeatureSupport(null);
        }
      } catch {
        if (cancelled) return;
        setFeatureSupport(null);
      }
    };
    void probe();
    const id = window.setInterval(probe, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [currentEndpoint, reconnectAttempts, recordConnection, setFeatureSupport]);

  return null;
}
