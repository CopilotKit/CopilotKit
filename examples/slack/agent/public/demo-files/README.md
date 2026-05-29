# Demo Files — Multimodal Demo

This directory bundles sample files referenced by the `/demos/multimodal` page.

Required files (must be committed as binaries; see `.gitattributes` at repo root):

- `sample.png` — a small (< 50 KB) PNG that the "Try with sample image" button
  injects into the chat. A CopilotKit logo or other recognizable brand mark
  works well so the vision-capable agent has something to describe.
- `sample.pdf` — a small (< 50 KB) one-page PDF that the "Try with sample PDF"
  button injects. The content must mention "CopilotKit" so E2E soft
  assertions hold (e.g. a one-page export of the CopilotKit quickstart).

The page at `src/app/demos/multimodal/page.tsx` fetches these via the public
path (`/demo-files/sample.png`, `/demo-files/sample.pdf`), wraps the fetched
blob in a `File`, and routes it through the same `AttachmentsConfig.onUpload`
callback the paperclip button uses — so the sample path exercises the exact
same queueing code as a real user upload.

If these files are missing, the demo page still renders but the sample
buttons will surface a fetch error. The paperclip / drag-and-drop paths
continue to work without them.
