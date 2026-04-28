# Multimodal Attachments demo (MS Agent Framework, .NET)

Demonstrates image + PDF uploads via CopilotChat's `AttachmentsConfig`, backed
by a vision-capable ChatClientAgent on the .NET side.

## Architecture

- Frontend: `page.tsx` + `sample-attachment-buttons.tsx` — same UX as the
  LangGraph reference under `showcase/packages/langgraph-python/src/app/demos/multimodal/`.
- Runtime: `/api/copilotkit-multimodal` — proxies to the .NET backend over
  AG-UI (HTTP).
- Agent: `agent/MultimodalAgent.cs` — a dedicated `ChatClientAgent` wired to
  `gpt-4o-mini` (vision-capable). Mounted at `/multimodal` in `Program.cs` via
  `app.MapAGUI("/multimodal", ...)`.

## Why a dedicated runtime?

Vision models cost more per token. Scoping the vision endpoint to just this
cell keeps the per-demo cost boundary clean — other cells continue to use the
shared `/api/copilotkit` runtime and never pay the vision premium.

## PDF handling

The LangGraph reference flattens PDFs to text server-side with `pypdf` before
sending them to the model. Modern OpenAI chat models accept PDF inputs
directly, so the .NET agent defers to the model's native document handling
and omits the PDF extractor. If a PDF can't be read, the model will say so —
matching the reference's graceful-degradation behavior.

## Sample files

Put `sample.png` and `sample.pdf` under `public/demo-files/` to enable the
"Try with sample X" buttons.
