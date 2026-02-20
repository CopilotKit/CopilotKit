import { decode, ExtensionCodec } from "@msgpack/msgpack";

/**
 * Minimal interface for a PostgreSQL client.
 * Compatible with `pg.Pool`, `pg.Client`, and most PostgreSQL libraries.
 */
export interface PostgresClient {
  query(sql: string, params: any[]): Promise<{ rows: any[] }>;
}

// ---------------------------------------------------------------------------
// Msgpack Extension Codec
// ---------------------------------------------------------------------------
// LangGraph's JsonPlusSerializer uses ormsgpack Extension Types to encode
// Python objects. The type codes match langgraph/checkpoint/serde/jsonplus.py:
//
//   0  EXT_CONSTRUCTOR_SINGLE_ARG  → (module, name, single_arg)
//   1  EXT_CONSTRUCTOR_POS_ARGS   → (module, name, *pos_args)
//   2  EXT_CONSTRUCTOR_KW_ARGS    → (module, name, kwargs_dict)
//   3  EXT_METHOD_SINGLE_ARG      → (module, name, method, arg)
//   4  EXT_PYDANTIC_V1            → (module, name, kwargs_dict)
//   5  EXT_PYDANTIC_V2            → (module, name, model_dump_dict, method)
//
// We only need the plain dict/value on the JS side, so we extract kwargs.

const extensionCodec = new ExtensionCodec();
const noEncode = () => new Uint8Array(0);

// Types 0-2: extract third element (index 2)
for (const type of [0, 1, 2]) {
  extensionCodec.register({
    type,
    encode: noEncode,
    decode: (data: Uint8Array) => {
      const tup = decode(data, { extensionCodec }) as unknown[];
      return tup[2] ?? tup[1];
    },
  });
}

// Type 3: extract fourth element (index 3)
extensionCodec.register({
  type: 3,
  encode: noEncode,
  decode: (data: Uint8Array) => {
    const tup = decode(data, { extensionCodec }) as unknown[];
    return tup[3] ?? tup[2];
  },
});

// Types 4-5: extract third element (index 2)
for (const type of [4, 5]) {
  extensionCodec.register({
    type,
    encode: noEncode,
    decode: (data: Uint8Array) => {
      const tup = decode(data, { extensionCodec }) as unknown[];
      return tup[2] ?? tup[1];
    },
  });
}

function decodeMsgpack(buf: Buffer): unknown {
  return decode(buf, { extensionCodec });
}

// ---------------------------------------------------------------------------
// Load Thread State
// ---------------------------------------------------------------------------

/**
 * Query LangGraph's PostgreSQL checkpoint tables and reconstruct the thread's
 * channel_values (the agent state).
 *
 * Returns `null` when no checkpoint exists for the given `threadId`.
 */
export async function loadLangGraphPostgresState(
  threadId: string,
  client: PostgresClient,
): Promise<Record<string, unknown> | null> {
  const { rows } = await client.query(
    `SELECT
       checkpoint,
       (
         SELECT array_agg(array[bl.channel::bytea, bl.type::bytea, bl.blob])
         FROM jsonb_each_text(checkpoint -> 'channel_versions') cv
         INNER JOIN checkpoint_blobs bl
           ON bl.thread_id  = checkpoints.thread_id
          AND bl.checkpoint_ns = checkpoints.checkpoint_ns
          AND bl.channel     = cv.key
          AND bl.version     = cv.value
       ) AS channel_values
     FROM checkpoints
     WHERE thread_id = $1 AND checkpoint_ns = ''
     ORDER BY checkpoint_id DESC
     LIMIT 1`,
    [threadId],
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  const checkpoint = row.checkpoint as {
    channel_values?: Record<string, unknown>;
  };

  // Start with the inline primitives stored directly in the checkpoint JSONB.
  const state: Record<string, unknown> = {
    ...(checkpoint.channel_values ?? {}),
  };

  // Merge in the blob-stored channel values.
  const blobRows = row.channel_values as Buffer[][] | null;
  if (blobRows) {
    for (const triple of blobRows) {
      const channel = triple[0].toString("utf-8");
      const type = triple[1].toString("utf-8");
      const blob = triple[2];

      try {
        if (type === "msgpack" && blob) {
          state[channel] = decodeMsgpack(blob);
        } else if (type === "json" && blob) {
          state[channel] = JSON.parse(blob.toString("utf-8"));
        } else if (type === "bytes" && blob) {
          state[channel] = blob;
        }
        // "empty" / "null" / unknown types → skip
      } catch {
        // If a channel fails to decode, skip gracefully.
      }
    }
  }

  return state;
}
