# Multimodal Attachments Demo (MS Agent Framework)

Vision-capable MS Agent Framework demo that accepts image and PDF attachments.

## Architecture

- **Frontend**: `src/app/demos/multimodal/page.tsx` mounts `<CopilotChat />`
  with `AttachmentsConfig` so the user can attach files via paperclip,
  drag-and-drop, clipboard paste, or the bundled sample buttons.
- **Runtime**: `src/app/api/copilotkit-multimodal/route.ts` -- dedicated
  Next.js route that proxies to the Python agent server at `/multimodal`.
  Scoped to its own endpoint so the vision-capable model does not bleed into
  other demos.
- **Agent**: `src/agents/multimodal_agent.py` -- a vision-capable
  `AgentFrameworkAgent` backed by `OpenAIChatClient` with `gpt-4o-mini`.
  Images are forwarded natively to OpenAI; PDF `document` parts are
  flattened to text via `pypdf` in a pre-run hook so the model can reason
  about them even if the chat client does not accept the `document`
  content-part shape.
- **Mounting**: see `src/agent_server.py` -- the multimodal agent is mounted
  on `/multimodal` before the catch-all `/` endpoint.

## Sample files

Drop `sample.png` and `sample.pdf` into `public/demo-files/` if you want the
bundled-sample buttons to work. The sample buttons fetch those URLs and
drive the same hidden file input the paperclip button uses, so they exercise
the exact same `onUpload` pipeline.

## Dependencies

`pypdf` is imported lazily so the module stays importable even if the
package is missing. Add it to `requirements.txt` if you need PDF flattening.
