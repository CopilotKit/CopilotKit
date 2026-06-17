// Docs-only snippet — not imported or rendered. built-in-agent's
// tool-rendering production demo at page.tsx exercises only the
// `weather` renderer; the docs page at /generative-ui/tool-rendering
// also teaches the per-tool flight pattern. This file shows what the
// flight renderer would look like in the same built-in-agent shape, so
// the docs can render real teaching code rather than a missing-snippet
// box.
//
// See chat-component.snippet.tsx in agentic-chat for the same pattern.

// @region[render-flight-tool]
import { useComponent } from "@copilotkit/react-core/v2";

declare const FlightListCard: React.ComponentType<{
  loading: boolean;
  origin: string;
  destination: string;
  flights: unknown[];
}>;

type FlightToolProps = {
  status: string;
  args?: { origin?: string; destination?: string };
  result?: { origin?: string; destination?: string; flights?: unknown[] };
};

export function FlightToolRenderer() {
  // Per-tool renderer: search_flights → branded FlightListCard.
  useComponent({
    name: "search_flights",
    render: (props: FlightToolProps) => {
      const { status, args, result } = props;
      const loading = status !== "complete";
      return (
        <FlightListCard
          loading={loading}
          origin={args?.origin ?? result?.origin ?? ""}
          destination={args?.destination ?? result?.destination ?? ""}
          flights={result?.flights ?? []}
        />
      );
    },
  });
  // @endregion[render-flight-tool]
}
