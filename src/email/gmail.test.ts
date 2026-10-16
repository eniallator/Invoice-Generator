import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { isFile, readText } from "../io.ts";
import { createFiles } from "../test-helpers.ts";
import {
  authorise,
  authUrl,
  createDraft,
  createPkce,
  exchangeCode,
  getAccessToken,
  GMAIL_COMPOSE_SCOPE,
  parseCredentials,
  refreshAccessToken,
  startLoopback,
  type Credentials,
} from "./gmail.ts";

const credentials: Credentials = {
  clientId: "the-client-id",
  clientSecret: "the-client-secret",
  authUri: "https://accounts.example.com/o/oauth2/auth",
  tokenUri: "https://oauth.example.com/token",
};

const CREDENTIALS_JSON = JSON.stringify({
  installed: {
    client_id: "the-client-id",
    client_secret: "the-client-secret",
    auth_uri: "https://accounts.example.com/o/oauth2/auth",
    token_uri: "https://oauth.example.com/token",
    project_id: "ignored",
    redirect_uris: ["http://localhost"],
  },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

/** A `fetch` that answers with the responses in turn, and records what it was asked */
const fakeFetch = (...responses: Response[]) => {
  const fn = vi.fn<typeof fetch>();
  for (const response of responses) fn.mockResolvedValueOnce(response);
  return fn;
};

/** The request body, which is a string or form data */
const bodyText = (init: RequestInit | undefined): string =>
  init?.body instanceof URLSearchParams
    ? init.body.toString()
    : typeof init?.body === "string"
      ? init.body
      : "";

const formBody = (fn: ReturnType<typeof fakeFetch>, call = 0) =>
  Object.fromEntries(new URLSearchParams(bodyText(fn.mock.calls[call]?.[1])));

describe("parseCredentials", () => {
  it("reads the client from a Desktop app credentials file", () => {
    expect(parseCredentials(CREDENTIALS_JSON)).toEqual(credentials);
  });

  it.each([
    ["not JSON", "client_id=x"],
    ["empty", ""],
    ["null", "null"],
    ["an array", "[]"],
    ["empty", "{}"],
    [
      "a web client",
      JSON.stringify({
        web: {
          client_id: "a",
          client_secret: "b",
          auth_uri: "c",
          token_uri: "d",
        },
      }),
    ],
    [
      "missing the secret",
      JSON.stringify({
        installed: { client_id: "a", auth_uri: "c", token_uri: "d" },
      }),
    ],
    [
      "a client id that is not text",
      JSON.stringify({
        installed: {
          client_id: 1,
          client_secret: "b",
          auth_uri: "c",
          token_uri: "d",
        },
      }),
    ],
  ])("rejects credentials that are %s", (_, contents) => {
    expect(() => parseCredentials(contents)).toThrow(
      /should be the JSON of a 'Desktop app' OAuth client/
    );
  });
});

describe("createPkce", () => {
  it("makes a challenge that is the hash of the verifier", () => {
    const { verifier, challenge } = createPkce();
    expect(challenge).toBe(
      createHash("sha256").update(verifier).digest("base64url")
    );
  });

  it("makes URL safe values that are long enough and different each time", () => {
    const first = createPkce();
    const second = createPkce();
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.verifier).not.toBe(second.verifier);
  });
});

describe("authUrl", () => {
  const url = new URL(
    authUrl(credentials, "http://127.0.0.1:1234", "the-state", "the-challenge")
  );

  it("is on the credentials' auth page", () => {
    expect(`${url.origin}${url.pathname}`).toBe(credentials.authUri);
  });

  it("asks for a refresh token with a code that is protected with PKCE", () => {
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "the-client-id",
      redirect_uri: "http://127.0.0.1:1234",
      response_type: "code",
      scope: GMAIL_COMPOSE_SCOPE,
      state: "the-state",
      code_challenge: "the-challenge",
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
    });
  });

  it("only asks to create drafts", () => {
    expect(GMAIL_COMPOSE_SCOPE).toBe(
      "https://www.googleapis.com/auth/gmail.compose"
    );
  });
});

describe("exchangeCode", () => {
  const request = {
    code: "the-code",
    redirectUri: "http://127.0.0.1:1234",
    verifier: "the-verifier",
  };

  it("swaps the code for a refresh token", async () => {
    const fetchFn = fakeFetch(
      json({ access_token: "access", refresh_token: "refresh" })
    );
    await expect(exchangeCode(credentials, request, fetchFn)).resolves.toBe(
      "refresh"
    );
    expect(fetchFn.mock.calls[0]?.[0]).toBe(credentials.tokenUri);
    expect(fetchFn.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(formBody(fetchFn)).toEqual({
      client_id: "the-client-id",
      client_secret: "the-client-secret",
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: "http://127.0.0.1:1234",
      code_verifier: "the-verifier",
    });
  });

  it("throws if Google refuses", async () => {
    const fetchFn = fakeFetch(json({ error: "invalid_grant" }, 400));
    await expect(exchangeCode(credentials, request, fetchFn)).rejects.toThrow(
      /Google refused the token request \(400\).*invalid_grant/
    );
  });

  it("throws if the response is not JSON", async () => {
    const fetchFn = fakeFetch(
      new Response("<html>Oops</html>", { status: 502 })
    );
    await expect(exchangeCode(credentials, request, fetchFn)).rejects.toThrow(
      "Google refused the token request (502): null"
    );
  });

  it("throws if there is no refresh token in the response", async () => {
    const fetchFn = fakeFetch(json({ access_token: "access" }));
    await expect(exchangeCode(credentials, request, fetchFn)).rejects.toThrow(
      "Google's token response was not as expected"
    );
  });
});

describe("refreshAccessToken", () => {
  it("asks for an access token with the refresh token", async () => {
    const fetchFn = fakeFetch(
      json({ access_token: "access", expires_in: 3599 })
    );
    await expect(
      refreshAccessToken(credentials, "refresh", fetchFn)
    ).resolves.toBe("access");
    expect(formBody(fetchFn)).toEqual({
      client_id: "the-client-id",
      client_secret: "the-client-secret",
      grant_type: "refresh_token",
      refresh_token: "refresh",
    });
  });

  it("throws if Google refuses", async () => {
    const fetchFn = fakeFetch(json({ error: "invalid_grant" }, 400));
    await expect(
      refreshAccessToken(credentials, "refresh", fetchFn)
    ).rejects.toThrow(/Google refused the token request \(400\)/);
  });

  it("throws if there is no access token in the response", async () => {
    const fetchFn = fakeFetch(json({ refresh_token: "refresh" }));
    await expect(
      refreshAccessToken(credentials, "refresh", fetchFn)
    ).rejects.toThrow("Google's token response was not as expected");
  });
});

describe("createDraft", () => {
  const message = "To: jane@example.com\r\nSubject: Hi\r\n\r\nBody ✓\r\n";

  it("saves the message as a draft", async () => {
    const fetchFn = fakeFetch(json({ id: "draft-1", message: { id: "m" } }));
    await expect(createDraft("access", message, fetchFn)).resolves.toBe(
      "draft-1"
    );

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Authorization: "Bearer access",
      "Content-Type": "application/json",
    });
    const body: unknown = JSON.parse(bodyText(init));
    expect(body).toEqual({
      message: { raw: Buffer.from(message).toString("base64url") },
    });
    expect(
      Buffer.from(
        (body as { message: { raw: string } }).message.raw,
        "base64url"
      ).toString("utf8")
    ).toBe(message);
  });

  it("throws if Gmail refuses", async () => {
    const fetchFn = fakeFetch(json({ error: { message: "Forbidden" } }, 403));
    await expect(createDraft("access", message, fetchFn)).rejects.toThrow(
      /Gmail did not create the draft \(403\).*Forbidden/
    );
  });

  it("throws if there is no id in the response", async () => {
    const fetchFn = fakeFetch(json({ message: {} }));
    await expect(createDraft("access", message, fetchFn)).rejects.toThrow(
      "Gmail's response was not as expected"
    );
  });

  it("throws if the response is not JSON", async () => {
    const fetchFn = fakeFetch(new Response("Bad gateway", { status: 502 }));
    await expect(createDraft("access", message, fetchFn)).rejects.toThrow(
      "Gmail did not create the draft (502): null"
    );
  });
});

describe("startLoopback", () => {
  const visit = (redirectUri: string, query: string) =>
    fetch(`${redirectUri}/?${query}`);

  it("listens on a local port", async () => {
    const { redirectUri, code } = await startLoopback("state");
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await visit(redirectUri, "state=state&code=abc");
    await code;
  });

  it("gives the code that Google sends the browser back with", async () => {
    const { redirectUri, code } = await startLoopback("state");
    const response = await visit(redirectUri, "state=state&code=the-code");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("You can close this tab");
    await expect(code).resolves.toBe("the-code");
  });

  it("ignores other requests until it gets the right one", async () => {
    const { redirectUri, code } = await startLoopback("state");
    expect((await visit(redirectUri, "")).status).toBe(400);
    expect((await visit(redirectUri, "state=state")).status).toBe(400);
    expect((await visit(redirectUri, "state=other&code=wrong")).status).toBe(
      400
    );
    expect((await visit(redirectUri, "code=wrong")).status).toBe(400);
    expect((await visit(redirectUri, "state=other&error=wrong")).status).toBe(
      400
    );
    await visit(redirectUri, "state=state&code=right");
    await expect(code).resolves.toBe("right");
  });

  it("fails if Google says it was not authorised", async () => {
    const { redirectUri, code } = await startLoopback("state");
    const rejected = expect(code).rejects.toThrow(
      "Google did not authorise this: access_denied"
    );
    const response = await visit(
      redirectUri,
      "state=state&error=access_denied"
    );
    expect(response.status).toBe(200);
    await rejected;
  });

  it("stops listening once it has the code", async () => {
    const { redirectUri, code } = await startLoopback("state");
    await visit(redirectUri, "state=state&code=abc");
    await code;
    await vi.waitFor(async () => {
      await expect(
        visit(redirectUri, "state=state&code=again")
      ).rejects.toThrow();
    });
  });

  it("stops listening after a failure too", async () => {
    const { redirectUri, code } = await startLoopback("state");
    const rejected = expect(code).rejects.toThrow();
    await visit(redirectUri, "state=state&error=access_denied");
    await rejected;
    await vi.waitFor(async () => {
      await expect(
        visit(redirectUri, "state=state&code=abc")
      ).rejects.toThrow();
    });
  });
});

describe("authorise", () => {
  /** Plays the part of the person: opens the URL and approves, and hands over what it showed */
  const approve = () => {
    const shown: URL[] = [];
    const showUrl = (url: string) => {
      const parsed = new URL(url);
      shown.push(parsed);
      void fetch(
        `${parsed.searchParams.get("redirect_uri")}/?state=${parsed.searchParams.get("state")}&code=the-code`
      );
    };
    return { shown, showUrl };
  };

  it("has the person approve in their browser and returns the refresh token", async () => {
    const { shown, showUrl } = approve();
    const fetchFn = fakeFetch(json({ refresh_token: "refresh" }));

    await expect(authorise(credentials, showUrl, fetchFn)).resolves.toBe(
      "refresh"
    );

    expect(shown).toHaveLength(1);
    expect(shown[0]?.searchParams.get("client_id")).toBe("the-client-id");
    expect(formBody(fetchFn)).toMatchObject({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: shown[0]?.searchParams.get("redirect_uri"),
    });
  });

  it("proves it is the same one that asked, with PKCE", async () => {
    const { shown, showUrl } = approve();
    const fetchFn = fakeFetch(json({ refresh_token: "refresh" }));
    await authorise(credentials, showUrl, fetchFn);

    const verifier = formBody(fetchFn)["code_verifier"] ?? "";
    expect(shown[0]?.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(verifier).digest("base64url")
    );
  });
});

describe("getAccessToken", () => {
  const ACCESS = json({ access_token: "access" });

  it("uses the saved refresh token", async () => {
    const dir = createFiles({
      "token.json": JSON.stringify({ refresh_token: "saved" }),
    });
    const showUrl = vi.fn();
    const fetchFn = fakeFetch(ACCESS);

    await expect(
      getAccessToken(credentials, join(dir, "token.json"), showUrl, fetchFn)
    ).resolves.toBe("access");

    expect(showUrl).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(formBody(fetchFn)).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "saved",
    });
  });

  it("asks the person to approve the first time, and saves the refresh token", async () => {
    const dir = createFiles({ "other.txt": "" });
    const tokenPath = join(dir, "token.json");
    const showUrl = (url: string) => {
      const parsed = new URL(url);
      void fetch(
        `${parsed.searchParams.get("redirect_uri")}/?state=${parsed.searchParams.get("state")}&code=the-code`
      );
    };
    const fetchFn = fakeFetch(
      json({ refresh_token: "new-refresh" }),
      json({ access_token: "access" })
    );

    expect(isFile(tokenPath)).toBe(false);
    await expect(
      getAccessToken(credentials, tokenPath, showUrl, fetchFn)
    ).resolves.toBe("access");

    expect(JSON.parse(readText(tokenPath))).toEqual({
      refresh_token: "new-refresh",
    });
    expect(formBody(fetchFn, 1)).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "new-refresh",
    });
  });

  it.each([
    ["not JSON", "refresh_token=x"],
    ["empty", ""],
    ["missing the token", "{}"],
    ["a token that is not text", '{"refresh_token": 1}'],
  ])("throws for a saved token that is %s", async (_, contents) => {
    const dir = createFiles({ "token.json": contents });
    await expect(
      getAccessToken(
        credentials,
        join(dir, "token.json"),
        vi.fn(),
        fakeFetch(ACCESS)
      )
    ).rejects.toThrow(/token\.json is not valid, delete it to authorise again/);
  });
});
