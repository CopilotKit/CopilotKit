import { afterEach, describe, expect, it, vi } from "vitest";
import { installClickCapture } from "../clicks";
import { installInputCapture } from "../inputs";
import { installNavigationCapture } from "../navigation";
import { installNetworkCapture } from "../network";
import type { BodySnapshot } from "../network-body";
import { createRedactor, isCredentialKey } from "../redact";

interface NetworkEvent {
  url: string;
  outcome: string;
  request: { headers: Record<string, string>; body: BodySnapshot };
  response: {
    url?: string;
    headers: Record<string, string>;
    body: BodySnapshot;
  };
}

const PAGE_ORIGIN = "http://localhost:3000";
const realFetch = globalThis.fetch;
const uninstalls: (() => void)[] = [];
const isTrusted = () => true;

afterEach(() => {
  uninstalls.splice(0).forEach((uninstall) => uninstall());
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
});

function setup(fakeFetch: typeof fetch = async () => new Response("ok")) {
  globalThis.fetch = fakeFetch;
  const redact = createRedactor();
  const network: NetworkEvent[] = [];
  const other: { name: string; value: Record<string, unknown> }[] = [];
  const emit = (name: string, value: Record<string, unknown>) => {
    if (name === "network") network.push(value as unknown as NetworkEvent);
    else other.push({ name, value });
  };
  uninstalls.push(
    installNetworkCapture({ emit, ignoreUrls: [], redact }),
    installInputCapture({ emit, isTrusted, redact }),
    installClickCapture({ emit, getRoute: () => "/", isTrusted, redact }),
    installNavigationCapture({ emit, redact }),
  );
  return { network, other };
}

async function captured(events: NetworkEvent[], count = 1) {
  await vi.waitFor(() => expect(events).toHaveLength(count));
  return events[count - 1]!;
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function streamed(text: string, contentType = "application/json") {
  return async () =>
    new Response(text, { headers: { "content-type": contentType } });
}

class FakeXhr extends EventTarget {
  status = 200;
  responseType: XMLHttpRequestResponseType = "text";
  responseText = '{"refresh_token":"xhr-refresh-secret","expires":60}';
  responseURL = "";
  open(_method: string, _url: string | URL) {}
  setRequestHeader() {}
  getAllResponseHeaders() {
    return "Content-Type: application/json\r\n";
  }
  send(_body?: unknown) {}
  finish() {
    this.dispatchEvent(new Event("loadend"));
  }
}

describe("credential key matcher", () => {
  it.each([
    "password",
    "newPassword",
    "user_passwd",
    "Pass-Phrase",
    "passcode",
    "client_secret",
    "api_key",
    "X-API-Key",
    "access_token",
    "refreshToken",
    "id.token",
    "auth token",
    "session_token",
    "private-key",
    "credentials",
    "pwd",
    "PASS",
    "token",
    "otp",
  ])("matches %s", (key) => expect(isCredentialKey(key)).toBe(true));

  it.each([
    "name",
    "email",
    "id",
    "tokenCount",
    "tokens",
    "passenger",
    "otpEnabled",
    "",
  ])("does not match %s", (key) => expect(isCredentialKey(key)).toBe(false));
});

describe("body redaction", () => {
  it("redacts a JSON login body sent with fetch and keeps other fields", async () => {
    const { network } = setup();
    await fetch("/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "alice@example.com",
        name: "Alice",
        password: "hunter2-secret",
      }),
    });
    const event = await captured(network);
    expect(event.request.body).toMatchObject({
      status: "complete",
      text: '{"email":"alice@example.com","name":"Alice","password":"[redacted]"}',
    });
  });

  it("redacts XHR request and response bodies", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const { network } = setup();
    const xhr = new FakeXhr();
    xhr.open("POST", "/login");
    xhr.send(JSON.stringify({ user: "alice", passwd: "xhr-password-secret" }));
    xhr.finish();
    const event = await captured(network);
    expect(event.request.body.text).toBe(
      '{"user":"alice","passwd":"[redacted]"}',
    );
    expect(event.response.body.text).toBe(
      '{"refresh_token":"[redacted]","expires":60}',
    );
  });

  it("redacts nested objects and arrays at any depth", async () => {
    const { network } = setup();
    await fetch("/settings", {
      method: "POST",
      body: JSON.stringify({
        id: 7,
        accounts: [
          { name: "a", apiKey: "nested-api-key-secret", tokenCount: 12 },
          { name: "b", auth: { "Client-Secret": "deep-client-secret" } },
        ],
        credentials: { user: "alice", pin: "1234" },
      }),
    });
    const event = await captured(network);
    expect(JSON.parse(event.request.body.text!)).toEqual({
      id: 7,
      accounts: [
        { name: "a", apiKey: "[redacted]", tokenCount: 12 },
        { name: "b", auth: { "Client-Secret": "[redacted]" } },
      ],
      credentials: "[redacted]",
    });
  });

  it("keeps JSON formatting when nothing is redacted", async () => {
    const { network } = setup();
    const body = '{ "email": "alice@example.com", "tokenCount": 3 }';
    await fetch("/profile", { method: "POST", body });
    expect((await captured(network)).request.body.text).toBe(body);
  });

  it("redacts urlencoded string and URLSearchParams bodies per field", async () => {
    const { network } = setup();
    await fetch("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=alice%40example.com&password=form-secret&name=Alice",
    });
    await fetch("/login", {
      method: "POST",
      body: new URLSearchParams({
        user: "alice",
        access_token: "params-secret",
      }),
    });
    await captured(network, 2);
    expect(network[0]!.request.body.text).toBe(
      "email=alice%40example.com&password=[redacted]&name=Alice",
    );
    const params = new URLSearchParams(network[1]!.request.body.text);
    expect(params.get("user")).toBe("alice");
    expect(params.get("access_token")).toBe("[redacted]");
  });

  it("redacts FormData fields", async () => {
    const { network } = setup();
    const form = new FormData();
    form.append("username", "alice");
    form.append("password", "multipart-secret");
    await fetch("/login", { method: "POST", body: form });
    const text = (await captured(network)).request.body.text!;
    expect(text).toContain("alice");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("multipart-secret");
  });

  it("redacts tokens in a streamed response body", async () => {
    const { network } = setup(
      streamed(
        '{"access_token":"oauth-access-secret","token_type":"bearer","expires_in":3600}',
      ),
    );
    await fetch("/oauth/token", { method: "POST" });
    const event = await captured(network);
    expect(event.response.body.text).toBe(
      '{"access_token":"[redacted]","token_type":"bearer","expires_in":3600}',
    );
  });

  it("redacts truncated or invalid JSON with the pair fallback", async () => {
    const { network } = setup(
      streamed(
        `{"note":"${"n".repeat(3900)}","access_token":"cut-off-${"s".repeat(300)}"}`,
      ),
    );
    await fetch("/oauth/token", {
      method: "POST",
      body: '{"email":"a@example.com","password":"invalid-json-secret",',
    });
    const event = await captured(network);
    expect(event.request.body.text).toBe(
      '{"email":"a@example.com","password":"[redacted]",',
    );
    expect(event.response.body.status).toBe("truncated");
    expect(event.response.body.text).not.toContain("cut-off");
    expect(event.response.body.text).toContain('"access_token":"[redacted]"');
  });

  it("does not leak the prefix of a value longer than the snapshot limit", async () => {
    const { network } = setup(streamed(`{"id_token":"${"T".repeat(5000)}"}`));
    await fetch("/login", {
      method: "POST",
      body: JSON.stringify({
        email: "a@example.com",
        password: "P".repeat(5000),
      }),
    });
    const event = await captured(network);
    expect(event.request.body).toMatchObject({
      status: "complete",
      text: '{"email":"a@example.com","password":"[redacted]"}',
    });
    expect(event.response.body.text).not.toMatch(/TT/);
    expect(event.response.body.text).toContain("[redacted]");
  });
});

describe("remembered password values", () => {
  it("redacts a typed password under a custom key in bodies and URLs", async () => {
    document.body.innerHTML = '<input id="secret-field" type="password">';
    const { network } = setup();
    type(document.querySelector("input")!, "c0rrect horse!");
    await fetch("/login", {
      method: "POST",
      body: JSON.stringify({ pw: "c0rrect horse!", email: "a@example.com" }),
    });
    await fetch("/login?pw=c0rrect%20horse!&next=%2Fhome");
    await fetch("/login", {
      method: "POST",
      body: new URLSearchParams({ pw: "c0rrect horse!" }),
    });
    await captured(network, 3);
    expect(network[0]!.request.body.text).toBe(
      '{"pw":"[redacted]","email":"a@example.com"}',
    );
    expect(network[1]!.url).toBe(
      `${PAGE_ORIGIN}/login?pw=[redacted]&next=%2Fhome`,
    );
    expect(network[2]!.request.body.text).toBe("pw=[redacted]");
    expect(JSON.stringify(network)).not.toMatch(/horse/);
  });
});

describe("URL redaction", () => {
  it("redacts credential query values in network URLs and keeps the rest", async () => {
    const { network } = setup();
    await fetch(
      "/search?q=deals&password=query-secret&access_token=tok&page=2",
    );
    const event = await captured(network);
    expect(event.url).toBe(
      `${PAGE_ORIGIN}/search?q=deals&password=[redacted]&access_token=[redacted]&page=2`,
    );
  });

  it("redacts credential query and hash values in navigation", () => {
    const { other } = setup();
    history.pushState(null, "", "/callback?access_token=nav-secret&state=s1");
    history.pushState(null, "", "/done?view=full#id_token=hash-secret&x=1");
    const navigation = other.filter(({ name }) => name === "navigation");
    expect(navigation.map(({ value }) => value.to)).toEqual([
      `${location.origin}/callback?access_token=[redacted]&state=s1`,
      `${location.origin}/done?view=full#id_token=[redacted]&x=1`,
    ]);
    expect(navigation[1]!.value.from).toBe(
      `${location.origin}/callback?access_token=[redacted]&state=s1`,
    );
  });

  it("strips userinfo from successful and failed fetch URLs", async () => {
    const native = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("ok"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { network } = setup(native);
    await fetch("https://alice:userinfo-secret@api.example.com/a");
    await fetch("https://bob:other-secret@api.example.com/b").catch(() => {});
    await captured(network, 2);
    expect(network.map(({ url, outcome }) => [url, outcome])).toEqual(
      expect.arrayContaining([
        ["https://api.example.com/a", "ok"],
        ["https://api.example.com/b", "error"],
      ]),
    );
    expect(JSON.stringify(network)).not.toMatch(/secret|alice|bob/);
  });
});

describe("password-like fields", () => {
  it("keeps redacting after a show-password toggle switches the type to text", () => {
    document.body.innerHTML = '<input id="pw" type="password">';
    const { other } = setup();
    const input = document.querySelector("input")!;
    type(input, "toggle-secret");
    input.type = "text";
    input.setAttribute("value", "toggle-secret-2");
    type(input, "toggle-secret-2");
    input.click();
    expect(other.map(({ name }) => name)).toEqual(["input", "input", "click"]);
    for (const { value } of other)
      expect(value.target).toMatchObject({ value: "[redacted]" });
    expect(other[2]!.value.target).toMatchObject({
      attributes: { value: "[redacted]" },
    });
    expect(JSON.stringify(other)).not.toContain("toggle-secret");
  });

  it.each(["current-password", "new-password", "one-time-code"])(
    "redacts a text input with autocomplete=%s",
    (autocomplete) => {
      document.body.innerHTML = `<input type="text" autocomplete="${autocomplete}">`;
      const { other } = setup();
      type(document.querySelector("input")!, "autocomplete-secret");
      expect(other[0]!.value.target).toMatchObject({ value: "[redacted]" });
    },
  );

  it("still captures ordinary text inputs raw", () => {
    document.body.innerHTML = '<input name="email" type="email">';
    const { other } = setup();
    type(document.querySelector("input")!, "alice@example.com");
    expect(other[0]!.value.target).toMatchObject({
      value: "alice@example.com",
    });
  });
});

describe("credential headers", () => {
  it("redacts the additional credential headers and keeps their names", async () => {
    const { network } = setup();
    const credentials = [
      "x-auth-token",
      "x-access-token",
      "x-csrf-token",
      "api-key",
      "x-goog-api-key",
      "x-amz-security-token",
    ];
    await fetch("/api", {
      headers: {
        ...Object.fromEntries(
          credentials.map((name) => [name, "header-secret"]),
        ),
        "x-request-id": "req-1",
      },
    });
    const event = await captured(network);
    expect(event.request.headers).toEqual({
      ...Object.fromEntries(credentials.map((name) => [name, "[redacted]"])),
      "x-request-id": "req-1",
    });
  });
});
