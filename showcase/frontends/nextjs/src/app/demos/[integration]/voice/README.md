# Voice input

Users want to talk to the agent instead of typing. This demo adds a mic button to the chat, and the runtime transcribes the recording into the message box.

## Try it

1. Open `/demos/<integration>/voice`.
2. Click the mic button and say a question.
3. Click the mic button again. The text appears in the message box.
4. Send the message.

If you have no microphone, click "Try a sample audio". It puts "What is the weather in Tokyo?" into the message box.

## How it works

- The chat shows the mic button when the runtime's `/info` reports `audioFileTranscriptionEnabled: true`.
- The voice runtime route (`src/app/api/[integration]/voice`) sets the transcription service.
- The sample button records no audio and does not call the transcription service. Tests use it.

## What the integration needs

- An agent for `createRuntimeConfig("voice")`, with the id `voice-demo`.

Speak, and your words become a message for the agent.
