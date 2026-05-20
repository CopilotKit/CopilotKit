import { describe, it, expect } from "vitest";
import { FILTER_RE } from "./filter-regex.js";

/**
 * HF13-D1: single source of truth for the filter-pipeline regex shared
 * between renderer (extractFilters) and rule-loader (validateFilterNames).
 * The negative look-arounds are the interesting contract — a non-guarded
 * copy of this regex would have matched the inner `{{ ... }}` of a
 * `{{{ ... | filter ... }}}` triple-brace span, producing divergent
 * behavior between load-time validation and render-time substitution.
 * Pin the shape here so any future tweak that drops the look-arounds
 * trips these tests directly rather than surfacing as a subtle drift
 * between the two call sites.
 */
describe("FILTER_RE (shared)", () => {
  // Regex is /g — reset lastIndex between assertions to avoid cross-test
  // state bleed. Each `test.exec` call uses its own local variable and we
  // reset before each assertion.
  function matches(text: string): RegExpMatchArray[] {
    FILTER_RE.lastIndex = 0;
    const out: RegExpMatchArray[] = [];
    let m: RegExpExecArray | null;
    while ((m = FILTER_RE.exec(text))) {
      out.push(m);
      // Guard against zero-width matches locking the loop; not expected
      // for this regex but cheap insurance.
      if (m.index === FILTER_RE.lastIndex) FILTER_RE.lastIndex++;
    }
    return out;
  }

  it("matches a plain double-brace filter pipeline", () => {
    const ms = matches("x {{ signal.details | stripAnsi }} y");
    expect(ms).toHaveLength(1);
    expect(ms[0]![1]!.trim()).toBe("signal.details");
    expect(ms[0]![2]!.trim()).toBe("stripAnsi");
  });

  it("does NOT match inside a `{{{ path | filter }}}` triple-brace span", () => {
    // Negative look-around is load-bearing: without it, the regex
    // greedily straddles the inner `{{ ... }}` of the triple-brace.
    const ms = matches("{{{ signal.body | slackEscape }}}");
    expect(ms).toHaveLength(0);
  });

  it("does NOT match `{{{path}}}` with no pipe", () => {
    // Triple-brace without a pipeline also never matches — the inner
    // `{{path}}` shape lacks the `|` separator the regex requires.
    const ms = matches("{{{event.runUrl}}}");
    expect(ms).toHaveLength(0);
  });

  it("matches a double-brace pipeline in a template that ALSO contains a triple-brace", () => {
    // Mixed shape: triple-brace opts out, double-brace pipeline still
    // validates normally. Confirms the look-arounds scope to the
    // triple-brace span only.
    const ms = matches(
      "run: {{{event.runUrl}}} — summary: {{ signal.details | stripAnsi | truncateUtf8 5 }}",
    );
    expect(ms).toHaveLength(1);
    expect(ms[0]![1]!.trim()).toBe("signal.details");
    expect(ms[0]![2]!.trim()).toBe("stripAnsi | truncateUtf8 5");
  });

  it("captures chained pipeline filters in a single match", () => {
    const ms = matches(
      "{{ signal.x | stripAnsi | truncateUtf8 10 | slackEscape }}",
    );
    expect(ms).toHaveLength(1);
    expect(ms[0]![2]!.trim()).toBe("stripAnsi | truncateUtf8 10 | slackEscape");
  });
});
