# QA: Multimodal Attachments — Spring AI

## Prerequisites
- Spring AI backend is up with a vision-capable OpenAI model (e.g. gpt-4.1 / gpt-4o)

## Test Steps
- [ ] Navigate to `/demos/multimodal`
- [ ] Click "Try sample image" to inject the bundled PNG
- [ ] Verify the paperclip shows the attachment
- [ ] Ask "What do you see in this image?"
- [ ] If the `ag-ui:spring-ai` adapter forwards media to `UserMessage.media`, verify the agent describes the image contents
- [ ] Try the same with the sample PDF

## Expected Results
- Attachment UX (paperclip + sample buttons + drag-drop + clipboard paste) works
- Adapter-level image forwarding behavior is integration-dependent; see PARITY_NOTES.md
