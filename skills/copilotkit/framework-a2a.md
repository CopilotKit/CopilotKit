# A2A Integration

CopilotKit implementation guide for A2A.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

## Guidance
### Declarative (A2UI)
- Route: `/a2a/generative-ui/declarative-a2ui`
- Source: `docs/content/docs/integrations/a2a/generative-ui/declarative-a2ui.mdx`
- Description: Use A2UI to declaratively generate user interfaces.

```bash
    git clone https://github.com/copilotkit/with-a2a-a2ui.git
```
```
    pnpm install
```
```
    pnpm dev
```
```python title="agent/restaurant_finder/prompt_builder.py"
      RESTAURANT_UI_EXAMPLES = """
      ...
      ---BEGIN SINGLE_COLUMN_LIST_EXAMPLE---
      [
        {{ "beginRendering": {{ "surfaceId": "default", "root": "root-column", "styles": {{ "primaryColor": "#FF0000", "font": "Roboto" }} }} }},
        {{ "surfaceUpdate": {{
          "surfaceId": "default",
          "components": [
            {{ "id": "root-column", "component": {{ "Column": {{ "children": {{ "explicitList": ["title-heading", "item-list"] }} }} }} }},
            {{ "id": "title-heading", "component": {{ "Text": {{ "usageHint": "h1", "text": {{ "literalString": "Top Restaurants" }} }} }} }},
            {{ "id": "item-list", "component": {{ "List": {{ "direction": "vertical", "children": {{ "template": {{ "componentId": "item-card-template", "dataBinding": "/items" }} }} }} }} }},
            {{ "id": "item-card-template", "component": {{ "Card": {{ "child": "card-layout" }} }} }},
            {{ "id": "card-layout", "component": {{ "Row": {{ "children": {{ "explicitList": ["template-image", "card-details"] }} }} }} }},
            {{ "id": "template-image", weight: 1, "component": {{ "Image": {{ "url": {{ "path": "imageUrl" }} }} }} }},
            {{ "id": "card-details", weight: 2, "component": {{ "Column": {{ "children": {{ "explicitList": ["template-name", "template-rating", "template-detail", "template-link", "template-book-button"] }} }} }} }},
            {{ "id": "template-name", "component": {{ "Text": {{ "usageHint": "h3", "text": {{ "path": "name" }} }} }} }},
            {{ "id": "template-rating", "component": {{ "Text": {{ "text": {{ "path": "rating" }} }} }} }},
            {{ "id": "template-detail", "component": {{ "Text": {{ "text": {{ "path": "detail" }} }} }} }},
            {{ "id": "template-link", "component": {{ "Text": {{ "text": {{ "path": "infoLink" }} }} }} }},
            {{ "id": "template-book-button", "component": {{ "Button": {{ "child": "book-now-text", "primary": true, "action": {{ "name": "book_restaurant", "context": [ {{ "key": "restaurantName", "value": {{ "path": "name" }} }}, {{ "key": "imageUrl", "value": {{ "path": "imageUrl" }} }}, {{ "key": "address", "value": {{ "path": "address" }} }} ] }} }} }} }},
            {{ "id": "book-now-text", "component": {{ "Text": {{ "text": {{ "literalString": "Book Now" }} }} }} }}
          ]
        }} }},
        {{ "dataModelUpdate": {{
          "surfaceId": "default",
          "path": "/",
          "contents": [
            {{ "key": "items", "valueMap": [
              {{ "key": "item1", "valueMap": [
                {{ "key": "name", "valueString": "The Fancy Place" }},
                {{ "key": "rating", "valueNumber": 4.8 }},
                {{ "key": "detail", "valueString": "Fine dining experience" }},
                {{ "key": "infoLink", "valueString": "https://example.com/fancy" }},
                {{ "key": "imageUrl", "valueString": "https://example.com/fancy.jpg" }},
                {{ "key": "address", "valueString": "123 Main St" }}
              ] }},
              {{ "key": "item2", "valueMap": [
                {{ "key": "name", "valueString": "Quick Bites" }},
                {{ "key": "rating", "valueNumber": 4.2 }},
                {{ "key": "detail", "valueString": "Casual and fast" }},
                {{ "key": "infoLink", "valueString": "https://example.com/quick" }},
                {{ "key": "imageUrl", "valueString": "https://example.com/quick.jpg" }},
                {{ "key": "address", "valueString": "456 Oak Ave" }}
              ] }}
            ] }} // Populate this with restaurant data
          ]
        }} }}
      ]
      ---END SINGLE_COLUMN_LIST_EXAMPLE---
      # ... more examples below
```
```tsx title="app/page.tsx"
    "use client";

    import { CopilotChat, CopilotKitProvider } from "@copilotkitnext/react";
    import { createA2UIMessageRenderer } from "@copilotkitnext/a2ui-renderer";
    import { theme } from "./theme";

    // Disable static optimization for this page
    export const dynamic = "force-dynamic";

    const A2UIMessageRenderer = createA2UIMessageRenderer({ theme });

    export default function Home() {
      return (
        <CopilotKitProvider
          runtimeUrl="/api/copilotkit"
          showDevConsole="auto"
          renderActivityMessages={[A2UIMessageRenderer]}
        >
          <main
            className="flex min-h-screen flex-1 flex-col overflow-hidden"
            style={{ minHeight: "100dvh" }}
          >
            <Chat />
          </main>
        </CopilotKitProvider>
      );
    }

    function Chat() {
      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          <CopilotChat style={{ flex: 1, minHeight: "100%" }} />
        </div>
      );
    }
```
```tsx title="app/theme.ts"
    import { v0_8 } from "@google/a2ui";

    /** Elements */

    const a = {
      "typography-f-sf": true,
      "typography-fs-n": true,
      "typography-w-500": true,
      "layout-as-n": true,
      "layout-dis-iflx": true,
      "layout-al-c": true,
    };

    const audio = {
      "layout-w-100": true,
    };

    const body = {
      "typography-f-s": true,
      "typography-fs-n": true,
      "typography-w-400": true,
      "layout-mt-0": true,
      "layout-mb-2": true,
      "typography-sz-bm": true,
      "color-c-n10": true,
    };

    const button = {
      "typography-f-sf": true,
      "typography-fs-n": true,
      "typography-w-500": true,
      "layout-pt-3": true,
      "layout-pb-3": true,
      "layout-pl-5": true,
      "layout-pr-5": true,
      "layout-mb-1": true,
      "border-br-16": true,
      "border-bw-0": true,
      "border-c-n70": true,
      "border-bs-s": true,
      "color-bgc-s30": true,
      "color-c-n100": true,
      "behavior-ho-80": true,
    };

    const heading = {
      "typography-f-sf": true,
      "typography-fs-n": true,
      "typography-w-500": true,
      "layout-mt-0": true,
      "layout-mb-2": true,
      "color-c-n10": true,
    };

    const h1 = {
      ...heading,
      "typography-sz-tl": true,
    };

    const h2 = {
      ...heading,
      "typography-sz-tm": true,
    };

    const h3 = {
      ...heading,
      "typography-sz-ts": true,
    };

    const iframe = {
      "behavior-sw-n": true,
    };

    const input = {
      "typography-f-sf": true,
      "typography-fs-n": true,
      "typography-w-400": true,
      "layout-pl-4": true,
      "layout-pr-4": true,
      "layout-pt-2": true,
      "layout-pb-2": true,
      "border-br-6": true,
      "border-bw-1": true,
      "color-bc-s70": true,
      "border-bs-s": true,
      "layout-as-n": true,
      "color-c-n10": true,
    };

    const p = {
      "typography-f-s": true,
      "typography-fs-n": true,
      "typography-w-400": true,
      "layout-m-0": true,
      "typography-sz-bm": true,
      "layout-as-n": true,
      "color-c-n10": true,
    };

    const orderedList = {
      "typography-f-s": true,
      "typography-fs-n": true,
      "typography-w-400": true,
      "layout-m-0": true,
      "typography-sz-bm": true,
      "layout-as-n": true,
    };

    const unorderedList = {
      "typography-f-s": true,
      "typography-fs-n": true,
      "typography-w-400": true,
      "layout-m-0": true,
      "typography-sz-bm": true,
      "layout-as-n": true,
    };

    const listItem = {
      "typography-f-s": true,
      "typography-fs-n": true,
      "typography-w-400": true,
      "layout-m-0": true,
      "typography-sz-bm": true,
      "layout-as-n": true,
    };

    const pre = {
      "typography-f-c": true,
      "typography-fs-n": true,
      "typography-w-400": true,
      "typography-sz-bm": true,
      "typography-ws-p": true,
      "layout-as-n": true,
    };

    const textarea = {
      ...input,
      "layout-r-none": true,
      "layout-fs-c": true,
    };

    const video = {
      "layout-el-cv": true,
    };

    const aLight = v0_8.Styles.merge(a, { "color-c-n5": true });
    const inputLight = v0_8.Styles.merge(input, { "color-c-n5": true });
    const textareaLight = v0_8.Styles.merge(textarea, { "color-c-n5": true });
    const buttonLight = v0_8.Styles.merge(button, { "color-c-n100": true });
    const h1Light = v0_8.Styles.merge(h1, { "color-c-n5": true });
    const h2Light = v0_8.Styles.merge(h2, { "color-c-n5": true });
    const h3Light = v0_8.Styles.merge(h3, { "color-c-n5": true });
    const bodyLight = v0_8.Styles.merge(body, { "color-c-n5": true });
    const pLight = v0_8.Styles.merge(p, { "color-c-n35": true });
    const preLight = v0_8.Styles.merge(pre, { "color-c-n35": true });
    const orderedListLight = v0_8.Styles.merge(orderedList, {
      "color-c-n35": true,
    });
    const unorderedListLight = v0_8.Styles.merge(unorderedList, {
      "color-c-n35": true,
    });
    const listItemLight = v0_8.Styles.merge(listItem, {
      "color-c-n35": true,
    });

    export const theme: v0_8.Types.Theme = {
      additionalStyles: {
        Button: {
          "--n-35": "var(--n-100)",
        },
      },
      components: {
        AudioPlayer: {},
        Button: {
          "layout-pt-2": true,
          "layout-pb-2": true,
          "layout-pl-3": true,
          "layout-pr-3": true,
          "border-br-12": true,
          "border-bw-0": true,
          "border-bs-s": true,
          "color-bgc-p30": true,
          "color-c-n100": true,
          "behavior-ho-70": true,
        },
        Card: { "border-br-9": true, "color-bgc-p100": true, "layout-p-4": true },
        CheckBox: {
          element: {
            "layout-m-0": true,
            "layout-mr-2": true,
            "layout-p-2": true,
            "border-br-12": true,
            "border-bw-1": true,
            "border-bs-s": true,
            "color-bgc-p100": true,
            "color-bc-p60": true,
            "color-c-n30": true,
            "color-c-p30": true,
          },
          label: {
            "color-c-p30": true,
            "typography-f-sf": true,
            "typography-v-r": true,
            "typography-w-400": true,
            "layout-flx-1": true,
            "typography-sz-ll": true,
          },
          container: {
            "layout-dsp-iflex": true,
            "layout-al-c": true,
          },
        },
        Column: {
          "layout-g-2": true,
        },
        DateTimeInput: {
          container: {
            "typography-sz-bm": true,
            "layout-w-100": true,
            "layout-g-2": true,
            "layout-dsp-flexhor": true,
            "layout-al-c": true,
          },
          label: {
            "layout-flx-0": true,
          },
          element: {
            "layout-pt-2": true,
            "layout-pb-2": true,
            "layout-pl-3": true,
            "layout-pr-3": true,
            "border-br-12": true,
            "border-bw-1": true,
            "border-bs-s": true,
            "color-bgc-p100": true,
            "color-bc-p60": true,
            "color-c-n30": true,
            "color-c-p30": true,
          },
        },
        Divider: {},
        Image: {
          all: {
            "border-br-5": true,
            "layout-el-cv": true,
            "layout-w-100": true,
            "layout-h-100": true,
          },
          avatar: {},
          header: {},
          icon: {},
          largeFeature: {},
          mediumFeature: {},
          smallFeature: {},
        },
        Icon: {},
        List: {
          "layout-g-4": true,
          "layout-p-2": true,
        },
        Modal: {
          backdrop: { "color-bbgc-p60_20": true },
          element: {
            "border-br-2": true,
            "color-bgc-p100": true,
            "layout-p-4": true,
            "border-bw-1": true,
            "border-bs-s": true,
            "color-bc-p80": true,
          },
        },
        MultipleChoice: {
          container: {},
          label: {},
          element: {},
        },
        Row: {
          "layout-g-4": true,
        },
        Slider: {
          container: {},
          label: {},
          element: {},
        },
        Tabs: {
          container: {},
          controls: { all: {}, selected: {} },
          element: {},
        },
        Text: {
          all: {
            "layout-w-100": true,
            "layout-g-2": true,
            "color-c-p30": true,
          },
          h1: {
            "typography-f-sf": true,
            "typography-v-r": true,
            "typography-w-400": true,
            "layout-m-0": true,
            "layout-p-0": true,
            "typography-sz-tl": true,
          },
          h2: {
            "typography-f-sf": true,
            "typography-v-r": true,
            "typography-w-400": true,
            "layout-m-0": true,
            "layout-p-0": true,
            "typography-sz-tm": true,
          },
          h3: {
            "typography-f-sf": true,
            "typography-v-r": true,
            "typography-w-400": true,
            "layout-m-0": true,
            "layout-p-0": true,
            "typography-sz-ts": true,
          },
          h4: {
            "typography-f-sf": true,
            "typography-v-r": true,
            "typography-w-400": true,
            "layout-m-0": true,
            "layout-p-0": true,
            "typography-sz-bl": true,
          },
          h5: {
            "typography-f-sf": true,
            "typography-v-r": true,
            "typography-w-400": true,
            "layout-m-0": true,
            "layout-p-0": true,
            "typography-sz-bm": true,
          },
          body: {},
          caption: {},
        },
        TextField: {
          container: {
            "typography-sz-bm": true,
            "layout-w-100": true,
            "layout-g-2": true,
            "layout-dsp-flexhor": true,
            "layout-al-c": true,
          },
          label: {
            "layout-flx-0": true,
          },
          element: {
            "typography-sz-bm": true,
            "layout-pt-2": true,
            "layout-pb-2": true,
            "layout-pl-3": true,
            "layout-pr-3": true,
            "border-br-12": true,
            "border-bw-1": true,
            "border-bs-s": true,
            "color-bgc-p100": true,
            "color-bc-p60": true,
            "color-c-n30": true,
            "color-c-p30": true,
          },
        },
        Video: {
          "border-br-5": true,
          "layout-el-cv": true,
        },
      },
      elements: {
        a: aLight,
        audio,
        body: bodyLight,
        button: buttonLight,
        h1: h1Light,
        h2: h2Light,
        h3: h3Light,
        iframe,
        input: inputLight,
        p: pLight,
        pre: preLight,
        textarea: textareaLight,
        video,
      },
      markdown: {
        p: [...Object.keys(pLight)],
        h1: [...Object.keys(h1Light)],
        h2: [...Object.keys(h2Light)],
        h3: [...Object.keys(h3Light)],
        h4: [],
        h5: [],
        h6: [],
        ul: [...Object.keys(unorderedListLight)],
        ol: [...Object.keys(orderedListLight)],
        li: [...Object.keys(listItemLight)],
        a: [...Object.keys(aLight)],
        strong: [],
        em: [],
      },
    };
```

### Quickstart
- Route: `/a2a/quickstart`
- Source: `docs/content/docs/integrations/a2a/quickstart.mdx`
- Description: Turn your A2A Agents into an agent-native application in 10 minutes.

## Prerequisites

Before you begin, you'll need the following:

- A Google Gemini API key
- Node.js 20+
- Python 3.9+
- Your favorite package manager

## Getting started

        ### Clone the A2A starter template

```bash
        git clone https://github.com/copilotkit/with-a2a-a2ui.git
```
        ### Install dependencies

```
        pnpm install
```
        ### Configure your environment

        Create a `.env` file in your agent directory and add your Google API key:

```plaintext title="agent/.env"
        GOOGLE_API_KEY=your_google_api_key
```

          The starter template is configured to use Google's Gemini by default, but you can modify it to use any language model supported by ADK.
        ### Start the development server

```bash
                npm run dev
```
```bash
                pnpm dev
```
```bash
                yarn dev
```
```bash
                bun dev
```

        This will start both the UI and agent servers concurrently.
        ### 🎉 Start chatting!

        Your AI agent is now ready to use! Navigate to `localhost:3000` and start prompting it:

```
        Show me chinese restaurants in NYC
```

                - If you're having connection issues, try using `0.0.0.0` or `127.0.0.1` instead of `localhost`
                - Make sure your agent is running on port 8000
                - Check that your Google API key is correctly set

## What's next?

Now that you have your basic agent setup, explore these advanced features:
