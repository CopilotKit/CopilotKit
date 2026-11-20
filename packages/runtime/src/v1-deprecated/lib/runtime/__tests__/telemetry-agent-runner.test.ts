import { describe, expect, it, vi } from "vitest";
import { lastValueFrom, throwError } from "rxjs";
import type { AgentRunner } from "../../../../v2/runtime/runner";
import { TelemetryAgentRunner } from "../telemetry-agent-runner";

describe("TelemetryAgentRunner", () => {
  it("reports a failed stream with a fixed code, not the error message", async () => {
    const capture = vi.fn();
    const runner = {
      run: () => throwError(() => new Error("401 from https://llm.internal")),
    } as unknown as AgentRunner;
    const telemetryRunner = new TelemetryAgentRunner({
      runner,
      telemetry: { capture },
    });

    await expect(
      lastValueFrom(
        telemetryRunner.run(
          ...([{}] as unknown as Parameters<AgentRunner["run"]>),
        ),
      ),
    ).rejects.toThrow("401 from https://llm.internal");

    expect(capture).toHaveBeenCalledWith(
      "oss.runtime.agent_execution_stream_errored",
      expect.objectContaining({ error: "AGENT_EXECUTION_FAILED" }),
    );
    // The message can quote prompts, arguments or URLs; it never reaches analytics.
    expect(JSON.stringify(capture.mock.calls)).not.toContain("llm.internal");
  });
});
