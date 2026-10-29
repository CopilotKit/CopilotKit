"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  catalogComponentNames,
  catalogComponentHref,
} from "./catalog-reference";

export function StandardCatalog() {
  const router = useRouter();
  useEffect(() => {
    const followLegacyAnchor = () => {
      const id = window.location.hash.slice(1).toLowerCase();
      const name = catalogComponentNames().find(
        (component) => component.toLowerCase() === id,
      );
      if (name) router.replace(catalogComponentHref(name));
    };
    followLegacyAnchor();
    window.addEventListener("hashchange", followLegacyAnchor);
    return () => window.removeEventListener("hashchange", followLegacyAnchor);
  }, [router]);
  return null;
}
