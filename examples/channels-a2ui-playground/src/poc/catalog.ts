import { Catalog, MessageProcessor } from "@a2ui/web_core/v0_9";
import {
  channelBasicComponents,
  channelBasicFunctions,
} from "./basic-catalog.js";
import { defineChannelA2UIComponent } from "./component.js";
import type {
  ChannelA2UICatalog,
  ChannelA2UICatalogDefinitions,
  ChannelA2UICatalogRenderers,
  ChannelA2UIRenderer,
} from "./types.js";

const DEFAULT_CHANNEL_CATALOG_ID = "copilotkit://channels-a2ui/v0.9";

export function createChannelA2UICatalog<
  Definitions extends ChannelA2UICatalogDefinitions,
>(
  definitions: Definitions,
  renderers: ChannelA2UICatalogRenderers<Definitions>,
  options: {
    catalogId?: string;
    includeChannelBasicCatalog?: boolean;
  } = {},
): ChannelA2UICatalog {
  const custom = Object.entries(definitions).map(([name, definition]) => {
    if (
      options.includeChannelBasicCatalog &&
      channelBasicComponents.some((component) => component.name === name)
    ) {
      throw new Error(
        `Custom A2UI component "${name}" conflicts with the Channel catalog`,
      );
    }
    const renderer = (
      renderers as Record<string, ChannelA2UIRenderer<Record<string, unknown>>>
    )[name];
    if (!renderer) {
      throw new Error(`Missing Channel lowerer for A2UI component "${name}"`);
    }
    return defineChannelA2UIComponent(
      { name, schema: definition.props },
      renderer,
    );
  });
  const components = options.includeChannelBasicCatalog
    ? [...channelBasicComponents, ...custom]
    : custom;
  const functions = options.includeChannelBasicCatalog
    ? channelBasicFunctions
    : [];
  const id = options.catalogId ?? DEFAULT_CHANNEL_CATALOG_ID;
  const processorCatalog = new Catalog(id, components, functions);
  const capabilities = new MessageProcessor([
    processorCatalog,
  ]).getClientCapabilities({ includeInlineCatalogs: true });
  const inline = capabilities["v0.9"].inlineCatalogs?.[0];
  if (!inline?.components) {
    throw new Error("A2UI MessageProcessor did not produce an inline catalog");
  }
  const schemaComponents = { ...inline.components };
  for (const [name, definition] of Object.entries(definitions)) {
    if (definition.description && schemaComponents[name]) {
      schemaComponents[name] = {
        ...schemaComponents[name],
        description: definition.description,
      };
    }
  }
  return Object.freeze({
    id,
    processorCatalog,
    schema: {
      catalogId: id,
      components: schemaComponents,
    },
  });
}
