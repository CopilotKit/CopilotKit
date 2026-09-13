# Built-in Agent multimodal: actual local browser evidence

Date: 2026-09-13. Fresh visible IAB tab at `http://localhost:3117/demos/multimodal`, opened after the optional-catchall/multi-route repair. No harness request headers were injected. Runtime: public CopilotKit 1.71.1 with the local core relative-URL patch, strict local AIMock replay.

1. Click **Try with sample image**. The UI displays an image attachment and the user message. Assistant: “The attached image is the CopilotKit logo — a clean, geometric mark used across CopilotKit branding.”
2. In the same conversation, click **Try with sample PDF**. The UI displays `sample.pdf` and the user message. Assistant: “The attached PDF document is the CopilotKit Quickstart guide. It walks through installing the React packages, configuring the CopilotKit provider, and adding a CopilotKit chat component to an application.”

The root agent inspected accessibility output after each action and displayed an actual screenshot of both results in the conversation. This proves these two bundled actions completed in that local browser session. It does not qualify arbitrary files, audio/video, live-provider behavior, published unpatched SDK compatibility, or the other four integrations.

The concurrent automated D6 evidence still reports no user/assistant DOM after successful info/run HTTP responses. Preserve that RED result separately until the discrepancy between the harness and the normal browser is understood. An HTTP 200 alone was not used as the success criterion here.
