import { app } from "$lib/server/runtime";
import type { RequestEvent } from "@sveltejs/kit";

export function GET({ request }: RequestEvent) {
  return app.fetch(request);
}

export function POST({ request }: RequestEvent) {
  return app.fetch(request);
}

export function PUT({ request }: RequestEvent) {
  return app.fetch(request);
}

export function DELETE({ request }: RequestEvent) {
  return app.fetch(request);
}

export function PATCH({ request }: RequestEvent) {
  return app.fetch(request);
}
