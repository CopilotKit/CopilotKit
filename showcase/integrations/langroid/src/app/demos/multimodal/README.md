# Multimodal Attachments — Langroid

Vision-capable chat (gpt-4o) with image + PDF attachment support. Two paths exercise the same upload pipeline:

1. The paperclip button + drag-and-drop + clipboard-paste rendered by `<CopilotChat />` when `attachments.enabled: true`.
2. Two "Try with sample X" buttons that fetch bundled assets from `public/demo-files/` and inject them via `DataTransfer` into the same hidden file input — so QA flows that can't grant file-picker permissions still cover the multimodal path.

## Topology

- **Page** — `src/app/demos/multimodal/page.tsx`. Wires CopilotChat's `AttachmentsConfig` with `accept: "image/*,application/pdf"`, `maxSize: 10 MB`, and an `onUpload` that inlines base64. **No legacy-shape rewrite shim** is needed — the Langroid backend speaks AG-UI directly and understands the modern `{type: "image" | "document", source: {...}}` part shape natively. The `langgraph-python` sibling needs the shim because the `@ag-ui/langgraph` converter only forwards the legacy `binary` shape to LangChain.
- **Sample buttons** — `sample-attachment-buttons.tsx`. Magic-byte validates fetched assets (catches Git LFS pointer stubs that would otherwise base64-encode into a "broken PNG").
- **Runtime route** — `src/app/api/copilotkit-multimodal/route.ts`. Single-agent runtime targeting `${AGENT_URL}/multimodal` under the slug `multimodal-demo`. The vision-capable model is scoped to **just** this route; other Langroid cells keep their cheaper text-only models.
- **Agent** — `src/agents/multimodal_agent.py`, mounted at `POST /multimodal`. Normalizes inbound content parts to OpenAI shape, forwards images as `image_url` parts (gpt-4o reads them natively), and flattens PDFs to text via `pypdf` (gpt-4o cannot read PDFs directly). When PDF extraction fails we substitute a typed `[Attached document: PDF could not be read.]` placeholder so the model can at least tell the user.

## Required asset

`public/demo-files/sample.png` and `public/demo-files/sample.pdf` must be committed as real binaries. The README in that directory documents the expected content (CopilotKit logo PNG, CopilotKit-branded one-page PDF) and Git LFS notes.
