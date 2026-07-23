/**
 * Shared regex for matching `{{ path | filter ... }}` filter-pipeline
 * expressions, used by both the renderer (at render time, via
 * `extractFilters`) and the rule-loader (at load time, via
 * `validateFilterNames`). Kept in a leaf module so both callers can
 * import without pulling the rest of the renderer surface.
 *
 * HF13-D1: previously the rule-loader carried its own `FILTER_REF_RE`
 * copy that lacked the negative look-arounds — meaning validation
 * accidentally matched the inner `{{ ... }}` segment of a
 * `{{{ ... | slackEscape }}}` triple-brace span. A template that
 * deliberately used triple-brace (the documented opt-out from
 * HTML-escaping) to carry a pipeline-looking token inside user content
 * could then trip unknown-filter rejection at load time even though the
 * renderer correctly ignored the same match. Single source of truth for
 * this regex prevents that drift from creeping back.
 *
 * The leading `(?<!\{)` and trailing `(?!\})` negative look-arounds
 * prevent the match from straddling a `{{{ x | f }}}` triple-brace
 * span. `validateTripleBrace` already rejects most triple-brace shapes
 * at load time for non-slackSafe paths, but the guards here are
 * defence-in-depth so the two call sites agree on what counts as a
 * filter reference.
 */
export const FILTER_RE =
  /(?<!\{)\{\{\s*([^{}|]+?)\s*\|\s*([^{}]+?)\s*\}\}(?!\})/g;
