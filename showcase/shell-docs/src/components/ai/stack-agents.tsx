"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useStack } from "@/components/stack/stack-provider";
import { frontendHref, liveFrontend, scopeFromPath } from "@/lib/live-scope";
import {
  BACKENDS,
  FRONTENDS,
  backendById,
  frontendById,
  isServable,
  type FrontendId,
} from "@/lib/stack";
import { useFrontend } from "@/proto/frontend";
import {
  FRAMEWORKS,
  FRONTENDS as PROTO_FRONTENDS,
  type FrontendId as ProtoFrontendId,
} from "@/proto/data";
import { frameworkHref, type VariantId } from "@/proto/routes";
import { StackAgent } from "./docs-agent";

/** `/docs`: the stack is the sidebar picker's choice. */
export function DocsStackAgent() {
  const { stack, setStack } = useStack();

  const onSwitch = useCallback(
    (frontend: string, backend: string) => {
      const next = { frontend: frontend as FrontendId, backend };
      const names = `${frontendById(frontend)?.name} with ${backendById(backend)?.name}`;
      if (!isServable(next)) return `The docs don't cover ${names} yet.`;
      setStack(next);
      return `Switched the docs to ${names}.`;
    },
    [setStack],
  );

  return (
    <StackAgent
      frontend={stack?.frontend ?? null}
      agentFramework={stack?.backend ?? null}
      frontends={FRONTENDS}
      frameworks={BACKENDS}
      onSwitch={onSwitch}
    />
  );
}

/**
 * The prototypes: the framework and the frontend are in the URL, so
 * switching opens the same page on the new stack, as the sidebar's stack
 * picker (`StackRows`) does.
 */
export function ProtoStackAgent({
  variant,
  framework,
  slug,
}: {
  variant: VariantId;
  /** The framework in the URL, if the page is under one. */
  framework?: string;
  slug?: string;
}) {
  const router = useRouter();
  const { setFrontend } = useFrontend();
  const pathname = usePathname() ?? "";
  const { frontend } = scopeFromPath(pathname.split("/").filter(Boolean));

  const onSwitch = useCallback(
    (nextFrontend: string, nextFramework: string) => {
      const path = pathname.split("/").filter(Boolean);
      // The new framework keeps the URL's frontend (`/vue`) and the page.
      const prefix = liveFrontend(path[0]) ? `/${path[0]}` : "";
      const page =
        nextFramework === framework
          ? path
          : `${prefix}${frameworkHref(variant, nextFramework, slug)}`
              .split("/")
              .filter(Boolean);
      const next = nextFrontend as ProtoFrontendId;
      // Remembered for the pages that aren't per frontend.
      setFrontend(next);
      router.push(
        next === frontend ? `/${page.join("/")}` : frontendHref(page, next),
      );
      const name = FRAMEWORKS.find((f) => f.id === nextFramework)?.name;
      return `Opened the docs for ${name} on ${nextFrontend}.`;
    },
    [router, setFrontend, pathname, frontend, framework, variant, slug],
  );

  return (
    <StackAgent
      frontend={frontend}
      agentFramework={framework ?? null}
      frontends={PROTO_FRONTENDS}
      frameworks={FRAMEWORKS}
      onSwitch={onSwitch}
    />
  );
}
