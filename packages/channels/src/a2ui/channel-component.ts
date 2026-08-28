import { MessageProcessor } from "@a2ui/web_core/v0_9";
import type { A2uiMessage } from "@a2ui/web_core/v0_9";
import { Message, defineChannelComponent } from "@copilotkit/channels-core";
import type {
  ChannelNode,
  InteractionContext,
} from "@copilotkit/channels-core";
import { z } from "zod";
import { lowerSurface } from "./lower-surface.js";
import type { ChannelA2UIActionHandler, ChannelA2UICatalog } from "./types.js";

export interface CreateChannelA2UIComponentOptions {
  readonly catalog: ChannelA2UICatalog;
  readonly onAction: ChannelA2UIActionHandler;
}

type A2UIComponentValue = {
  id: string;
  component: string;
  [key: string]: unknown;
};

type ActionOutcome =
  | { readonly status: "fulfilled" }
  | { readonly status: "rejected"; readonly error: unknown };

interface PendingAction {
  readonly interaction: InteractionContext;
  readonly completion: Promise<ActionOutcome>;
  matched: boolean;
  complete(outcome: ActionOutcome): void;
}

const actionKey = (action: {
  readonly name: string;
  readonly sourceComponentId: string;
  readonly surfaceId: string;
}): string =>
  JSON.stringify([action.surfaceId, action.sourceComponentId, action.name]);

const pendingAction = (interaction: InteractionContext): PendingAction => {
  let complete!: (outcome: ActionOutcome) => void;
  const completion = new Promise<ActionOutcome>((resolve) => {
    complete = resolve;
  });
  return { interaction, completion, matched: false, complete };
};

const DESCRIPTION = `Render one complete A2UI v0.9 surface as portable Channel UI.
Use exactly one component with id "root", give every component a unique id,
and reference children by id in the flat component array. Use literal property
values unless that property's schema explicitly permits a path binding.`;

function componentValueSchema(catalog: ChannelA2UICatalog) {
  const branches = [...catalog.processorCatalog.components.values()].map(
    (implementation) => {
      const schema = implementation.schema as z.AnyZodObject;
      if (typeof schema.extend !== "function") {
        throw new Error(
          `A2UI component "${implementation.name}" must use an object schema`,
        );
      }
      const branch = schema.extend({
        id: z
          .string()
          .min(1)
          .describe("Unique component id; one id must be root."),
        component: z.literal(implementation.name),
      });
      const description =
        catalog.schema.components[implementation.name]?.description;
      return description ? branch.describe(String(description)) : branch;
    },
  );
  const [first, second, ...rest] = branches;
  if (!first) throw new Error("Channel A2UI requires at least one component");
  return (
    second ? z.union([first, second, ...rest]) : first
  ) as z.ZodType<A2UIComponentValue>;
}

const presentSurface = (ir: ChannelNode[]): ChannelNode =>
  ir.length === 1 && ir[0]?.type === "message"
    ? ir[0]
    : Message({ fallbackText: "Interactive interface", children: ir });

export function createChannelA2UIComponent(
  options: CreateChannelA2UIComponentOptions,
) {
  const parameters = z
    .object({
      surfaceId: z.string().min(1).describe("Unique A2UI surface identifier."),
      components: z
        .array(componentValueSchema(options.catalog))
        .min(1)
        .describe("Complete flat A2UI v0.9 component array."),
      data: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Optional initial data model written at the surface root."),
    })
    .strict()
    .superRefine(({ components }, context) => {
      const ids = new Set<string>();
      let rootCount = 0;
      components.forEach(({ id }, index) => {
        if (id === "root") rootCount += 1;
        if (ids.has(id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate component id "${id}"`,
            path: ["components", index, "id"],
          });
        }
        ids.add(id);
      });
      if (rootCount !== 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Expected exactly one component with id "root"',
          path: ["components"],
        });
      }
    });

  return defineChannelComponent({
    name: "render_a2ui",
    description: DESCRIPTION,
    parameters,
    render({ surfaceId, components, data }) {
      const pendingActions = new Map<string, PendingAction[]>();
      const processor = new MessageProcessor(
        [options.catalog.processorCatalog],
        (action) => {
          const key = actionKey(action);
          const queue = pendingActions.get(key);
          const pending = queue?.shift();
          if (!pending) return;
          if (queue?.length === 0) pendingActions.delete(key);
          pending.matched = true;
          void Promise.resolve()
            .then(() =>
              options.onAction({
                action,
                interaction: pending.interaction,
              }),
            )
            .then(
              () => pending.complete({ status: "fulfilled" }),
              (error: unknown) =>
                pending.complete({ status: "rejected", error }),
            );
        },
      );
      const messages: A2uiMessage[] = [
        {
          version: "v0.9",
          createSurface: {
            surfaceId,
            catalogId: options.catalog.id,
          },
        },
        {
          version: "v0.9",
          updateComponents: { surfaceId, components },
        },
        ...(data === undefined
          ? []
          : [
              {
                version: "v0.9" as const,
                updateDataModel: { surfaceId, path: "/", value: data },
              },
            ]),
      ];
      processor.processMessages(messages);
      const surface = processor.model.getSurface(surfaceId);
      if (!surface) {
        throw new Error(`A2UI surface "${surfaceId}" was not created`);
      }
      const ir = lowerSurface(surface, {
        async dispatchAction(interaction, expectedAction, dispatch) {
          const key = actionKey(expectedAction);
          const pending = pendingAction(interaction);
          const queue = pendingActions.get(key) ?? [];
          queue.push(pending);
          pendingActions.set(key, queue);
          try {
            await dispatch();
            if (!pending.matched) {
              throw new Error(
                `A2UI event action "${expectedAction.name}" did not emit`,
              );
            }
            const outcome = await pending.completion;
            if (outcome.status === "rejected") throw outcome.error;
          } catch (error) {
            const pendingQueue = pendingActions.get(key);
            const index = pendingQueue?.indexOf(pending) ?? -1;
            if (index >= 0) pendingQueue?.splice(index, 1);
            if (pendingQueue?.length === 0) pendingActions.delete(key);
            throw error;
          }
        },
      });
      return presentSurface(ir);
    },
  });
}
