"use client";

const HIDDEN_KEYS = new Set([
  "type",
  "status",
  "sourceContext",
  "guardrailsResult",
  "releaseCheck",
  "redacted",
  "a2uiSurface",
]);

const TITLE_KEYS = [
  "title",
  "subject",
  "name",
  "item",
  "request",
  "summary",
  "reference",
  "referenceId",
  "ticketId",
];

type JsonRecord = Record<string, unknown>;

type ResultSection = {
  title: string;
  rows: JsonRecord[];
};

export function OpenBoxBusinessActionResult({ result }: { result: unknown }) {
  const toolResult = parseResult(result);
  if (toolResult.status !== "executed" && toolResult.status !== "constrained") {
    return null;
  }

  const artifact = recordValue(toolResult.artifact);
  if (Object.keys(artifact).length === 0) return null;

  const title = stringValue(artifact.title) || titleForType(artifact.type);
  const summary =
    stringValue(artifact.summary) ||
    stringValue(artifact.body) ||
    stringValue(artifact.memo) ||
    stringValue(artifact.message);
  const sections = sectionsFromArtifact(artifact);
  const details = detailRowsFromArtifact(artifact);

  return (
    <section
      className="openbox-business-result"
      data-testid="openbox-business-result"
    >
      <header className="openbox-business-header">
        <h3>{title}</h3>
        {summary ? <p>{summary}</p> : null}
      </header>

      {details.length > 0 ? (
        <div className="openbox-business-section">
          <div className="openbox-business-section-title">Details</div>
          <div className="openbox-business-detail-grid">
            {details.map(([label, value]) => (
              <div className="openbox-business-detail" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {sections.map((section) => (
        <div className="openbox-business-section" key={section.title}>
          <div className="openbox-business-section-title">{section.title}</div>
          <div className="openbox-business-rows">
            {section.rows.map((row, index) => (
              <BusinessRow key={`${section.title}-${index}`} row={row} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function BusinessRow({ row }: { row: JsonRecord }) {
  const title = rowTitle(row);
  const entries = Object.entries(row).filter(
    ([key, value]) =>
      !HIDDEN_KEYS.has(key) &&
      !TITLE_KEYS.includes(key) &&
      value !== null &&
      value !== undefined &&
      textValue(value).trim().length > 0,
  );

  return (
    <article className="openbox-business-row">
      {title ? <div className="openbox-business-row-title">{title}</div> : null}
      {entries.length > 0 ? (
        <dl>
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt>{labelForKey(key)}</dt>
              <dd>{textValue(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
}

function sectionsFromArtifact(artifact: JsonRecord): ResultSection[] {
  const sections: ResultSection[] = [];
  for (const [key, value] of Object.entries(artifact)) {
    if (HIDDEN_KEYS.has(key) || !Array.isArray(value)) continue;
    const rows = value.flatMap((item): JsonRecord[] => {
      if (isRecord(item)) return [item];
      const text = textValue(item);
      return text ? [{ summary: text }] : [];
    });
    if (rows.length > 0) {
      sections.push({
        title: sectionTitleForKey(key),
        rows,
      });
    }
  }
  return sections;
}

function detailRowsFromArtifact(artifact: JsonRecord): Array<[string, string]> {
  return Object.entries(artifact)
    .filter(
      ([key, value]) =>
        !HIDDEN_KEYS.has(key) &&
        ![
          "title",
          "summary",
          "body",
          "memo",
          "message",
          "generatedAt",
        ].includes(key) &&
        !Array.isArray(value) &&
        !isRecord(value) &&
        value !== null &&
        value !== undefined,
    )
    .map(
      ([key, value]) =>
        [labelForKey(key), textValue(value)] as [string, string],
    )
    .filter(([, value]) => value.trim().length > 0)
    .slice(0, 8);
}

function rowTitle(row: JsonRecord): string {
  for (const key of TITLE_KEYS) {
    const value = stringValue(row[key]);
    if (value) return value;
  }
  return "";
}

function parseResult(value: unknown): JsonRecord {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value : {};
}

function recordValue(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return value.map(textValue).filter(Boolean).join(", ");
  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([key]) => !HIDDEN_KEYS.has(key))
      .map(([key, item]) => `${labelForKey(key)}: ${textValue(item)}`)
      .filter((item) => !item.endsWith(": "))
      .join("; ");
  }
  return "";
}

function titleForType(type: unknown): string {
  const text = stringValue(type);
  return text ? labelForKey(text) : "Business result";
}

function sectionTitleForKey(key: string): string {
  if (key === "items") return "Items";
  if (key === "records") return "Records";
  if (key === "metrics") return "Metrics";
  if (key === "recentActivity") return "Recent activity";
  if (key === "nextSteps") return "Next steps";
  if (key === "details") return "Details";
  return labelForKey(key);
}

function labelForKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}
