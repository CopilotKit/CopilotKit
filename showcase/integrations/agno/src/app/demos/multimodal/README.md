# Multimodal Attachments

## What This Demo Shows

CopilotChat's `attachments` config surfaces a paperclip button + drag-and-
drop + clipboard-paste flow that uploads an image or PDF, base64-inlines
it, and forwards the modern multimodal AG-UI content parts to a vision-
capable Agno agent (`gpt-4o`).

## How to Interact

1. Click the paperclip (or drag-and-drop, or paste) — or click "Try with
   sample image" / "Try with sample PDF".
2. Ask a question about the attachment ("What's in this image?", "Summarise
   this PDF").

## Technical Details

- Runtime: `src/app/api/copilotkit-multimodal/route.ts` — isolated so the
  vision-cost is scoped to this cell.
- Agent: `src/agents/multimodal_agent.py` — gpt-4o-backed Agno agent
  with optional pypdf-based document flattening.
- Interface: dedicated `/multimodal/agui` AGUI mount.
