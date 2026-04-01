# A2UI (Agent-to-Agent UI) Extension Spec v0.9

## Overview

This extension implements the A2UI (Agent-to-Agent UI) spec v0.9, a format for agents to send streaming, interactive user interfaces to clients.

## Extension URI

The URI of this extension is https://a2ui.org/a2a-extension/a2ui/v0.9

This is the only URI accepted for this extension.

## Core Concepts

The A2UI extension is built on the following main concepts:

Surfaces: A "Surface" is a distinct, controllable region of the client's UI. The spec uses a surfaceId to direct updates to specific surfaces (e.g., a main content area, a side panel, or a new chat bubble). This allows a single agent stream to manage multiple UI areas independently.

Catalog Definition Document: The a2ui extension is catalog-agnostic. All UI components (e.g., Text, Row, Button) and functions (e.g., required, email) are defined in a separate Catalog Definition Schema. This allows clients and servers to negotiate which catalog to use.

Schemas: The a2ui extension is defined by several primary JSON schemas:

- Catalog Definition Schema: A standard format for defining a library of components and functions.
- Server-to-Client Message Schema: The core wire format for messages sent from the agent to the client (e.g., updateComponents, updateDataModel).
- Client-to-Server Event Schema: The core wire format for messages sent from the client to the agent (e.g., action).
- Client Capabilities Schema: The schema for the `a2uiClientCapabilities` object.

Client Capabilities: The client sends its capabilities to the server in an `a2uiClientCapabilities` object. This object is included in the `metadata` field of every A2A `Message` sent from the client to the server. This object allows the client to declare which catalogs it supports.

## Agent Card details

Agents advertise their A2UI capabilities in their AgentCard within the `AgentCapabilities.extensions` list. The `params` object defines the agent's specific UI support.

Example AgentExtension block:

```json
{
  "uri": "https://a2ui.org/a2a-extension/a2ui/v0.9",
  "description": "Ability to render A2UI v0.9",
  "required": false,
  "params": {
    "supportedCatalogIds": [
      "https://a2ui.dev/specification/v0_9/standard_catalog.json",
      "https://my-company.com/a2ui/v0.9/my_custom_catalog.json"
    ],
    "acceptsInlineCatalogs": true
  }
}
```

### Parameter Definitions
- `params.supportedCatalogIds`: (OPTIONAL) An array of strings, where each string is a URI pointing to a Catalog Definition Schema that the agent can generate.
- `params.acceptsInlineCatalogs`: (OPTIONAL) A boolean indicating if the agent can accept an `inlineCatalogs` array in the client's `a2uiClientCapabilities`. If omitted, this defaults to `false`.

## Extension Activation
Clients indicate their desire to use the A2UI extension by specifying it via the transport-defined A2A extension activation mechanism.

For JSON-RPC and HTTP transports, this is indicated via the X-A2A-Extensions HTTP header.

For gRPC, this is indicated via the X-A2A-Extensions metadata value.

Activating this extension implies that the server can send A2UI-specific messages (like updateComponents) and the client is expected to send A2UI-specific events (like action).

## Data Encoding

A2UI messages are encoded as an A2A `DataPart`.

To identify a `DataPart` as containing A2UI data, it must have the following metadata:

- `mimeType`: `application/json+a2ui`

The `data` field of the `DataPart` contains a **single** A2UI JSON message (e.g., `createSurface`, `updateComponents`, `action`). It MUST NOT be an array of messages.

### Atomicity and Multiple Messages

To send multiple A2UI messages that should be processed atomically (e.g., creating a surface and immediately populating it), the sender MUST include multiple `DataPart`s within a single A2A `Message`.

Receivers (both Clients and Agents) MUST process all A2UI `DataPart`s within a single A2A `Message` sequentially and atomically. For a renderer, this means the UI should not be repainted until all parts in the message have been applied.

### Server-to-Client Messages

When an agent sends a message to a client (or another agent acting as a client/renderer), the `data` payload must validate against the **Server-to-Client Message Schema**.

Example `createSurface` DataPart:

```json
{
  "data": {
    "createSurface": {
      "surfaceId": "user_profile_surface",
      "catalogId": "https://a2ui.dev/specification/v0_9/standard_catalog.json"
    }
  },
  "kind": "data",
  "metadata": {
    "mimeType": "application/json+a2ui"
  }
}
```

### Client-to-Server Events

When a client (or an agent forwarding an event) sends a message to an agent, it also uses a `DataPart` with the same `application/json+a2ui` MIME type. However, the `data` payload must validate against the **Client-to-Server Event Schema**.

Example `action` DataPart:

```json
{
  "data": {
    "action": {
      "name": "submit_form",
      "surfaceId": "contact_form_1",
      "sourceComponentId": "submit_button",
      "timestamp": "2026-01-15T12:00:00Z",
      "context": {
        "email": "user@example.com"
      }
    }
  },
  "kind": "data",
  "metadata": {
    "mimeType": "application/json+a2ui"
  }
}
```