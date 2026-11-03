import { ExternalLink } from "lucide-react";

/** A link to how another docs site solves the problem, with a caption. */
export function IdeaReference({
  app,
  href,
  children,
}: {
  app: string;
  href: string;
  children?: React.ReactNode;
}) {
  return (
    <figure className="not-prose my-6 rounded-2xl border bg-fd-card">
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
        <span className="font-medium">{app}</span>
        {children ? (
          <span className="text-fd-muted-foreground">{children}</span>
        ) : null}
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="ms-auto inline-flex items-center gap-1 text-fd-primary underline-offset-4 hover:underline"
        >
          Open
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </figcaption>
    </figure>
  );
}
