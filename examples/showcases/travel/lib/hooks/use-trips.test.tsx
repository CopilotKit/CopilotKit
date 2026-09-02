import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { defaultTrips } from "../types";
import type { AgentState } from "../types";

type SearchRenderer = (props: {
  name: string;
  toolCallId: string;
  parameters: { queries: string[] };
  status: "executing" | "complete";
  result: string | undefined;
}) => ReactElement;

const hookMocks = vi.hoisted(() => ({
  renderTool:
    vi.fn<
      (tool: { render: SearchRenderer }, dependencies: unknown[]) => void
    >(),
  setState: vi.fn(),
  useAgent: vi.fn(),
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: hookMocks.useAgent,
  useConfigureSuggestions: vi.fn(),
  useHumanInTheLoop: vi.fn(),
  useRenderTool: hookMocks.renderTool,
}));

vi.mock("@/components/SearchProgress", () => ({
  SearchProgress: ({
    progress,
  }: {
    progress: Array<{ query: string; done: boolean }>;
  }) => <div>{progress.map(({ query }) => query).join(", ")}</div>,
}));

import { TripsProvider, useTrips } from "./use-trips";

function renderTripsProvider(state: AgentState) {
  let tripsContext: ReturnType<typeof useTrips> | undefined;

  hookMocks.useAgent.mockReturnValue({
    agent: {
      state,
      setState: hookMocks.setState,
    },
    isReady: false,
  });

  function TripsContextReader() {
    tripsContext = useTrips();
    return null;
  }

  renderToStaticMarkup(
    <TripsProvider>
      <TripsContextReader />
    </TripsProvider>,
  );

  if (!tripsContext) {
    throw new Error("Trips context was not rendered");
  }

  return tripsContext;
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("shows current search progress only for the active tool call", () => {
  renderTripsProvider({
    trips: [],
    selected_trip_id: null,
    search_progress: [{ query: "current search", done: false }],
  });

  const renderSearch = hookMocks.renderTool.mock.calls[0]?.[0]?.render;
  if (!renderSearch) {
    throw new Error("Search tool was not registered");
  }
  const activeCall = renderToStaticMarkup(
    renderSearch({
      name: "search_for_places",
      toolCallId: "current-call",
      parameters: { queries: ["current search"] },
      status: "executing",
      result: undefined,
    }),
  );
  const historicalCall = renderToStaticMarkup(
    renderSearch({
      name: "search_for_places",
      toolCallId: "old-call",
      parameters: { queries: ["old search"] },
      status: "complete",
      result: "[]",
    }),
  );

  expect(activeCall).toContain("current search");
  expect(historicalCall).not.toContain("current search");
});

test("clears the selection when deleting the selected trip", () => {
  const trips = renderTripsProvider({
    trips: defaultTrips,
    selected_trip_id: defaultTrips[0].id,
  });

  trips.deleteTrip(defaultTrips[0].id);

  expect(hookMocks.setState).toHaveBeenCalledWith({
    trips: [defaultTrips[1]],
    selected_trip_id: null,
    search_progress: undefined,
  });
});

test("keeps the selection when deleting a different trip", () => {
  const trips = renderTripsProvider({
    trips: defaultTrips,
    selected_trip_id: defaultTrips[0].id,
  });

  trips.deleteTrip(defaultTrips[1].id);

  expect(hookMocks.setState).toHaveBeenCalledWith({
    trips: [defaultTrips[0]],
    selected_trip_id: defaultTrips[0].id,
    search_progress: undefined,
  });
});
