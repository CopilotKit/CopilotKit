# Chat-Canvas component working with A2A and A2UI

You can refer to the `orchestrator` project as an example using this component.

## Configure the UI surface dependencies

The Chat and Canvas assume GM3 fonts and themes are installed.

- <label><input type="checkbox">GM3 Theme is installed.</label>
- <label><input type="checkbox">Google Material Symbols font is loaded.</label>
- <label><input type="checkbox">The "FILL" azis for Google Material Symbols is loaded from 0 to 1.</label>

## Implement the `A2aService`

All functionality to communicate with an agent service goes through the UI
[`A2aService`](src/lib/interfaces/a2a-service.ts) interface, an implementation must be provided by the UI surface.

#### Prerequisites

- <label><input type="checkbox">An endpoint hosting the A2AService</label>

#### Implementation

Create a new class which implements the `A2aService` interface.

```ts
@Injectable({ providedIn: 'root' })
export class MyA2aService implements A2aService {
  sendMessage(parts: Part[], signal?: AbortSignal): Promise<SendMessageSuccessResponse> {
    // ...
  }

  getAgentCard(): Promise<AgentCard> {
    // ...
  }
}
```

This class will be referenced later when configuring chat and canvas features.

## Configure features

The Chat and Canvas require configuration by calling the
`configureChatCanvasFeatures` function. This function requires an `A2aService`
implementation and allows for setting additional optional features.

### Minimal setup

To configure the Chat and Canvas, call the `configureChatCanvasFeatures`
function to get providers to pass into ApplicationConfig.

```ts
// app.config.ts
import { configureChatCanvasFeatures, usingA2aService } from 'src/lib/config';
import { A2aServiceImpl } from 'path/to/code';

export const appConfig: ApplicationConfig = {
  providers: [
    // ...
    configureChatCanvasFeatures(usingA2aService(A2aServiceImpl)),
    // ...
  ],
};
```

### `A2aFeature` (Required)

This feature configures how the `A2aService` is referenced, it is required
because the Chat and Canvas can do nothing without this. This feature should be
configured by one of the two following helper methods.

#### `usingA2aService`

Use the `usingA2aService` function to bind the custom service implementation.

```ts
// app.config.ts
import { configureChatCanvasFeatures, usingA2aService } from 'src/lib/config';
import { A2aServiceImpl } from 'path/to/code';

export const appConfig: ApplicationConfig = {
  providers: [
    // ...
    configureChatCanvasFeatures(usingA2aService(A2aServiceImpl)),
    // ...
  ],
};
```

### `A2uiFeature` (Recommended)

This feature configures the A2UI settings for the chat canvas, specifically providing custom catalog to the A2UI Renderer and controlling the visual theme.

#### `usingA2uiRenderers`

The `usingA2uiRenderers` function configures the A2UI library. It accepts an optional Catalog (which is merged with the default A2UI catalog) and an optional `Theme`.

```ts
// app.config.ts
import { configureChatCanvasFeatures, usingA2uiRenderers } from 'src/lib/config';
import { MY_CUSTOM_CATALOG, MY_CUSTOM_THEME } from 'path/to/code';

export const appConfig: ApplicationConfig = {
  providers: [
    configureChatCanvasFeatures(
      // ...
      usingA2uiRenderers(MY_CUSTOM_CATALOG, MY_CUSTOM_THEME),
      // ...
    ),
  ],
};
```

### `MarkdownFeature` (Recommended)

This feature configures how Markdown is rendered. By default markdown is
rendered using a sanitization-only implementation of the
[`MarkdownRendererService`](src/lib/interfaces/markdown-renderer-service.ts)
interface.

#### `usingMarkdownRenderer` (Advanced)

A custom implementation of `MarkdownRenderer` can be provided to allow full
control over how Markdown is converted to HTML.

```ts
@Injectable({ providedIn: 'root' })
export class MyMarkdownRendererService implements MarkdownRendererService {
  // ...
}
```

```ts
// app.config.ts
import { configureChatCanvasFeatures, usingMarkdownRenderer } from 'src/lib/config';
import { MyMarkdownRendererService } from 'path/to/code';

export const appConfig: ApplicationConfig = {
  providers: [
    configureChatCanvasFeatures(
      // ...
      usingMarkdownRenderer(MyMarkdownRendererService),
      // ...
    ),
  ],
};
```

#### `usingDefaultSanitizerMarkdownRenderer`

To use the default markdown renderer which only sanitizes HTML content and makes
no effort to convert markdown using the
`usingDefaultSanitizerMarkdownRenderer()`. This is the default behavior if no
markdown renderer is supplied.

```ts
// app.config.ts
import { configureChatCanvasFeatures, usingDefaultSanitizerMarkdownRenderer } from 'src/lib/config';

export const appConfig: ApplicationConfig = {
  providers: [
    configureChatCanvasFeatures(
      // ...
      usingDefaultSanitizerMarkdownRenderer(),
      // ...
    ),
  ],
};
```

### `ArtifactResolverFeature`

This feature configures the
[`ArtifactResolver`](src/lib/a2a-renderer/types.ts)
to use, by default no `ArtifactResolver`s are used.

Note: this feature is useless without also including UI for rendering the
artifact.

#### `usingArtifactResolvers`

The
[`usingArtifactResolvers`](src/lib/config.ts)
function takes a varargs of `ArtifactResolver` and configures the mapping of
artifacts in agent responses to an ID for rendering.

```ts
// app.config.ts
import { configureChatCanvasFeatures, usingArtifactResolvers } from 'src/lib/config';
import { ARTIFACT_RESOLVER_1, ARTIFACT_RESOLVER_2 } from 'path/to/code';

export const appConfig: ApplicationConfig = {
  providers: [
    configureChatCanvasFeatures(
      // ...
      usingArtifactResolvers(ARTIFACT_RESOLVER_1, ARTIFACT_RESOLVER_2),
      // ...
    ),
  ],
};
```

### `PartResolverFeature`

This feature configures the
[`PartResolver`](src/lib/a2a-renderer/types.ts)
to use, by default no `PartResolver`s are used.

Note: this feature is useless without also including UI for rendering the
artifact.

#### `usingPartResolvers`

The
[`usingPartResolvers`](src/lib/config.ts)
function takes a varargs of `PartResolver` and configures the mapping of
artifacts in agent responses to an ID for rendering.

```ts
// app.config.ts
import { configureChatCanvasFeatures, usingPartResolvers } from 'src/lib/config';
import { PART_RESOLVER_1, PART_RESOLVER_2 } from 'path/to/code';

export const appConfig: ApplicationConfig = {
  providers: [
    configureChatCanvasFeatures(
      // ...
      usingPartResolvers(PART_RESOLVER_1, PART_RESOLVER_2),
      // ...
    ),
  ],
};
```

### `RenderersFeature`

This feature controls which variants are rendered in the chat and the canvas.

#### Default behavior

By default renderers for text and A2UI DataParts are registered. These are lazy loaded so that they do not impact chunk size until
they are actually needed.

#### `usingRenderers`

Additional `RendererEntry` instances must be added using the `usingRenderers`
function so that the components can map the variant type returned by a
`PartRenderer` or `ArtifactRenderer` to a Component. This can be called multiple
times but only one call is sufficient. Renderers are added in order, if multiple
`RendererEntry` instances claim the same key, the last one added will be the one
used.

```ts
// app.config.ts
import { configureChatCanvasFeatures, usingRenderers } from 'src/lib/config';
import { RENDERER_ENTRY_1, RENDERER_ENTRY_2 } from 'path/to/code';

export const appConfig: ApplicationConfig = {
  providers: [
    configureChatCanvasFeatures(
      // ...
      usingRenderers(RENDERER_ENTRY_1, RENDERER_ENTRY_2),
      // ...
    ),
  ],
};
```

## Rendering UI for agent responses

Both `ArtifactResolver` and `PartResolver` return a string that identifies a
variant name, this section discusses how to map that variant name to code that
renders UI elements for that variant. In the Chat the variant name is used
without modification to find the code that renders that variant.

In Angular we supply renderers by creating a Component implementing the
[`RendererComponent` interface](src/lib/a2a-renderer/types.ts)
and then supplying a mapping of the variant name to a function that returns a
Promise of the Component class.

1.  Create a Component implementing `RendererComponent`:

    ```ts
    import { Component, input, output, Type } from '@angular/core';
    import { UiMessageContent } from '@a2a_chat_canvas/types/ui-message';
    import { Part } from '@a2a-js/sdk';

    @Component({
      /* ... */
    })
    export class MyRendererComponent implements RendererComponent {
      // Required by the interface.
      readonly uiMessageContent = input.required<UiMessageContent>();
    }
    ```

2.  In a **separate file** create a constant
    [`RendererEntry`](src/lib/a2a-renderer/types.ts)

    ```ts
    import { RendererEntry } from '@a2a_chat_canvas/a2a-renderer/types';

    export const MY_RENDERER_ENTRY: RendererEntry = [
      'my_variant_name',
      // This dynamic import lazy-loads the component code at runtime when it is
      // needed.
      // If immediate loading is desired (or required because the UI surface is
      // a legacy surface that does not use MSS) then import the component class
      // above and return it from this async function directly.
      async () => {
        const { MyRendererComponent } = await import('./path/to/code');
        return MyRendererComponent;
      },
    ];
    ```

3.  Use the `Renderers` feature above to register your `RendererEntry`

4.  When a `PartResolver` or `ArtifactResolver` returns the variant name
    matching the registered name, then the Component will be rendered for that
    matching content in the agent response.

## Using the components

This section describes how to add the components to an app after the initial
configuration above is done.

Include the `a2a-chat-canvas` in the template passing inputs as desired

```html
<a2a-chat-canvas></a2a-chat-canvas>
```

#### Types

- [`MessageDecoratorComponent`]('lib/components/chat/chat-history/message-decorator/types.ts')

- [`MessageDecorator`]('lib/components/chat/chat-history/message-decorator/types.ts')

#### Inputs

- `emptyHistoryTemplate`: `TemplateRef<unknown>`

  Use this input to specify a template to replace the content shown when the
  chat history is empty.

  ```html
  <ng-template #myEmptyHistoryTemplate>
    Empty chat history? You must always get the shemp!
    <ng-template>
      <a2a-chat-canvas
        [emptyHistoryTemplate]="myEmptyHistoryTemplate"
      ></a2a-chat-canvas></ng-template
  ></ng-template>
  ```

- `messageDecorator: MessageDecorator` (rarely needed)

  Use this input to supply a `MessageDecorator` which is a function returning
  a `MessageDecoratorComponent` (to support lazy-loading). Do this when the UI
  surface needs to add additional information to the message in the UI, for
  example to add latency information, message action buttons, etc. Both the message that is rendered and
  the fully rendered template for the message are provided as inputs. The
  `MessageDecoratorComponent` should render the provided `TemplateRef` in
  using a
  [`NgTemplateOutlet`](https://angular.dev/api/common/NgTemplateOutlet)

  ```ts
  import { Component, input, TemplateRef } from '@angular/core';
  import { UiMessage } from '@a2a_chat_canvas/types/ui_message';
  import { MessageDecoratorComponent } from '@a2a_chat_canvas/components/chat/chat_history/message_decorator/types';

  @Component({
    /* ... */
  })
  export class MyMessageDecoratorComponent implements MessageDecorator {
    readonly message = input.required<ReadonlyUiMessage>();
    readonly coreContentTemplateRef = input.required<TemplateRef<unknown>>();
  }
  ```

  ```html
  <div>Some content before the message</div>
  <ng-container *ngTemplateOutlet="coreContentTemplateRef()"></ng-contaioner>
  <div>Some content after the message</div>
  ```
