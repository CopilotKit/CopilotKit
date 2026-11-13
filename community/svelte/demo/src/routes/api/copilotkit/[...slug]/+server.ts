import { app } from "$lib/server/runtime";

export function GET({ request }) {
  return app.fetch(request);
}

export function POST({ request }) {
  return app.fetch(request);
}

export function PUT({ request }) {
  return app.fetch(request);
}

export function DELETE({ request }) {
  return app.fetch(request);
}

export function PATCH({ request }) {
  return app.fetch(request);
}
