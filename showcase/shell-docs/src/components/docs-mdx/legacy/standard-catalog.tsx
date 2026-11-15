"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  CATALOG_REFERENCE_PATH,
  catalogComponentHref,
  catalogComponentNames,
} from "@/components/standard-catalog/catalog-reference";

/**
 * shell-docs' `<StandardCatalog />`: renders nothing, and moves an old
 * `#box`-style anchor on the catalog page to that component's own page
 * (`/generative-ui/components/standard-catalog/box`), in the page's scope.
 */
export function StandardCatalog() {
  const router = useRouter();
  useEffect(() => {
    const followLegacyAnchor = () => {
      const id = window.location.hash.slice(1).toLowerCase();
      const name = catalogComponentNames().find(
        (component) => component.toLowerCase() === id,
      );
      if (!name) return;
      // `/vue/mastra/generative-ui/...` keeps its `/vue/mastra` prefix.
      const { pathname } = window.location;
      const prefix = pathname.endsWith(CATALOG_REFERENCE_PATH)
        ? pathname.slice(0, -CATALOG_REFERENCE_PATH.length)
        : "";
      router.replace(`${prefix}${catalogComponentHref(name)}`);
    };
    followLegacyAnchor();
    window.addEventListener("hashchange", followLegacyAnchor);
    return () => window.removeEventListener("hashchange", followLegacyAnchor);
  }, [router]);
  return null;
}
