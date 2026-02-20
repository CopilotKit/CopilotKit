import { vi } from "vitest";
import { encode, ExtensionCodec } from "@msgpack/msgpack";
import { loadLangGraphPostgresState, type PostgresClient } from "./load-state";

// Helper: encode a value using LangGraph's EXT_PYDANTIC_V2 format (type 5)
// Tuple: [module, name, model_dump_dict, method]
function encodePydanticV2(value: Record<string, unknown>): Buffer {
  const codec = new ExtensionCodec();
  codec.register({
    type: 5,
    encode: (obj: unknown) => {
      if (typeof obj === "object" && obj !== null && "__pydantic_v2__" in obj) {
        return encode((obj as any).data);
      }
      return null;
    },
    decode: () => null,
  });

  const tuple = [
    "langchain_core.messages.human",
    "HumanMessage",
    value,
    "model_validate",
  ];
  // Encode the tuple as raw msgpack, then wrap in ext type 5
  const innerBytes = encode(tuple);
  // Build ext format manually: encode with the extension codec
  const extCodec = new ExtensionCodec();
  extCodec.register({
    type: 5,
    encode: (obj: unknown) => {
      if (Array.isArray(obj) && (obj as any).__ext5__) {
        return encode(obj);
      }
      return null;
    },
    decode: () => null,
  });

  // Simpler approach: just encode the raw msgpack bytes as the extension payload
  return Buffer.from(encode(tuple));
}

// Helper: build a msgpack blob that our utility should decode
function buildMsgpackBlob(value: unknown): Buffer {
  return Buffer.from(encode(value));
}

function createMockClient(rows: any[] = []): PostgresClient {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  };
}

describe("loadLangGraphPostgresState", () => {
  it("returns null when no checkpoint rows exist", async () => {
    const client = createMockClient([]);
    const result = await loadLangGraphPostgresState("thread-1", client);
    expect(result).toBeNull();
  });

  it("passes threadId as query parameter", async () => {
    const client = createMockClient([]);
    await loadLangGraphPostgresState("my-thread-id", client);

    expect(client.query).toHaveBeenCalledWith(expect.any(String), [
      "my-thread-id",
    ]);
  });

  it("returns inline channel_values from checkpoint JSON", async () => {
    const client = createMockClient([
      {
        checkpoint: { channel_values: { counter: 42 } },
        channel_values: null,
      },
    ]);

    const result = await loadLangGraphPostgresState("thread-1", client);
    expect(result).toEqual({ counter: 42 });
  });

  it("decodes msgpack blobs from channel_values", async () => {
    const msgpackBlob = buildMsgpackBlob([
      { id: "msg-1", type: "human", content: "Hello" },
    ]);

    const client = createMockClient([
      {
        checkpoint: { channel_values: {} },
        channel_values: [
          [Buffer.from("messages"), Buffer.from("msgpack"), msgpackBlob],
        ],
      },
    ]);

    const result = await loadLangGraphPostgresState("thread-1", client);
    expect(result).toMatchObject({
      messages: [{ id: "msg-1", type: "human", content: "Hello" }],
    });
  });

  it("decodes JSON blobs from channel_values", async () => {
    const jsonBlob = Buffer.from(JSON.stringify({ key: "value" }));

    const client = createMockClient([
      {
        checkpoint: { channel_values: {} },
        channel_values: [
          [Buffer.from("metadata"), Buffer.from("json"), jsonBlob],
        ],
      },
    ]);

    const result = await loadLangGraphPostgresState("thread-1", client);
    expect(result).toMatchObject({ metadata: { key: "value" } });
  });

  it("merges blob channels over inline channel_values", async () => {
    const msgpackBlob = buildMsgpackBlob("overridden");

    const client = createMockClient([
      {
        checkpoint: { channel_values: { myChannel: "inline" } },
        channel_values: [
          [Buffer.from("myChannel"), Buffer.from("msgpack"), msgpackBlob],
        ],
      },
    ]);

    const result = await loadLangGraphPostgresState("thread-1", client);
    expect(result!.myChannel).toBe("overridden");
  });

  it("skips channels with unknown blob types gracefully", async () => {
    const client = createMockClient([
      {
        checkpoint: { channel_values: { good: "data" } },
        channel_values: [
          [
            Buffer.from("pickled"),
            Buffer.from("pickle"),
            Buffer.from("opaque"),
          ],
        ],
      },
    ]);

    const result = await loadLangGraphPostgresState("thread-1", client);
    expect(result).toEqual({ good: "data" });
    // "pickled" channel should not appear since pickle type is unknown
    expect(result).not.toHaveProperty("pickled");
  });

  it("handles empty checkpoint channel_values", async () => {
    const client = createMockClient([
      {
        checkpoint: {},
        channel_values: null,
      },
    ]);

    const result = await loadLangGraphPostgresState("thread-1", client);
    expect(result).toEqual({});
  });
});
