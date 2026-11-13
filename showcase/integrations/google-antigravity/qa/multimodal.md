# QA: Multimodal Attachments — Google Antigravity

## Prerequisites

- Demo is deployed and accessible at `/demos/multimodal` on the dashboard host
- Agent backend is healthy (`/api/health`); `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set (the Go harness calls Gemini itself; `GOOGLE_GEMINI_BASE_URL` points it at aimock in tests). The default Gemini model is vision-capable.
- The page uses its own runtime route, `/api/copilotkit-multimodal`, which proxies agent `multimodal-demo` (aliased as `default`) to the agent server's `/multimodal-demo` mount, bound in `src/agents/registry.py` to `multimodal_agent()` from `src/agents/multimodal.py`
- How attachments reach the model: user messages carry AG-UI `image` / `document` content parts with inline base64 data. The adapter forwards them to Gemini as inline media, so a PDF reaches the model as a document (no text flattening). Unlike langgraph-python there is no `legacy-converter-shim.tsx`: its legacy `binary` parts would fail AG-UI 1.0 `RunAgentInput` validation.
- Sample files are bundled under `public/demo-files/`:
  - `sample.png` — a small 393×90 PNG the vision model can describe
  - `sample.pdf` — a one-page "CopilotKit Quickstart" excerpt (Install, Provide a runtime, Add a chat UI, What's next)
- Note for fixture runs: aimock matches on the prompt text only, so a canned reply does not prove the attachment arrived. Check the attachment path against real Gemini, or with a capturing proxy that shows `inlineData` in the request (see `PARITY_NOTES.md`, "Multimodal").

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/multimodal`; verify `data-testid="multimodal-demo-root"` renders
- [ ] Verify the sample row (`data-testid="multimodal-sample-row"`) shows "Bundled samples:" with two enabled buttons: "Try with sample image" (`data-testid="multimodal-sample-image-button"`) and "Try with sample PDF" (`data-testid="multimodal-sample-pdf-button"`)
- [ ] Verify `<CopilotChat />` renders a composer with an add/attachments button (`data-testid="copilot-add-menu-button"`), which bounces briefly once after load

### 2. Sample image path

- [ ] Click "Try with sample image"
- [ ] Both sample buttons disable and the clicked one reads "Sending…" while the run is in progress
- [ ] The message is sent immediately (no composer step): a user message "can you tell me what is in this demo image I just attached" appears with the image attachment
- [ ] Within 60 seconds the agent replies with a description of the image (for example a logo, wordmark or colors)
- [ ] Both buttons re-enable when the run finishes

### 3. Sample PDF path

- [ ] Click "Try with sample PDF"
- [ ] A user message "can you tell me what is in this demo pdf I just attached" appears with the document attachment
- [ ] Within 60 seconds the agent replies with text that identifies the document as a CopilotKit quickstart (installing packages, providing a runtime, adding a chat UI)

### 4. Paperclip / real upload path (manual)

- [ ] Click the add/attachments button
- [ ] The file picker opens filtered to `image/*` and `application/pdf`
- [ ] Select a local image under 10 MB
- [ ] An attachment chip renders in the composer within 2 seconds
- [ ] Type "What's in this image?" and send
- [ ] The agent replies with a description of the image content
- [ ] Repeat with a local PDF and ask "Summarize this document"; the reply reflects the PDF's text

### 5. Drag-and-drop

- [ ] Drag a local image onto the chat container
- [ ] The chat surface shows a drop affordance
- [ ] On drop, an attachment chip appears
- [ ] Sending a prompt works the same as the paperclip path

### 6. Multi-attachment

- [ ] Attach a local image AND a local PDF through the add button so both chips are in the composer
- [ ] Type "What do these two attachments have in common?" and send
- [ ] The reply acknowledges both attachments
- [ ] In the same thread, click "Try with sample image" and then "Try with sample PDF"; verify each reply describes its own attachment (earlier attachments do not break later turns)

### 7. Error Handling

- [ ] Try to attach a file over 10 MB via the add button; verify the page logs a `[multimodal-demo] attachment rejected` console warning and the composer stays usable
- [ ] Try to attach an unsupported type (e.g. `.exe`); the picker filter excludes it, or the rejection warning fires
- [ ] Block `/demo-files/sample.png` in DevTools → Network; click "Try with sample image"; verify `data-testid="multimodal-sample-error"` shows an error (e.g. "Could not fetch sample \"sample.png\" — HTTP …") and the page does not crash
- [ ] Verify no request fails with a `RunAgentInput` validation error in DevTools → Network during any of the above

## Expected Results

- Sample buttons send immediately; composer attachment chips appear within 2 seconds
- Thumbnails render for image attachments; a document chip for PDFs
- Agent replies arrive within 60 seconds for single-attachment prompts
- Replies describe the actual attachment content (image description, PDF summary)
- No console errors during successful flows (rejection warnings during intentional error cases are fine)
- Error states are visible and recoverable — the user can retry
