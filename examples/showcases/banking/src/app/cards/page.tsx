"use client";
// The `/cards` route mirrors the dashboard overview (it shares the same
// `useCreditCards` data). Re-export the redesigned dashboard so both routes
// stay visually identical without duplicating the layout.
export { default } from "@/app/dashboard/page";
