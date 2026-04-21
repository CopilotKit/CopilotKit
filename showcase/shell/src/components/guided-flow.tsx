"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { type Integration } from "@/lib/registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuidedAnswers {
  features: string[];
  language: string | null;
  constraints: string[];
}

// Stored payload shape permits legacy `undefined` for `language` from
// versions that pre-dated the field. Callers normalize to `GuidedAnswers`
// immediately after validation.
interface StoredGuidedAnswers {
  features: string[];
  language: string | null | undefined;
  constraints: string[];
}

// Runtime guard mirroring StoredGuidedAnswers. Used before trusting values
// parsed from localStorage (where the schema could drift across
// component versions or be hand-edited).
function isGuidedAnswers(v: unknown): v is StoredGuidedAnswers {
  if (v === null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (
    !Array.isArray(r.features) ||
    !r.features.every((x) => typeof x === "string")
  ) {
    return false;
  }
  // Accept undefined for backwards compatibility with stored state from
  // component versions that pre-dated the `language` field.
  if (
    r.language !== null &&
    r.language !== undefined &&
    typeof r.language !== "string"
  ) {
    return false;
  }
  if (
    !Array.isArray(r.constraints) ||
    !r.constraints.every((x) => typeof x === "string")
  ) {
    return false;
  }
  return true;
}

interface ScoredIntegration {
  integration: Integration;
  matches: number;
  total: number;
  score: number;
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const FEATURE_OPTIONS = [
  { id: "chat", label: "Chat interface" },
  { id: "tools", label: "AI-powered tools" },
  { id: "genui", label: "Generative UI" },
  { id: "orchestration", label: "Agent orchestration" },
  { id: "hitl", label: "Human-in-the-loop workflows" },
  { id: "state", label: "Shared state management" },
] as const;

const LANGUAGE_OPTIONS = [
  { id: "python", label: "Python (LangGraph, PydanticAI, CrewAI, etc.)" },
  { id: "typescript", label: "TypeScript/Node.js (Mastra, LangGraph JS)" },
  { id: "dotnet", label: ".NET (Microsoft Agent Framework)" },
  { id: "java", label: "Java (Spring AI)" },
  { id: "unsure", label: "Not sure yet" },
] as const;

const CONSTRAINT_OPTIONS = [
  { id: "aws", label: "Must use AWS" },
  { id: "google", label: "Must use Google Cloud" },
  { id: "azure", label: "Must use Azure" },
  { id: "multi-agent", label: "Need multi-agent support" },
  { id: "simple", label: "Need the simplest setup" },
] as const;

const STORAGE_KEY = "showcase-guided-flow";

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const FEATURE_MAP: Record<string, string> = {
  chat: "agentic-chat",
  tools: "frontend-tools",
  genui: "gen-ui-tool-based",
  orchestration: "subagents",
  hitl: "hitl-in-chat",
  state: "shared-state-read",
};

const LANG_MAP: Record<string, string> = {
  python: "python",
  typescript: "typescript",
  dotnet: "dotnet",
  java: "java",
};

// Module-load invariants: every FEATURE_OPTION id must have a FEATURE_MAP
// entry, and every LANGUAGE_OPTION id (except "unsure" which is handled
// separately) must have a LANG_MAP entry. Drift between the UI option
// arrays and these maps silently produces zero-score scoring, which would
// ship without a test failure because scoring isn't validated end-to-end.
// Crashing at module load makes the drift impossible to miss.
for (const opt of FEATURE_OPTIONS) {
  if (!(opt.id in FEATURE_MAP)) {
    throw new Error(
      `guided-flow: FEATURE_OPTIONS contains id '${opt.id}' with no FEATURE_MAP entry. ` +
        "Add the mapping in showcase/shell/src/components/guided-flow.tsx.",
    );
  }
}
for (const opt of LANGUAGE_OPTIONS) {
  if (opt.id === "unsure") continue;
  if (!(opt.id in LANG_MAP)) {
    throw new Error(
      `guided-flow: LANGUAGE_OPTIONS contains id '${opt.id}' with no LANG_MAP entry. ` +
        "Add the mapping in showcase/shell/src/components/guided-flow.tsx.",
    );
  }
}

function scoreIntegration(
  integration: Integration,
  answers: GuidedAnswers,
): ScoredIntegration {
  let matches = 0;
  let total = 0;

  // Step 1: features
  for (const feature of answers.features) {
    total++;
    const mapped = FEATURE_MAP[feature];
    if (mapped && integration.features?.includes(mapped)) matches++;
  }

  // Step 2: language
  if (answers.language && answers.language !== "unsure") {
    total++;
    const mapped = LANG_MAP[answers.language];
    if (mapped && integration.language === mapped) matches++;
  }

  // Step 3: constraints
  for (const constraint of answers.constraints) {
    total++;
    if (constraint === "aws" && ["strands", "agno"].includes(integration.slug))
      matches++;
    if (constraint === "google" && integration.slug === "google-adk") matches++;
    if (constraint === "azure" && integration.slug.includes("ms-agent"))
      matches++;
    if (
      constraint === "multi-agent" &&
      ["crewai-crews", "ag2"].includes(integration.slug)
    )
      matches++;
    if (
      constraint === "simple" &&
      ["mastra", "langgraph-typescript"].includes(integration.slug)
    )
      matches++;
  }

  return {
    integration,
    matches,
    total,
    score: total > 0 ? matches / total : 0,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GuidedFlow({ integrations }: { integrations: Integration[] }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<GuidedAnswers>({
    features: [],
    language: null,
    constraints: [],
  });

  // Warn-once refs for localStorage failure paths. Declared above both
  // effects so the restore useEffect (which reads cleanupWarnedRef in its
  // catch branch) does not forward-reference a later declaration. The
  // restore effect's callback body runs after the full render — so the
  // previous ordering worked at runtime — but a refactor to useLayoutEffect
  // or a synchronous call in render would break silently. Keep these
  // adjacent to the effects that consume them.
  //
  // persistWarnedRef guards the persist (setItem) effect below.
  const persistWarnedRef = useRef(false);
  // cleanupWarnedRef guards the removeItem calls in both the restore
  // useEffect (malformed payload cleanup) and `reset`. Kept separate from
  // persistWarnedRef so a persist failure doesn't silence cleanup
  // diagnostics and vice versa.
  const cleanupWarnedRef = useRef(false);
  // restoredRef gates the persist effect. Without it, the persist effect
  // runs on the initial render with the still-empty `answers` state and
  // clobbers the saved localStorage payload before the restore effect's
  // setAnswers call triggers a re-render. The persist effect skips its
  // write until the restore effect has finished (marked at the end of
  // its body regardless of which branch ran).
  const restoredRef = useRef(false);

  // Restore from localStorage. Validate the shape before trusting the
  // parsed value: an older version of this component, a browser
  // extension, or manual editing could have left a malformed record
  // behind, and setAnswers(anyObject) would silently propagate the bad
  // shape into JSX array methods below.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed: unknown = JSON.parse(saved);
      if (!isGuidedAnswers(parsed)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[guided-flow] Discarding malformed ${STORAGE_KEY} payload from localStorage.`,
        );
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch (err) {
          if (!cleanupWarnedRef.current) {
            cleanupWarnedRef.current = true;
            // eslint-disable-next-line no-console
            console.warn(
              `[guided-flow] Failed to remove ${STORAGE_KEY} from localStorage (further warnings suppressed):`,
              err,
            );
          }
        }
        return;
      }
      // Coerce legacy undefined language to null so the rest of the
      // component treats the field uniformly.
      const normalized: GuidedAnswers = {
        features: parsed.features,
        language: parsed.language ?? null,
        constraints: parsed.constraints,
      };
      setAnswers(normalized);
      // If they have previous results, jump to results
      if (
        normalized.features.length > 0 ||
        normalized.language ||
        normalized.constraints.length > 0
      ) {
        setStep(3);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[guided-flow] Failed to restore ${STORAGE_KEY} from localStorage:`,
        err,
      );
    } finally {
      // Mark restore complete in all exit paths (no-saved-value,
      // malformed-and-cleaned, successfully-restored, or threw). The
      // persist effect is gated on this flag to avoid clobbering the
      // saved payload on the initial render before setAnswers has had
      // a chance to swap in the restored state.
      restoredRef.current = true;
    }
  }, []);

  // Persist to localStorage. Warn at most once per mount: the write effect
  // runs on every answer change and users in restrictive storage modes
  // (Safari private, quota exceeded, disabled cookies) would otherwise see
  // dozens of duplicate warnings per session. The persistWarnedRef /
  // cleanupWarnedRef refs are declared above the restore useEffect so
  // neither effect forward-references them.
  useEffect(() => {
    // Skip until the restore effect has finished. Without this gate, the
    // initial render writes `{features: [], language: null, constraints: []}`
    // to localStorage — overwriting the saved payload the restore effect
    // has not yet applied to state. The restore effect sets
    // restoredRef.current = true in a finally block, so every exit path
    // (including early returns and thrown errors) releases this gate.
    if (!restoredRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
    } catch (err) {
      if (!persistWarnedRef.current) {
        persistWarnedRef.current = true;
        // eslint-disable-next-line no-console
        console.warn(
          `[guided-flow] Failed to persist ${STORAGE_KEY} to localStorage (further warnings suppressed):`,
          err,
        );
      }
    }
  }, [answers]);

  const deployed = useMemo(
    () => integrations.filter((i) => i.deployed),
    [integrations],
  );

  const results = useMemo(() => {
    const scored = deployed.map((i) => scoreIntegration(i, answers));
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || b.matches - a.matches);
  }, [deployed, answers]);

  const toggleFeature = useCallback((id: string) => {
    setAnswers((prev) => ({
      ...prev,
      features: prev.features.includes(id)
        ? prev.features.filter((f) => f !== id)
        : [...prev.features, id],
    }));
  }, []);

  const toggleConstraint = useCallback((id: string) => {
    setAnswers((prev) => ({
      ...prev,
      constraints: prev.constraints.includes(id)
        ? prev.constraints.filter((c) => c !== id)
        : [...prev.constraints, id],
    }));
  }, []);

  const setLanguage = useCallback((id: string) => {
    setAnswers((prev) => ({
      ...prev,
      language: prev.language === id ? null : id,
    }));
  }, []);

  const reset = useCallback(() => {
    setAnswers({ features: [], language: null, constraints: [] });
    setStep(0);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      if (!cleanupWarnedRef.current) {
        cleanupWarnedRef.current = true;
        // eslint-disable-next-line no-console
        console.warn(
          `[guided-flow] Failed to remove ${STORAGE_KEY} from localStorage (further warnings suppressed):`,
          err,
        );
      }
    }
  }, []);

  const canAdvance =
    step === 0
      ? answers.features.length > 0
      : step === 1
        ? answers.language !== null
        : true; // step 2 (constraints) is optional

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-[var(--accent)] text-[var(--accent)] text-sm font-medium hover:bg-[var(--accent)] hover:text-white transition-colors"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        </svg>
        Help me choose
      </button>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={() => setOpen(false)}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-[var(--bg)] border-l border-[var(--border)] shadow-2xl z-50 flex flex-col guided-animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold text-[var(--text)]">
            {step < 3 ? "Help me choose" : "Your matches"}
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Progress */}
        {step < 3 && (
          <div className="px-6 pt-4">
            <div className="flex gap-1.5">
              {[0, 1, 2].map((s) => (
                <div
                  key={s}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    s <= step ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                  }`}
                />
              ))}
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-2">
              Step {step + 1} of 3
            </p>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {step === 0 && (
            <StepContent title="What are you building?">
              <PillGrid
                options={FEATURE_OPTIONS}
                selected={answers.features}
                onToggle={toggleFeature}
                multi
              />
            </StepContent>
          )}

          {step === 1 && (
            <StepContent title="What's your backend?">
              <PillGrid
                options={LANGUAGE_OPTIONS}
                selected={answers.language ? [answers.language] : []}
                onToggle={setLanguage}
              />
            </StepContent>
          )}

          {step === 2 && (
            <StepContent
              title="Any constraints?"
              subtitle="Optional -- skip if none apply."
            >
              <PillGrid
                options={CONSTRAINT_OPTIONS}
                selected={answers.constraints}
                onToggle={toggleConstraint}
                multi
              />
            </StepContent>
          )}

          {step === 3 && (
            <div>
              {results.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] text-center py-8">
                  No integrations match your criteria. Try adjusting your
                  answers.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {results.map(({ integration, matches, total, score }) => (
                    <Link
                      key={integration.slug}
                      href={`/integrations/${integration.slug}`}
                      className="block rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 hover:border-[var(--accent)] hover:shadow-sm transition-all"
                      onClick={() => setOpen(false)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {integration.logo && (
                              <img
                                src={integration.logo}
                                alt=""
                                className="w-5 h-5 rounded"
                                onError={(e) => {
                                  // eslint-disable-next-line no-console
                                  console.warn(
                                    "[guided-flow] image failed to load:",
                                    e.currentTarget.src,
                                  );
                                  (e.target as HTMLImageElement).style.display =
                                    "none";
                                }}
                              />
                            )}
                            <span className="text-sm font-semibold text-[var(--text)]">
                              {integration.name}
                            </span>
                          </div>
                          <p className="text-xs text-[var(--text-secondary)] line-clamp-2">
                            {integration.description}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                            score >= 0.8
                              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                              : score >= 0.5
                                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                                : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"
                          }`}
                        >
                          {matches}/{total} match
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between">
          {step === 3 ? (
            <>
              <button
                type="button"
                onClick={reset}
                className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                Start over
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => step > 0 && setStep(step - 1)}
                className={`text-sm transition-colors ${
                  step > 0
                    ? "text-[var(--text-muted)] hover:text-[var(--text)]"
                    : "text-transparent pointer-events-none"
                }`}
              >
                Back
              </button>
              <div className="flex items-center gap-3">
                {step === 2 && (
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                  >
                    Skip
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => canAdvance && setStep(step + 1)}
                  disabled={!canAdvance}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    canAdvance
                      ? "bg-[var(--accent)] text-white hover:opacity-90"
                      : "bg-[var(--bg-elevated)] text-[var(--text-faint)] cursor-not-allowed"
                  }`}
                >
                  {step === 2 ? "See results" : "Next"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{`
                @keyframes guided-slide-in {
                    from { transform: translateX(100%); }
                    to { transform: translateX(0); }
                }
                .guided-animate-slide-in {
                    animation: guided-slide-in 0.25s ease-out;
                }
            `}</style>
    </>
  );
}

// ---------------------------------------------------------------------------
// StepContent
// ---------------------------------------------------------------------------

function StepContent({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-base font-semibold text-[var(--text)] mb-1">
        {title}
      </h3>
      {subtitle && (
        <p className="text-xs text-[var(--text-muted)] mb-4">{subtitle}</p>
      )}
      {!subtitle && <div className="mb-4" />}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PillGrid
// ---------------------------------------------------------------------------

function PillGrid({
  options,
  selected,
  onToggle,
  multi,
}: {
  options: readonly { id: string; label: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  multi?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(({ id, label }) => {
        const active = selected.includes(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => onToggle(id)}
            className={`px-4 py-2 rounded-full text-sm border transition-all ${
              active
                ? "border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)] font-medium"
                : "border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
            }`}
          >
            {active && multi && (
              <svg
                className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
            {label}
          </button>
        );
      })}
    </div>
  );
}
