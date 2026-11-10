import { describe, expect, it } from "vitest";
import { GmailApiError, GmailClient, RefreshTokenAuth } from "../gmail-api.js";
import { FakeGmail } from "./fake-gmail.js";

const creds = {
  clientId: "id",
  clientSecret: "secret",
  refreshToken: "refresh",
};

describe("RefreshTokenAuth", () => {
  it("caches the token until shortly before it expires", async () => {
    const gmail = new FakeGmail();
    let now = 0;
    const auth = new RefreshTokenAuth(creds, gmail.fetch, () => now);

    expect(await auth.getAccessToken()).toBe("token-1");
    now = 3_500_000; // Still inside the lifetime minus the 60 s margin.
    expect(await auth.getAccessToken()).toBe("token-1");
    now = 3_545_000; // Past expires_in minus the 60 s margin.
    expect(await auth.getAccessToken()).toBe("token-2");
  });

  it("shares one refresh between concurrent callers", async () => {
    const gmail = new FakeGmail();
    const auth = new RefreshTokenAuth(creds, gmail.fetch);
    const tokens = await Promise.all([
      auth.getAccessToken(),
      auth.getAccessToken(),
    ]);
    expect(tokens).toEqual(["token-1", "token-1"]);
    expect(gmail.tokenRequests).toBe(1);
  });

  it("sends the refresh-token grant", async () => {
    const bodies: string[] = [];
    const auth = new RefreshTokenAuth(creds, async (_url, init) => {
      bodies.push(String(init?.body));
      return Response.json({ access_token: "t", expires_in: 3600 });
    });
    await auth.getAccessToken();
    expect(new URLSearchParams(bodies[0])).toEqual(
      new URLSearchParams({
        client_id: "id",
        client_secret: "secret",
        refresh_token: "refresh",
        grant_type: "refresh_token",
      }),
    );
  });

  it("fails clearly when Google refuses the refresh token", async () => {
    const auth = new RefreshTokenAuth(creds, async () =>
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    );
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(GmailApiError);
  });
});

describe("GmailClient", () => {
  it("refreshes the token and retries once after a 401", async () => {
    const gmail = new FakeGmail();
    const auth = new RefreshTokenAuth(creds, gmail.fetch);
    const client = new GmailClient({
      fetch: gmail.fetch,
      getAccessToken: () => auth.getAccessToken(),
      onUnauthorized: () => auth.invalidate(),
    });
    await client.getProfile();
    gmail.failNextWithUnauthorized = true;

    const profile = await client.getProfile();

    expect(profile.emailAddress).toBe("bot@example.com");
    expect(gmail.tokenRequests).toBe(2);
  });

  it("asks watch to include only the intake label", async () => {
    const gmail = new FakeGmail();
    const client = new GmailClient({
      fetch: gmail.fetch,
      getAccessToken: async () => "t",
    });
    await client.watch({
      topicName: "projects/p/topics/gmail",
      labelIds: ["INBOX"],
    });
    expect(gmail.watchCalls).toEqual([
      {
        topicName: "projects/p/topics/gmail",
        labelIds: ["INBOX"],
        labelFilterBehavior: "include",
      },
    ]);
  });
});
