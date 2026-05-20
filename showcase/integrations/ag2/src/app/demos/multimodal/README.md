# Multimodal Attachments (AG2)

Image + PDF uploads via `<CopilotChat attachments={...}>`, processed by a
vision-capable AG2 ConversableAgent backed by gpt-4o.

## Files

- `page.tsx` — `<CopilotKit>` provider + `<CopilotChat>` with attachments
  enabled (10 MB cap, `image/*,application/pdf` accept filter).
- `sample-attachment-buttons.tsx` — buttons that inject bundled
  `/demo-files/sample.png` and `/demo-files/sample.pdf` into the chat
  composer's hidden file input.
- `../../api/copilotkit-multimodal/route.ts` — dedicated V1 runtime that
  proxies to a gpt-4o-backed AG2 agent on a dedicated FastAPI mount.
- `../../../agents/multimodal_agent.py` — AG2 ConversableAgent with
  `model="gpt-4o"`.

## Notes

The route is dedicated so the vision cost is scoped to this cell only. The
sample-attachment buttons exercise the same upload pipeline the paperclip
uses by populating the hidden file input.
