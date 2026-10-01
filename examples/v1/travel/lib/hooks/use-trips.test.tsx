/** @vitest-environment jsdom */

import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { expect, test, vi } from "vitest";
import { defaultTrips } from "../types";
import type { AgentState } from "../types";

type SearchRenderer = (props: {
  name: string;
  toolCallId: string;
  parameters: { queries: string[] };
  status: "executing" | "complete";
  result: string | undefined;
}) => ReactElement;

type DeleteRenderer = (props: {
  name: string;
  toolCallId: string;
  args: { trip_ids: string[] };
  status: "executing" | "complete";
  result: string | undefined;
  respond: ((result: unknown) => Promise<void>) | undefined;
}) => ReactElement;

type HumanInTheLoopTool = {
  name: string;
  render: DeleteRenderer;
};

const hookMocks = vi.hoisted(() => ({
  renderTool:
    vi.fn<
      (tool: { render: SearchRenderer }, dependencies: unknown[]) => void
    >(),
  humanInTheLoop:
    vi.fn<
      (tool: HumanInTheLoopTool, dependencies?: readonly unknown[]) => void
    >(),
  setState: vi.fn(),
  useAgent: vi.fn(),
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  ToolCallStatus: { Complete: "complete", Executing: "executing" },
  useAgent: hookMocks.useAgent,
  useConfigureSuggestions: vi.fn(),
  useHumanInTheLoop: hookMocks.humanInTheLoop,
  useRenderTool: hookMocks.renderTool,
}));

vi.mock("@/components/SearchProgress", () => ({
  SearchProgress: ({
    progress,
  }: {
    progress: Array<{ query: string; done: boolean }>;
  }) => <div>{progress.map(({ query }) => query).join(", ")}</div>,
}));

vi.mock("@/components/PlaceCard", () => ({
  PlaceCard: ({
    place,
  }: {
    place: {
      name: string;
      address: string;
      description: string | null;
    };
  }) => (
    <article aria-label={`${place.name} details`}>
      <h3>{place.name}</h3>
      <p>{place.address}</p>
      <p>{place.description}</p>
    </article>
  ),
}));

vi.mock("@/components/humanInTheLoop/ActionButtons", () => ({
  ActionButtons: () => (
    <div data-delete-trip-actions>
      <button type="button">Cancel</button>
      <button type="button">Delete</button>
    </div>
  ),
}));

import { TripsProvider, useTrips } from "./use-trips";

function renderTripsProvider(state: AgentState) {
  vi.clearAllMocks();
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

function setupMountedTripsProvider(initialState: AgentState) {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

  const providerContainer = document.createElement("div");
  const toolContainer = document.createElement("div");
  const providerRoot = createRoot(providerContainer);
  const toolRoot = createRoot(toolContainer);
  const agent = {
    state: initialState,
    setState: hookMocks.setState,
  };

  hookMocks.useAgent.mockImplementation(() => ({ agent, isReady: false }));

  function TripsContextReader() {
    useTrips();
    return null;
  }

  function renderProvider() {
    act(() => {
      providerRoot.render(
        <TripsProvider>
          <TripsContextReader />
        </TripsProvider>,
      );
    });
  }

  function getDeleteRenderer() {
    const registration = hookMocks.humanInTheLoop.mock.calls
      .map(([tool]) => tool)
      .filter(({ name }) => name === "delete_trips")
      .at(-1);

    if (!registration) {
      throw new Error("Delete trips tool was not registered");
    }

    return registration.render;
  }

  function renderDeleteTool({
    toolCallId,
    tripIds,
    status,
  }: {
    toolCallId: string;
    tripIds: string[];
    status: "executing" | "complete";
  }) {
    const DeleteToolRenderer = getDeleteRenderer();

    act(() => {
      toolRoot.render(
        <DeleteToolRenderer
          name="delete_trips"
          toolCallId={toolCallId}
          args={{ trip_ids: tripIds }}
          status={status}
          result={status === "complete" ? "SEND" : undefined}
          respond={status === "executing" ? async () => {} : undefined}
        />,
      );
    });

    return toolContainer.innerHTML;
  }

  renderProvider();

  return {
    renderDeleteTool,
    updateState(state: AgentState) {
      agent.state = state;
      renderProvider();
    },
    teardown() {
      act(() => {
        toolRoot.unmount();
        providerRoot.unmount();
      });
      Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    },
  };
}

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

test("keeps completed delete details after live agent state removes the trip", () => {
  const trip = defaultTrips[0];
  const setup = setupMountedTripsProvider({
    trips: [trip],
    selected_trip_id: trip.id,
  });

  try {
    const executingCall = setup.renderDeleteTool({
      toolCallId: "delete-trip",
      tripIds: [trip.id],
      status: "executing",
    });

    expect(executingCall).toContain("data-delete-trip-actions");
    expect(executingCall).toContain(">Delete</button>");
    expect(executingCall).toContain(">Cancel</button>");

    setup.updateState({ trips: [], selected_trip_id: null });

    const completedCall = setup.renderDeleteTool({
      toolCallId: "delete-trip",
      tripIds: [trip.id],
      status: "complete",
    });

    expect(completedCall).toContain(trip.name);
    expect(completedCall).toContain(trip.places[0].name);
    expect(completedCall).toContain(trip.places[0].address);
    expect(completedCall).toContain(trip.places[0].description);
    expect(completedCall).not.toContain("data-delete-trip-actions");
    expect(completedCall).not.toContain(">Delete</button>");
    expect(completedCall).not.toContain(">Cancel</button>");
  } finally {
    setup.teardown();
  }
});

test("keeps concurrent delete-call snapshots isolated by tool call ID", () => {
  const firstTrip = defaultTrips[0];
  const secondTrip = defaultTrips[1];
  const setup = setupMountedTripsProvider({
    trips: [firstTrip, secondTrip],
    selected_trip_id: firstTrip.id,
  });

  try {
    setup.renderDeleteTool({
      toolCallId: "delete-first-trip",
      tripIds: [firstTrip.id],
      status: "executing",
    });
    setup.renderDeleteTool({
      toolCallId: "delete-second-trip",
      tripIds: [secondTrip.id],
      status: "executing",
    });
    setup.updateState({ trips: [], selected_trip_id: null });

    const completedFirstCall = setup.renderDeleteTool({
      toolCallId: "delete-first-trip",
      tripIds: [firstTrip.id],
      status: "complete",
    });
    const completedSecondCall = setup.renderDeleteTool({
      toolCallId: "delete-second-trip",
      tripIds: [secondTrip.id],
      status: "complete",
    });

    expect(completedFirstCall).toContain(firstTrip.name);
    expect(completedFirstCall).not.toContain(secondTrip.name);
    expect(completedSecondCall).toContain(secondTrip.name);
    expect(completedSecondCall).not.toContain(firstTrip.name);
  } finally {
    setup.teardown();
  }
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
