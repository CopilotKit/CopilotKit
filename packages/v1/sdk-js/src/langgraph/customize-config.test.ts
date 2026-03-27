import { describe, it, expect } from "vitest";
import { copilotkitCustomizeConfig } from "./utils";

describe("copilotkitCustomizeConfig emit-raw-events", () => {
  it("sets both prefixed and unprefixed keys for emitRawEvents=false", () => {
    const config = copilotkitCustomizeConfig(
      { metadata: {} },
      { emitRawEvents: false },
    );
    expect(config.metadata["copilotkit:emit-raw-events"]).toBe(false);
    expect(config.metadata["emit-raw-events"]).toBe(false);
  });

  it("sets both prefixed and unprefixed keys for emitRawEvents=true", () => {
    const config = copilotkitCustomizeConfig(
      { metadata: {} },
      { emitRawEvents: true },
    );
    expect(config.metadata["copilotkit:emit-raw-events"]).toBe(true);
    expect(config.metadata["emit-raw-events"]).toBe(true);
  });

  it("sets both prefixed and unprefixed keys for emitRawEventData=false", () => {
    const config = copilotkitCustomizeConfig(
      { metadata: {} },
      { emitRawEventData: false },
    );
    expect(config.metadata["copilotkit:emit-raw-event-data"]).toBe(false);
    expect(config.metadata["emit-raw-event-data"]).toBe(false);
  });

  it("sets both prefixed and unprefixed keys for emitRawEventData=true", () => {
    const config = copilotkitCustomizeConfig(
      { metadata: {} },
      { emitRawEventData: true },
    );
    expect(config.metadata["copilotkit:emit-raw-event-data"]).toBe(true);
    expect(config.metadata["emit-raw-event-data"]).toBe(true);
  });

  it("does not set keys when params are omitted", () => {
    const config = copilotkitCustomizeConfig({ metadata: {} });
    expect(config.metadata["copilotkit:emit-raw-events"]).toBeUndefined();
    expect(config.metadata["emit-raw-events"]).toBeUndefined();
    expect(config.metadata["copilotkit:emit-raw-event-data"]).toBeUndefined();
    expect(config.metadata["emit-raw-event-data"]).toBeUndefined();
  });

  it("sets all keys when both flags are provided", () => {
    const config = copilotkitCustomizeConfig(
      { metadata: {} },
      { emitRawEvents: false, emitRawEventData: false },
    );
    expect(config.metadata["copilotkit:emit-raw-events"]).toBe(false);
    expect(config.metadata["emit-raw-events"]).toBe(false);
    expect(config.metadata["copilotkit:emit-raw-event-data"]).toBe(false);
    expect(config.metadata["emit-raw-event-data"]).toBe(false);
  });

  it("preserves existing metadata when adding new flags", () => {
    const config = copilotkitCustomizeConfig(
      { metadata: { "copilotkit:emit-messages": false } },
      { emitRawEvents: false },
    );
    expect(config.metadata["copilotkit:emit-messages"]).toBe(false);
    expect(config.metadata["copilotkit:emit-raw-events"]).toBe(false);
  });

  it("does not mutate the original baseConfig metadata", () => {
    const originalMetadata: Record<string, any> = {
      "copilotkit:emit-messages": true,
    };
    const baseConfig = { metadata: originalMetadata };
    copilotkitCustomizeConfig(baseConfig, { emitRawEvents: false });
    expect(originalMetadata["copilotkit:emit-raw-events"]).toBeUndefined();
    expect(originalMetadata["emit-raw-events"]).toBeUndefined();
  });

  it("handles base config with no metadata key", () => {
    const config = copilotkitCustomizeConfig({} as any, {
      emitRawEvents: false,
    });
    expect(config.metadata["copilotkit:emit-raw-events"]).toBe(false);
    expect(config.metadata["emit-raw-events"]).toBe(false);
  });

  it("skips keys when null is passed (same as omitted)", () => {
    const config = copilotkitCustomizeConfig(
      { metadata: {} },
      { emitRawEvents: null as any },
    );
    expect(config.metadata["copilotkit:emit-raw-events"]).toBeUndefined();
    expect(config.metadata["emit-raw-events"]).toBeUndefined();
  });
});
