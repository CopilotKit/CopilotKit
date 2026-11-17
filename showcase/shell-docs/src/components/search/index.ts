"use client";

import { lazy } from "react";

/** The search dialog, loaded on first use as Fumadocs loads its default one. */
export const DocsSearchDialog = lazy(() => import("./docs-search-dialog"));
