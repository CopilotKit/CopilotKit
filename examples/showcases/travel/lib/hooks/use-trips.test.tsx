import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, expect, test, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  renderTool: vi.fn(),
  setState: vi.fn(),
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: () => ({
    agent: {
      state: {
        trips: [],
        selected_trip_id: null,
        search_progress: [{ query: "current search", done: false }],
      },
      setState: hookMocks.setState,
    },
    isReady: false,
  }),
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

import { TripsProvider } from "./use-trips";

type SearchRenderer = (props: {
  name: string;
  toolCallId: string;
  parameters: { queries: string[] };
  status: "executing" | "complete";
  result: string | undefined;
}) => ReactElement;

beforeEach(() => {
  hookMocks.renderTool.mockClear();
  hookMocks.setState.mockClear();
});

test("shows current search progress only for the active tool call", () => {
  renderToStaticMarkup(
    <TripsProvider>
      <span>Trips</span>
    </TripsProvider>,
  );

  const renderSearch = hookMocks.renderTool.mock.calls[0]?.[0]
    ?.render as SearchRenderer;
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
