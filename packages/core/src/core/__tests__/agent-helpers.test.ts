import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";
import { describe, expect, it } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "../../agent";
import {
  ɵgetAgentCapabilities,
  ɵserializeContextValue,
} from "../agent-helpers";
import { ɵbuildLearnFromUserActionPayload } from "../record-annotation";

class PlainAgent extends AbstractAgent {
  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>();
  }
}

describe("ɵserializeContextValue", () => {
  it("keeps a string as-is", () => {
    expect(ɵserializeContextValue("plain text")).toBe("plain text");
  });

  it("sends any other JSON value as its JSON text", () => {
    expect(ɵserializeContextValue({ a: [1, null] })).toBe('{"a":[1,null]}');
    expect(ɵserializeContextValue(42)).toBe("42");
    expect(ɵserializeContextValue(null)).toBe("null");
  });

  it("takes interface-typed values and optional fields, like v1 readables", () => {
    interface Task {
      title: string;
      note?: string;
    }
    const tasks: Task[] = [{ title: "Ship", note: undefined }];
    expect(ɵserializeContextValue(tasks)).toBe('[{"title":"Ship"}]');
  });

  it("always returns a string, even for a value JSON has no text for", () => {
    expect(ɵserializeContextValue(undefined)).toBe("undefined");
  });
});

describe("ɵgetAgentCapabilities", () => {
  it("returns the capabilities a runtime agent declares", () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.local",
      agentId: "a",
      capabilities: { tools: { supported: true } },
    });

    expect(ɵgetAgentCapabilities(agent)).toEqual({
      tools: { supported: true },
    });
  });

  it("returns undefined for an agent without capabilities", () => {
    expect(ɵgetAgentCapabilities(new PlainAgent())).toBeUndefined();
  });

  it("returns undefined while there is no agent", () => {
    expect(ɵgetAgentCapabilities(null)).toBeUndefined();
  });
});

describe("ɵbuildLearnFromUserActionPayload", () => {
  it("keeps only the fields the caller set, including null", () => {
    expect(
      ɵbuildLearnFromUserActionPayload({
        title: "Renamed",
        description: null,
        data: { next: "b" },
      }),
    ).toEqual({ title: "Renamed", description: null, data: { next: "b" } });
    expect(ɵbuildLearnFromUserActionPayload({ title: "Only title" })).toEqual({
      title: "Only title",
    });
  });

  it("returns undefined when no field is set", () => {
    expect(ɵbuildLearnFromUserActionPayload({})).toBeUndefined();
  });
});
