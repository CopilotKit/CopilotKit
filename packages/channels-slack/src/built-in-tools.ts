/**
 * Slack-platform-universal frontend tools — tools every Slack bot
 * benefits from, regardless of what the bot does. Apps spread
 * `defaultSlackTools` into the `tools:` config they pass to
 * `createChannel`.
 */
import { defineChannelTool } from "@copilotkit/channels-core";
import type { ChannelTool } from "@copilotkit/channels-core";
import type {
  StandardSchemaV1,
  StandardJSONSchemaV1,
} from "@copilotkit/shared";

/**
 * Validated arguments of the `lookup_slack_user` tool.
 *
 * Declared as a type alias, not an interface: `defineChannelTool` bounds its
 * schema by `ObjectSchema` (output `Record<string, unknown>`), and only a
 * type alias picks up the implicit index signature that assignment needs.
 */
type LookupArgs = {
  query: string;
};

/**
 * JSON Schema handed to the agent for `lookup_slack_user`.
 *
 * This is byte-for-byte what `zod-to-json-schema` emitted for the Zod
 * object this schema replaces, so the descriptor the model sees does not
 * change. The body is target-agnostic — `type`, `properties`, `required`,
 * `minLength`, and `additionalProperties` mean the same thing in draft-07
 * and draft-2020-12 — so one document serves every target a caller asks
 * for, and `$schema` keeps the draft-07 value the previous output carried.
 */
const LOOKUP_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    query: {
      type: "string",
      minLength: 1,
      description:
        "Handle, display name, first name, or email of the person to look up.",
    },
  },
  required: ["query"],
  additionalProperties: false,
  $schema: "http://json-schema.org/draft-07/schema#",
};

/**
 * Validate `lookup_slack_user` arguments.
 *
 * Mirrors the Zod object this replaces: `query` is a required string of at
 * least one character, and unknown keys are stripped rather than rejected
 * (Zod's default `strip` behavior for `z.object`). The returned issues feed
 * `validateSchema`, which formats them as `path: message` for the agent.
 */
function validateLookupArgs(
  value: unknown,
): StandardSchemaV1.Result<LookupArgs> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      issues: [{ message: "Expected object, received " + typeof value }],
    };
  }
  const { query } = value as Record<string, unknown>;
  if (typeof query !== "string") {
    return {
      issues: [
        {
          message:
            "Expected string, received " +
            (query === undefined ? "undefined" : typeof query),
          path: ["query"],
        },
      ],
    };
  }
  if (query.length < 1) {
    return {
      issues: [
        {
          message: "String must contain at least 1 character(s)",
          path: ["query"],
        },
      ],
    };
  }
  return { value: { query } };
}

/**
 * Parameter schema for `lookup_slack_user`, written directly against the
 * [Standard Schema](https://standardschema.dev) protocol.
 *
 * `defineChannelTool` accepts any Standard Schema, and `toJsonSchema()`
 * reads `~standard.jsonSchema.input()` in preference to every other path,
 * so this one small object is all a tool needs. Building it with Zod
 * instead put a `zod` range into `@copilotkit/channels-slack`, and from
 * there into every app that installs `@copilotkit/runtime` — where it
 * collided with the exact `zod` version `@microsoft/agents-*` pins and made
 * npm install zod twice (OSS-1173). One dependency for one object literal
 * was not a trade worth keeping.
 */
const lookupSchema: StandardSchemaV1<unknown, LookupArgs> &
  StandardJSONSchemaV1<unknown, LookupArgs> = {
  "~standard": {
    version: 1,
    vendor: "@copilotkit/channels-slack",
    validate: validateLookupArgs,
    jsonSchema: {
      input: () => LOOKUP_JSON_SCHEMA,
      output: () => LOOKUP_JSON_SCHEMA,
    },
  },
};

export const lookupSlackUserTool = defineChannelTool({
  name: "lookup_slack_user",
  description:
    "Resolve a person to a Slack user ID so you can @-mention them. " +
    "Accepts a handle (`atai`), display name (`Atai Barkai`), first name, " +
    "or email. Returns an object with `found`, and on success a " +
    "`mention` string (e.g. `<@U0B45V75NNR>`) — put that string verbatim " +
    "in your reply to ping them. If `found` is false, write the plain " +
    "name instead.",
  parameters: lookupSchema,
  async handler({ query }, { thread }) {
    const u = await thread.lookupUser(query);
    return u
      ? {
          found: true,
          query,
          userId: u.id,
          name: u.name,
          handle: u.handle,
          email: u.email,
          mention: `<@${u.id}>`,
        }
      : { found: false, query };
  },
});

/**
 * The flat list of tools the SDK ships. Spread into your
 * `createChannel({tools: …})`:
 *
 *     tools: [...defaultSlackTools, ...myAppTools],
 */
export const defaultSlackTools: ReadonlyArray<ChannelTool> = [
  lookupSlackUserTool,
];
