import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { act } from "react";
import type { ComponentType } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
type MeetingTimePickerProps = {
  status: "inProgress" | "executing" | "complete";
  result?: string;
  respond?: (response: string) => void;
  reasonForScheduling?: string;
  meetingDuration?: number;
};

// Discover every framework so future copies receive the same replay contract.
const integrations = pathToFileURL(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../integrations") +
    "/",
);
const cardPath =
  "src/app/demos/beautiful-chat/components/generative-ui/meeting-time-picker.tsx";
const frameworks = readdirSync(integrations).filter((slug) =>
  existsSync(new URL(slug + "/" + cardPath, integrations)),
);
const accepted = "Meeting scheduled for Tomorrow at 2:00 PM (45 min).";
const declined =
  "The user declined all proposed meeting times. Please suggest alternative times or ask for their availability.";

for (const slug of frameworks) {
  describe(slug, () => {
    const cardUrl = new URL(slug + "/" + cardPath, integrations);
    let MeetingTimePicker: ComponentType<MeetingTimePickerProps>;
    beforeAll(async () => {
      ({ MeetingTimePicker } = await import(
        /* @vite-ignore */ cardUrl.pathname
      ));
    });
    let container: HTMLDivElement;
    let root: Root;
    const render = (props: MeetingTimePickerProps) =>
      act(() => root.render(<MeetingTimePicker {...props} />));
    beforeEach(() => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    });
    afterEach(() => {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    });

    it.each([accepted, declined])(
      "replays plain and enveloped decisions after remount: %s",
      (response) => {
        for (const result of [response, JSON.stringify({ result: response })]) {
          render({ status: "complete", result });
          expect(container.textContent).toContain(
            response === declined ? "No Time Selected" : "Meeting Scheduled",
          );
          expect(container.textContent).toContain(response);
          expect(container.textContent).not.toContain("Pick a time");
          expect(container.querySelector("button")).toBeNull();
          act(() => root.unmount());
          root = createRoot(container);
        }
      },
    );

    it.each(["accept", "decline"])(
      "preserves pending %s and replays its response on a new mount",
      (decision) => {
        const respond = vi.fn();
        render({ status: "inProgress", respond });
        expect(container.textContent).toContain("Finding available times");
        expect(container.querySelector("button")).toBeNull();
        render({
          status: "executing",
          respond,
          reasonForScheduling: "Project review",
          meetingDuration: 45,
        });
        expect(container.textContent).toContain("Project review");
        const buttons = container.querySelectorAll("button");
        expect(buttons).toHaveLength(4);
        act(() => buttons[decision === "accept" ? 0 : 3].click());
        const response = decision === "accept" ? accepted : declined;
        expect(respond).toHaveBeenCalledExactlyOnceWith(response);
        expect(container.textContent).toContain(
          decision === "accept" ? "Meeting Scheduled" : "No Time Selected",
        );
        act(() => root.unmount());
        root = createRoot(container);
        render({
          status: "complete",
          result: JSON.stringify({ result: response }),
        });
        expect(container.textContent).toContain(response);
        expect(container.querySelector("button")).toBeNull();
      },
    );

    it("passes persisted results through the scheduleTime renderer", () => {
      const hook = readFileSync(
        new URL(
          cardUrl.href.replace(
            "components/generative-ui/meeting-time-picker.tsx",
            "hooks/use-generative-ui-examples.tsx",
          ),
          import.meta.url,
        ),
        "utf8",
      );
      expect(hook).toMatch(/render: \(\{ respond, status, args, result \}\)/);
      expect(hook).toContain("result={result}");
      expect(hook).toContain("{...args}");
      expect(hook).toMatch(/reasonForScheduling: z\s*\.string\(\)/);
      expect(hook).toMatch(/meetingDuration: z\s*\.number\(\)/);
    });
  });
}
