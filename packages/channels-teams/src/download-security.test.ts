import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildFileContentParts } from "./download-files.js";

describe("attachment download trust boundary", () => {
  let server: Server;
  let url: string;
  let hits = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      hits++;
      res.end("synthetic-local-secret");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/file`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each(["contentUrl", "downloadUrl"])(
    "refuses loopback in %s before any request",
    async (field) => {
      hits = 0;
      const attachment =
        field === "contentUrl"
          ? { name: "file.txt", contentType: "text/plain", contentUrl: url }
          : {
              name: "file.txt",
              contentType: "application/vnd.microsoft.teams.file.download.info",
              content: { downloadUrl: url },
            };
      const result = await buildFileContentParts([attachment]);
      expect(hits).toBe(0);
      expect(result.parts).toEqual([]);
      expect(result.notes).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain("synthetic-local-secret");
    },
  );
});
