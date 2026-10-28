import Image from "next/image";
import { ExternalLink } from "lucide-react";

/** A captured screenshot of how another docs site solves the problem. */
export function IdeaReference({
  src,
  app,
  href,
  children,
}: {
  src: string;
  app: string;
  href: string;
  children?: React.ReactNode;
}) {
  return (
    <figure className="not-prose my-6 overflow-hidden rounded-2xl border bg-fd-card">
      <Image
        src={src}
        alt={`${app} docs, captured 2026-10-26`}
        width={1200}
        height={750}
        className="h-auto w-full border-b"
      />
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
