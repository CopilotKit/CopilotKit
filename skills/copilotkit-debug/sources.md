# Sources

This skill no longer carries a transcribed copy of CopilotKit's error codes, diagnostic
sequences, or known-issue list. Each of those now has a single authoritative home, and the
skill points at it instead:

| Was transcribed here                                                 | Lives at                                                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Diagnostic survey (versions, runtime mode, transport, `/info`, CORS) | `copilotkit verify` — 11 checks, reported with the URL it probed and where that URL came from |
| `CopilotKitCoreErrorCode` and the legacy error classes               | The generated API reference, `/reference/core/enums/CopilotKitCoreErrorCode`                  |
| Symptom-to-cause tables                                              | `/troubleshooting/error-reference` and `/troubleshooting/common-issues`                       |
| Event-flow tracing                                                   | `/troubleshooting/event-inspector` and `/troubleshooting/debug-mode`                          |
| A list of known GitHub issues                                        | The issue tracker, searched live                                                              |

Two of those are generated from source, so a copy here could only ever be less accurate. The
known-issue list was the clearest case for removing rather than refreshing: of the twelve
issues the previous version cited, nine had been closed, and the entries read as current.

What the skill still asserts, and where it comes from:

- The eleven `verify` checks and their semantics (chaining, `UNKNOWN` never meaning passed,
  non-zero exit unless every check passed) — the CLI's own `verify` implementation and help
  text in `CopilotKit/Intelligence`.
- That `--round-trip` proves the agent runs but not that tools work — it sends no context and
  asks a question that needs no tools.
- The `copilotkit-docs` MCP endpoint and the Codex configuration block.
