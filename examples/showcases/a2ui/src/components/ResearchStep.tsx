import { useRenderTool } from "@copilotkit/react-core/v2";
import { Check, ImageIcon, Search } from "lucide-react";
import { z } from "zod";

interface ResearchResult {
  summary?: string;
  sources?: { title: string; url: string }[];
  error?: string;
}

interface ImagesResult {
  images?: { url: string; description?: string }[];
  error?: string;
}

function parseResult<T>(result: unknown): T | undefined {
  if (!result) return undefined;
  if (typeof result === "object") return result as T;
  try {
    return JSON.parse(String(result)) as T;
  } catch {
    return undefined;
  }
}

/** The site a source comes from: grounding titles are usually the domain. */
function siteOf(source: { title: string; url: string }) {
  const title = source.title.trim().toLowerCase();
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(title))
    return title.replace(/^www\./, "");
  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    return source.title;
  }
}

/** One chip per site, linking its first source. */
function bySite(sources: { title: string; url: string }[]) {
  const seen = new Map<string, { site: string; url: string }>();
  for (const source of sources) {
    const site = siteOf(source);
    if (!seen.has(site)) seen.set(site, { site, url: source.url });
  }
  return [...seen.values()];
}

/**
 * One quiet line per research step: the query while it runs, then its
 * sources, or for a picture search, the pictures it found.
 */
export function useResearchSteps() {
  useRenderTool({
    name: "find_images",
    parameters: z.object({ query: z.string(), count: z.number().optional() }),
    render: ({ status, parameters, result }) => {
      const done = status === "complete";
      const images = done
        ? (parseResult<ImagesResult>(result)?.images ?? [])
        : [];
      return (
        <div className="research-step" data-done={done || undefined}>
          <span className="research-step__mark" aria-hidden>
            {done ? (
              <Check size={13} strokeWidth={2.25} />
            ) : (
              <ImageIcon size={13} strokeWidth={2.25} />
            )}
          </span>
          <span className="research-step__body">
            <span className="research-step__label">
              {done
                ? images.length
                  ? `Found ${images.length} ${images.length === 1 ? "picture" : "pictures"}`
                  : "No pictures for"
                : "Looking for pictures of"}
            </span>{" "}
            <span className="research-step__query">
              {parameters?.query ?? "…"}
            </span>
            {images.length > 0 && (
              <span className="research-step__thumbs" aria-hidden>
                {images.slice(0, 4).map((image) => (
                  <img key={image.url} src={image.url} alt="" loading="lazy" />
                ))}
              </span>
            )}
          </span>
        </div>
      );
    },
  });

  useRenderTool({
    name: "web_research",
    parameters: z.object({ query: z.string() }),
    render: ({ status, parameters, result }) => {
      const done = status === "complete";
      const parsed = done ? parseResult<ResearchResult>(result) : undefined;
      const sites = bySite(parsed?.sources ?? []);
      return (
        <div className="research-step" data-done={done || undefined}>
          <span className="research-step__mark" aria-hidden>
            {done ? (
              <Check size={13} strokeWidth={2.25} />
            ) : (
              <Search size={13} strokeWidth={2.25} />
            )}
          </span>
          <span className="research-step__body">
            <span className="research-step__label">
              {done ? "Researched" : "Researching"}
            </span>{" "}
            <span className="research-step__query">
              {parameters?.query ?? "…"}
            </span>
            {done && parsed?.error && (
              <span className="research-step__error">
                {" "}
                · search unavailable
              </span>
            )}
            {sites.length > 0 && (
              <span className="research-step__sources">
                {sites.slice(0, 5).map((source) => (
                  <a
                    key={source.site}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="research-step__source"
                  >
                    <img
                      className="research-step__favicon"
                      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(source.site)}&sz=32`}
                      alt=""
                      width={14}
                      height={14}
                      loading="lazy"
                    />
                    {source.site}
                  </a>
                ))}
                {sites.length > 5 && (
                  <span className="research-step__more">
                    +{sites.length - 5}
                  </span>
                )}
              </span>
            )}
          </span>
        </div>
      );
    },
  });
}
