# Built-in Agent voice sample: normal-browser check

2026-09-13, actual fresh IAB route `http://localhost:3117/demos/voice`, public SDK 1.71.1 plus the local core URL repair and strict AIMock. No harness headers.

The page initially displayed a disabled **Connecting…** sample button. After discovery it enabled **Try a sample audio**. Clicking it inserted `What is the weather in Tokyo?` into the composer. Pressing Enter produced the visible assistant response: “Looking up the weather in Tokyo for you. Tokyo is 22°C and partly cloudy.”

This independently confirms the repaired readiness gate and preloaded transcript-to-agent flow. It does not exercise microphone capture, audio upload, transcription, or a live speech provider. Those outcomes must be checked separately before claiming complete voice qualification. The unchanged D6 weather assertion also passed after the preserved pre-dispatch failure; canonical repair commit `6c38d7ef74`.
