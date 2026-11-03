"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useStack } from "@/components/stack/stack-provider";
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
 * The prototypes: the framework is in the URL and the frontend is the
 * page's chips, so switching opens the same page on the new framework.
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
  const { frontend, setFrontend } = useFrontend();

  const onSwitch = useCallback(
    (nextFrontend: string, nextFramework: string) => {
      setFrontend(nextFrontend as ProtoFrontendId);
      router.push(frameworkHref(variant, nextFramework, slug));
      const name = FRAMEWORKS.find((f) => f.id === nextFramework)?.name;
      return `Opened the docs for ${name} on ${nextFrontend}.`;
    },
    [router, setFrontend, variant, slug],
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
