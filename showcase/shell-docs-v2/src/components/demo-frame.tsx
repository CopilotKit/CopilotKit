"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AppWindow, CodeXml, ExternalLink, RotateCw } from "lucide-react";
import { SiGithub } from "react-icons/si";
import { PixelMatrix } from "@/components/brand/pixel-matrix";
import { MATRIX_GROUND, STAGE_WINDOW, Stage } from "@/components/brand/stage";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const noop = () => () => {};

/** One page a demo window can show: the live demo, its code, and so on. */
export interface DemoView {
  label: string;
  /** A page to show in an iframe. */
  src?: string;
  /** Or content to show in the window itself, like the demo's code. */
  content?: ReactNode;
  /** For screen readers (the iframe's title); defaults to the label. */
  title?: string;
}

/** The address a single-view bar shows: host and path, no query. */
const address = (src: string) =>
  src.replace(/^https?:\/\//, "").split(/[?#]/)[0];

/**
 * One view's iframe. It mounts after hydration (so its load event is never
 * missed); while it wakes the matrix glistens behind a mint spinner, and after
 * 12s it offers the new tab instead.
 */
function LiveFrame({ src, title }: { src: string; title: string }) {
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 12000);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <>
      {mounted ? (
        <iframe
          src={src}
          title={title}
          loading="lazy"
          allow="clipboard-write; microphone"
          onLoad={() => setLoaded(true)}
          className={`absolute inset-0 size-full border-0 transition-opacity duration-300 motion-reduce:transition-none ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      ) : null}
      {loaded ? null : (
        <div
          className={`absolute inset-0 isolate flex flex-col items-center justify-center gap-3 px-6 text-center ${MATRIX_GROUND}`}
        >
          {/* The matrix glistens while the demo wakes. */}
          <PixelMatrix glisten />
          <Spinner className="size-6 text-brand-mint-deep" />
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {slow ? (
              <>
                Still waking up.{" "}
                <a
                  href={src}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-primary underline underline-offset-4"
                >
                  Open it in a new tab
                </a>
              </>
            ) : (
              "Waking up the demo"
            )}
          </p>
        </div>
      )}
    </>
  );
}

const BAR_BUTTON = "size-8 text-muted-foreground hover:text-foreground";

/**
 * A live demo in a docs page, framed the way copilotkit.ai frames its demos:
 * a lilac stage carrying the pixel matrix (lit under the pointer), with the
 * demo in a white app window on it. With several `views` (a demo and its
 * code), a segmented switch in the window's bar flips between them in place;
 * each view loads the first time it's shown and keeps its state after. The
 * bar also opens the current view in a new tab, reloads it, and links to the
 * source on GitHub when there's one.
 */
export function DemoFrame({
  src,
  title,
  label,
  views,
  sourceHref,
  height = 560,
  children,
}: {
  /** The demo's URL (when there's one view). */
  src?: string;
  /** What the demo is, for screen readers (the iframe's title). */
  title?: string;
  /** The demo's name, in the bar; defaults to a single view's address. */
  label?: string;
  /** Several pages for one window, switched in its bar. */
  views?: DemoView[];
  /** The demo's source on GitHub, for the bar's GitHub button. */
  sourceHref?: string;
  /** Frame height in px; capped at 70% of the viewport. */
  height?: number;
  /** An optional caption under the stage. */
  children?: ReactNode;
}) {
  const all: DemoView[] = views?.length
    ? views
    : [{ label: label ?? address(src ?? ""), src: src ?? "", title }];
  const [active, setActive] = useState(0);
  const [visited, setVisited] = useState<ReadonlySet<number>>(
    () => new Set([0]),
  );
  // A reload remounts only the view on show.
  const [reloads, setReloads] = useState<Record<number, number>>({});
  const current = all[active] ?? all[0];
  const switchable = all.length > 1;

  const bar = (
    <div className="grid h-11 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b bg-card ps-3.5 pe-1.5">
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex shrink-0 gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-brand-red" />
          <span className="size-2.5 rounded-full bg-brand-orange" />
          <span className="size-2.5 rounded-full bg-band-controlled" />
        </span>
        {switchable && label ? (
          <span className="truncate font-mono text-xs text-muted-foreground max-sm:hidden">
            {label}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 justify-center">
        {switchable ? (
          <TabsList className="h-8 rounded-full bg-secondary p-0.5">
            {all.map((view, i) => (
              <TabsTrigger
                key={view.label}
                value={i}
                className="h-full cursor-pointer rounded-full px-3.5 text-xs data-active:shadow-sm"
              >
                {VIEW_ICONS[view.label.toLowerCase()] ?? null}
                {view.label}
              </TabsTrigger>
            ))}
          </TabsList>
        ) : (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {current.label}
          </span>
        )}
      </span>
      <span className="flex min-w-0 items-center justify-end">
        {current.src ? (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Open the ${current.label.toLowerCase()} in a new tab`}
              title="Open in a new tab"
              render={
                <a
                  href={current.src}
                  target="_blank"
                  rel="noreferrer noopener"
                />
              }
              nativeButton={false}
              className={BAR_BUTTON}
            >
              <ExternalLink aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Reload the ${current.label.toLowerCase()}`}
              title="Reload"
              onClick={() =>
                setReloads((r) => ({ ...r, [active]: (r[active] ?? 0) + 1 }))
              }
              className={BAR_BUTTON}
            >
              <RotateCw aria-hidden="true" />
            </Button>
          </>
        ) : null}
        {sourceHref ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="View the demo's code on GitHub"
            title="View the code on GitHub"
            render={
              <a href={sourceHref} target="_blank" rel="noreferrer noopener" />
            }
            nativeButton={false}
            className={BAR_BUTTON}
          >
            <SiGithub aria-hidden="true" />
          </Button>
        ) : null}
      </span>
    </div>
  );

  const frames = all.map((view, i) => {
    const frame = !visited.has(i) ? null : view.src ? (
      <LiveFrame
        key={reloads[i] ?? 0}
        src={view.src}
        title={view.title ?? view.label}
      />
    ) : (
      // Content (like the code) fills the window and scrolls in it.
      <div className="absolute inset-0 overflow-auto bg-card">
        {view.content}
      </div>
    );
    return switchable ? (
      <TabsContent
        key={view.label}
        value={i}
        keepMounted
        className="absolute inset-0 data-hidden:hidden"
      >
        {frame}
      </TabsContent>
    ) : (
      <span key={view.label}>{frame}</span>
    );
  });

  const body = (
    <div
      className="relative bg-white"
      style={{ height: `min(${height}px, 70vh)` }}
    >
      {frames}
    </div>
  );

  return (
    <figure className="not-prose my-8 flex flex-col gap-3">
      <Stage>
        <div className={`overflow-hidden bg-card ${STAGE_WINDOW}`}>
          {switchable ? (
            <Tabs
              value={active}
              onValueChange={(value) => {
                const i = Number(value);
                setActive(i);
                setVisited((v) => new Set(v).add(i));
              }}
              className="gap-0"
            >
              {bar}
              {body}
            </Tabs>
          ) : (
            <>
              {bar}
              {body}
            </>
          )}
        </div>
      </Stage>
      {children ? (
        <figcaption className="text-sm text-muted-foreground">
          {children}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** A glyph for the views the docs use most. */
const VIEW_ICONS: Record<string, ReactNode> = {
  demo: <AppWindow aria-hidden="true" className="size-3.5" />,
  code: <CodeXml aria-hidden="true" className="size-3.5" />,
};
