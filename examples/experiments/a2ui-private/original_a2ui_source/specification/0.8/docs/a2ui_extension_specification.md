# A2UI (Agent-to-Agent UI) Extension Spec

## Overview

This extension implements the A2UI (Agent-to-Agent UI) spec, a format for agents to send streaming, interactive user interfaces to clients.

## Extension URI

The URI of this extension is https://a2ui.org/a2a-extension/a2ui/v0.8

This is the only URI accepted for this extension.

## Core Concepts

The A2UI extension is built on the following main concepts:

Surfaces: A "Surface" is a distinct, controllable region of the client's UI. The spec uses a surfaceId to direct updates to specific surfaces (e.g., a main content area, a side panel, or a new chat bubble). This allows a single agent stream to manage multiple UI areas independently.

Catalog Definition Document: The a2ui extension is component-agnostic. All UI components (e.g., Text, Row, Button) and their stylings are defined in a separate Catalog Definition Schema. This allows clients and servers to negotiate which catalog to use.

Schemas: The a2ui extension is defined by three primary JSON schemas:

Catalog Definition Schema: A standard format for defining a library of components and styles.

Server-to-Client Message Schema: The core wire format for messages sent from the agent to the client (e.g., surfaceUpdate, dataModelUpdate).

Client-to-Server Event Schema: The core wire format for messages sent from the client to the agent (e.g., userAction).

Client Capabilities: The client sends its capabilities to the server in an `a2uiClientCapabilities` object. This object is included in the `metadata` field of every A2A `Message` sent from the client to the server.This object allows the client to declare which catalogs it supports.

## Agent Card details

Agents advertise their A2UI capabilities in their AgentCard within the `AgentCapabilities.extensions` list. The `params` object defines the agent's specific UI support.

Example AgentExtension block:

```json
{
  "uri": "https://a2ui.org/a2a-extension/a2ui/v0.8",
  "description": "Ability to render A2UI",
  "required": false,
  "params": {
    "supportedCatalogIds": [
      "https://github.com/google/A2UI/blob/main/specification/0.8/json/standard_catalog_definition.json",
      "https://my-company.com/a2ui/v0.8/my_custom_catalog.json"
    ],
    "acceptsInlineCatalogs": true
  }
}
```

### Parameter Definitions
- `params.supportedCatalogIds`: (OPTIONAL) An array of strings, where each string is a URI pointing to a component Catalog Definition Schema that the agent can generate.
- `params.acceptsInlineCatalogs`: (OPTIONAL) A boolean indicating if the agent can accept an `inlineCatalogs` array in the client's `a2uiClientCapabilities`. If omitted, this defaults to `false`.

## Extension Activation
Clients indicate their desire to use the A2UI extension by specifying it via the transport-defined A2A extension activation mechanism.

For JSON-RPC and HTTP transports, this is indicated via the X-A2A-Extensions HTTP header.

For gRPC, this is indicated via the X-A2A-Extensions metadata value.

Activating this extension implies that the server can send A2UI-specific messages (like surfaceUpdate) and the client is expected to send A2UI-specific events (like userAction).

## Data Encoding

A2UI messages are encoded as an A2A `DataPart`.

To identify a `DataPart` as containing A2UI data, it must have the following metadata:

- `mimeType`: `application/json+a2ui`

The `data` field of the `DataPart` contains the A2UI JSON message (e.g., `surfaceUpdate`, `userAction`).

Example A2UI DataPart:

```json
{
  "data": {
    "beginRendering": {
      "surfaceId": "outlier_stores_map_surface",
    }
  },
  "kind": "data",
  "metadata": {
    "mimeType": "application/json+a2ui"
  }
}
```