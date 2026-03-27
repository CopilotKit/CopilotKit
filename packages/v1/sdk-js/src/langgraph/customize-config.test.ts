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
});
