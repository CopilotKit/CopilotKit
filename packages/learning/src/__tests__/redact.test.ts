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
// jsdom implements neither navigation nor form submission.
const prevent = (event: Event) => event.preventDefault();

afterEach(() => {
  uninstalls.splice(0).forEach((uninstall) => uninstall());
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
});

function setup(
  fakeFetch: typeof fetch = async () => new Response("ok"),
  { inputs = true } = {},
) {
  globalThis.fetch = fakeFetch;
  const redact = createRedactor();
  uninstalls.push(redact.watch());
  const network: NetworkEvent[] = [];
  const other: { name: string; value: Record<string, unknown> }[] = [];
  const emit = (name: string, value: Record<string, unknown>) => {
    if (name === "network") network.push(value as unknown as NetworkEvent);
    else other.push({ name, value });
  };
  uninstalls.push(
    installNetworkCapture({ emit, ignoreUrls: [], redact }),
    inputs ? installInputCapture({ emit, isTrusted, redact }) : () => {},
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

  it("redacts a value cut off by a size limit", () => {
    const text = createRedactor().body(
      '{"note":"x","access_token":"cut-off-sec',
    );
    expect(text).toContain('"access_token":"[redacted]');
    expect(text).not.toContain("cut-off");
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
    expect(other.map(({ name }) => name)).toEqual(["input", "click"]);
    for (const { value } of other)
      expect(value.target).toMatchObject({ value: "[redacted]" });
    expect(other[1]!.value.target).toMatchObject({
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
      window.dispatchEvent(new Event("pagehide"));
      expect(other[0]!.value.target).toMatchObject({ value: "[redacted]" });
    },
  );

  it("still captures ordinary text inputs raw", () => {
    document.body.innerHTML = '<input name="email" type="email">';
    const { other } = setup();
    type(document.querySelector("input")!, "alice@example.com");
    window.dispatchEvent(new Event("pagehide"));
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

describe("credentials inside string values", () => {
  it.each([
    ["JSON in a string", { payload: JSON.stringify({ password: "LEAK1" }) }],
    ["GraphQL", { query: 'mutation { login(email: "a", password: "LEAK2") }' }],
    ["a form in a string", { body: "user=a&password=LEAK3" }],
    ["a URL in a string", { next: "https://x.test/cb?access_token=LEAK4" }],
    [
      "tool-call arguments",
      {
        tool_calls: [
          {
            function: {
              name: "login",
              arguments: JSON.stringify({ user: "a", passwd: "LEAK5" }),
            },
          },
        ],
      },
    ],
  ])("redacts %s and keeps the rest", (_, value) => {
    const text = createRedactor().body(JSON.stringify(value))!;
    expect(text).not.toMatch(/LEAK/);
    expect(text).toContain("[redacted]");
    expect(JSON.parse(text)).toBeTruthy();
  });

  it("redacts GraphQL and YAML-style pairs in plain text", () => {
    const redact = createRedactor();
    expect(redact.body('mutation { login(user: "a", password:"LEAK") }')).toBe(
      'mutation { login(user: "a", password:"[redacted]") }',
    );
    expect(redact.body("user: a\npassword: LEAK\n")).toBe(
      "user: a\npassword: [redacted]\n",
    );
    expect(redact.body('password=ab"LEAK')).not.toMatch(/LEAK/);
  });

  it("keeps booleans, null, and number literals exactly", () => {
    const body =
      '{"id":12345678901234567890,"hasPassword":true,"password":null,"secret":"s","n":1.50}';
    expect(createRedactor().body(body)).toBe(
      '{"id":12345678901234567890,"hasPassword":true,"password":null,"secret":"[redacted]","n":1.50}',
    );
  });
});

describe("credential key boundaries", () => {
  it.each([
    "isSecret",
    "x-hasura-admin-secret",
    "IDToken",
    "id_token",
    "p%61ssword",
    "user[password]",
    "x-api-token",
    "x-refresh-token",
    "apikey",
  ])("matches %s", (key) => expect(isCredentialKey(key)).toBe(true));

  it.each([
    "secretary",
    "invalidToken",
    "validToken",
    "bidToken",
    "passwordExpiresAt",
    "accessTokenExpiresIn",
    "credentialId",
    "apiKeyId",
    "passwordPolicy",
    "token_type",
    "max_tokens",
  ])("does not match %s", (key) => expect(isCredentialKey(key)).toBe(false));
});

describe("redaction before the 4 KiB cut", () => {
  it("catches a remembered value that straddles the cut in a streamed body", async () => {
    document.body.innerHTML = '<input type="password">';
    const { network } = setup(
      streamed("a".repeat(4090) + "S3cretPassw0rd", "text/plain"),
    );
    type(document.querySelector("input")!, "S3cretPassw0rd");
    await fetch("/x");
    expect((await captured(network)).response.body.text).not.toMatch(/S3cr/);
  });

  it("does not pull an unredacted value into the window after a redaction", async () => {
    document.body.innerHTML = '<input type="password">';
    const head = `token=${"x".repeat(600)}&note=`;
    const { network } = setup(
      streamed(
        `${head}${"a".repeat(4090 - head.length)}S3cretPassw0rd&z=1`,
        "application/x-www-form-urlencoded",
      ),
    );
    type(document.querySelector("input")!, "S3cretPassw0rd");
    await fetch("/x");
    const text = (await captured(network)).response.body.text!;
    expect(text).not.toMatch(/S3cr|xxxx/);
    expect(text).toContain("token=[redacted]");
  });
});

describe("text bodies that are not valid UTF-8 or use other text types", () => {
  it("decodes a declared text body lossily and redacts it instead of sending base64", async () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('{"password":"LEAK","n":"'),
      0xe9,
      0x22,
      0x7d,
    ]);
    const { network } = setup(
      async () =>
        new Response(bytes, {
          headers: { "content-type": "application/json; charset=iso-8859-1" },
        }),
    );
    await fetch("/x");
    expect((await captured(network)).response.body).toMatchObject({
      encoding: "utf-8",
      text: '{"password":"[redacted]","n":"�"}',
    });
  });

  it("treats application/graphql as text", async () => {
    const { network } = setup();
    await fetch(
      new Request("http://localhost:3000/graphql", {
        method: "POST",
        body: '{"password":"LEAK"}',
        headers: { "content-type": "application/graphql" },
      }),
    );
    expect((await captured(network)).request.body).toMatchObject({
      encoding: "utf-8",
      text: '{"password":"[redacted]"}',
    });
  });
});

describe("password fields seen before any interaction", () => {
  it("redacts a field toggled to text before it was first observed", async () => {
    const { network, other } = setup();
    const input = document.createElement("input");
    input.type = "password";
    document.body.append(input);
    input.type = "text";
    type(input, "Hunter2Secret");
    await fetch("/x", {
      method: "POST",
      body: JSON.stringify({ pw: "Hunter2Secret" }),
    });
    expect(JSON.stringify(other)).not.toContain("Hunter2Secret");
    expect(JSON.stringify(await captured(network))).not.toContain(
      "Hunter2Secret",
    );
  });

  it("redacts a password field that existed at start and was toggled later", async () => {
    document.body.innerHTML = '<input type="password">';
    const { other } = setup();
    const input = document.querySelector("input")!;
    input.type = "text";
    await Promise.resolve();
    type(input, "Hunter4Secret");
    expect(JSON.stringify(other)).not.toContain("Hunter4Secret");
  });

  it("remembers password values when input capture is off", async () => {
    document.body.innerHTML = '<input type="password">';
    const { network, other } = setup(undefined, { inputs: false });
    type(document.querySelector("input")!, "Hunter3Secret");
    await fetch("/x", {
      method: "POST",
      body: JSON.stringify({ pw: "Hunter3Secret" }),
    });
    expect(other).toEqual([]);
    expect((await captured(network)).request.body.text).toBe(
      '{"pw":"[redacted]"}',
    );
  });

  it("matches remembered one-time codes only as whole numbers", async () => {
    document.body.innerHTML = '<input autocomplete="one-time-code">';
    const { network } = setup(
      streamed('{"id":99123456001,"ts":1727123456789,"code":"123456"}'),
    );
    type(document.querySelector("input")!, "123456");
    await fetch("/x");
    expect((await captured(network)).response.body.text).toBe(
      '{"id":99123456001,"ts":1727123456789,"code":"[redacted]"}',
    );
  });
});

describe("click attributes", () => {
  it("redacts credentials in URL-valued attributes", () => {
    document.body.innerHTML =
      '<a href="https://u:p@x.test/reset?token=LEAK&page=2#access_token=LEAK2">reset</a><form action="/login?password=LEAK3"><button formaction="/go?api_key=LEAK4">Go</button></form>';
    const { other } = setup();
    document.addEventListener("click", prevent);
    uninstalls.push(() => document.removeEventListener("click", prevent));
    document.querySelector("a")!.click();
    document.querySelector("button")!.click();
    const attributes = other
      .filter(({ name }) => name === "click")
      .map(({ value }) => (value.target as { attributes: object }).attributes);
    expect(attributes[0]).toMatchObject({
      href: "https://x.test/reset?token=[redacted]&page=2#access_token=[redacted]",
    });
    expect(attributes[1]).toMatchObject({
      formaction: "/go?api_key=[redacted]",
    });
    expect(JSON.stringify(other)).not.toMatch(/LEAK|u:p@/);
  });
});

describe("credential header names", () => {
  it("redacts headers whose name is a credential key", async () => {
    const { network } = setup();
    const names = [
      "x-hasura-admin-secret",
      "apikey",
      "x-refresh-token",
      "private-token",
      "x-xsrf-token",
    ];
    await fetch("/x", {
      headers: Object.fromEntries(names.map((name) => [name, "LEAK"])),
    });
    expect((await captured(network)).request.headers).toEqual(
      Object.fromEntries(names.map((name) => [name, "[redacted]"])),
    );
  });
});

describe("review follow-ups", () => {
  it.each([
    ['{"url":"https://u:LEAK@x.test/"}', '{"url":"https://x.test/"}'],
    ['{"db":"postgres://u:pw@LEAK@h/db"}', '{"db":"postgres://h/db"}'],
    ["see https://u:LEAK@x.test/a", "see https://x.test/a"],
  ])("strips URL userinfo anywhere in %s", (body, expected) => {
    expect(createRedactor().body(body)).toBe(expected);
  });

  it("redacts authorization, cookie, bearer, JWT, and CSRF keys", () => {
    const text = createRedactor().body(
      JSON.stringify({
        headers: { Authorization: "Bearer LEAK", Cookie: "sid=LEAK" },
        bearerToken: "LEAK",
        jwt: "LEAK",
        csrfToken: "LEAK",
        authorizationUrl: "https://x.test/auth",
        cookieConsent: "yes",
      }),
    )!;
    expect(text).not.toMatch(/LEAK/);
    expect(JSON.parse(text)).toMatchObject({
      authorizationUrl: "https://x.test/auth",
      cookieConsent: "yes",
    });
    expect(
      createRedactor().url("https://x.test/p?a=1&authorization=LEAK&jwt=LEAK2"),
    ).toBe("https://x.test/p?a=1&authorization=[redacted]&jwt=[redacted]");
  });

  it("redacts attributes named like credentials", () => {
    document.body.innerHTML =
      '<button data-api-key="sk-LEAK" data-token="LEAK2" data-id="7">Go</button>';
    const { other } = setup();
    document.querySelector("button")!.click();
    expect(other[0]!.value.target).toMatchObject({
      attributes: {
        "data-api-key": "[redacted]",
        "data-token": "[redacted]",
        "data-id": "7",
      },
    });
  });

  it("normalizes header names and redacts subscription keys and x-token", async () => {
    const { network } = setup();
    const names = ["x-csrftoken", "ocp-apim-subscription-key", "x-token"];
    await fetch("/x", {
      headers: {
        ...Object.fromEntries(names.map((name) => [name, "LEAK"])),
        "x-request-id": "rid",
      },
    });
    expect((await captured(network)).request.headers).toEqual({
      ...Object.fromEntries(names.map((name) => [name, "[redacted]"])),
      "x-request-id": "rid",
    });
  });

  it("redacts JSON nested four levels deep in strings", () => {
    let value: unknown = { password: "LEAK" };
    for (let level = 0; level < 4; level++)
      value = { inner: JSON.stringify(value) };
    const text = createRedactor().body(JSON.stringify(value))!;
    expect(text).not.toMatch(/LEAK/);
  });

  it("redacts an auth scheme together with its credential", () => {
    expect(
      createRedactor().body("Authorization: Bearer LEAK\nAccept: */*"),
    ).toBe("Authorization: [redacted]\nAccept: */*");
  });

  it("leaves no stray backslash when a value is cut mid-escape", () => {
    expect(createRedactor().body('{"password":"a\\')).toBe(
      '{"password":"[redacted]"',
    );
  });
});
